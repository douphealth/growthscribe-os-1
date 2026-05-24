
# Pass 13 — End-to-end SEO/GEO/AEO/SERP push

Three new job types + auto-publish-with-rollback pipeline. Everything runs through the existing `background_jobs` queue, scoped per organization, gated by `wp_revisions` for instant rollback.

## 1. Database (single migration)

New tables/columns:
- `auto_apply_settings(organization_id PK, mode text default 'full', exclude_categories jsonb, paused boolean, updated_at)` — per-org kill switch.
- `serp_snapshots(id, org_id, site_id, keyword, page, position, date, source, created_at)` — daily SERP per tracked keyword (unique on org+keyword+page+date).
- `geo_aeo_assets(id, org_id, site_id, post_id, kind ['article','faq','howto','product','breadcrumb'], jsonld jsonb, applied_at, applied_changeset_id, hash)` — cached JSON-LD per post+kind.
- `ai_engine_citations(id, org_id, site_id, query, engine, appears, rank, citation_url, week date, created_at)` — weekly engine citation tracker (unique on org+query+engine+week).
- `cluster_gap_briefs(id, org_id, site_id, cluster_id, suggested_title, target_keyword, intent, brief_id nullable, status text)` — pillar/cluster gap → brief generation.
- `wordpress_posts`: add `last_optimized_at timestamptz`, `optimization_score int`.
- Index: `serp_snapshots(site_id, keyword, date desc)`, `ai_engine_citations(site_id, week desc)`, `geo_aeo_assets(post_id, kind)`.

New RPC `enqueue_full_optimization(_org_id, _site_id)` — fans out one `audit_apply` job per published post (paginated batches of 50, priority 5).

Cron additions:
- `02:00 UTC` daily — for each active site, enqueue `serp.track` (top 100 keywords by impressions, last 28d).
- `04:00 UTC` weekly Mon — enqueue `ai_visibility` deep run (50 GSC-mined queries × 5 engines).
- `05:00 UTC` daily — enqueue `topical.gap_fill` per site.
- `06:00 UTC` daily — enqueue `audit_apply` for posts where `last_optimized_at < now() - 14 days` OR null.

## 2. Worker job types (worker-jobs.server.ts)

### `audit_apply` (core)
For one post:
1. Pull open `content_recommendations` for `(site_id, post_id)`.
2. Run `auditHtml` + classify content with `gemini-2.5-flash-lite`.
3. Build patch via LLM (`gemini-3-flash-preview`): new `title`, `meta_description`, `headings` adjustments, `internal_links` to add, `alt_text` for images missing it.
4. Generate JSON-LD (Article + FAQ if Q&A detected + HowTo if steps detected + BreadcrumbList).
5. Snapshot `before` to `wp_revisions`.
6. Apply to WordPress via REST API (`runWpSync` push path). Inject JSON-LD into `<head>` via Yoast/RankMath custom field if plugin detected, else as inline `<script>` at top of content.
7. Insert `content_changesets` row + close related `content_recommendations`.
8. Update `wordpress_posts.last_optimized_at`, `optimization_score`.

### `serp.track`
For each tracked keyword: call GSC API `searchanalytics/query` for last 1d, filter by query, store top page + position into `serp_snapshots`. Compute delta vs 7d-prior, write activity if position improved/dropped ≥3.

### `topical.gap_fill`
1. For each `topical_clusters` row with `coverage_percent < 80`, find missing cluster pages via existing `topical_cluster_pages`.
2. For each gap (max 5/run), generate brief via existing `runBriefGenerate` and insert `cluster_gap_briefs` linking to it.
3. Auto-create `tasks` row assigned to org owner.

### `ai_visibility` (extended)
- Mine queries: top 50 GSC queries with impressions ≥ 100, position 4–20.
- Engines bumped to 5: `gpt`, `gemini`, `perplexity`, `claude` (mapped to `openai/gpt-5-mini`), `copilot` (mapped to `google/gemini-2.5-flash`).
- Write weekly rollup into `ai_engine_citations` (one row per query×engine×week).
- Emit `score_breakdowns` row with citation share.

### `geo_aeo.refresh`
- For each post not in `geo_aeo_assets` or `hash != content_hash`, generate Article+FAQ+HowTo+Breadcrumb JSON-LD, store with hash. Picked up by next `audit_apply`.

## 3. Auto-apply pipeline

`src/lib/auto-apply.server.ts` — single function `applyOptimization(admin, orgId, postId)`:
1. Reads `auto_apply_settings` — skip if `paused`.
2. Calls `audit_apply` logic.
3. Writes `wp_revisions.before/after`, sets `applied_changeset_id`.
4. On any WP write failure: catch, store error in `last_error`, do NOT update post — preserves consistency.
5. Returns `{ applied: bool, changeset_id, rollback_url }`.

Rollback (existing `wp_revisions` table already has `rolled_back_at`): expose server fn `rollbackRevision(revisionId)` that PUTs the `before` payload back to WP.

## 4. Frontend additions (minimal — backend-heavy pass)

- `/_authenticated/optimization` route: status of `last_optimized_at` across posts, "Optimize all now" button → calls `enqueue_full_optimization`, shows live progress via realtime on `background_jobs`.
- Settings panel: `auto_apply_settings` toggle (paused / full / draft-only override).
- Sidebar "AI Visibility" badge: citation share % from latest `ai_engine_citations`.
- Recharts sparkline on dashboard: 28-day SERP position trend per top-10 keywords (data from `serp_snapshots`).
- `wp_revisions` list page: one-click rollback button per row.

## 5. AI cost controls

- `audit_apply` LLM calls cached by `(post_id, content_hash)` in `content_scores` — re-runs skip LLM if hash unchanged.
- JSON-LD generation: cheap model (`gemini-2.5-flash-lite`), one combined call per post returning all schema types.
- Batched in worker: up to 10 posts/tick × 10 ticks/min = 100 posts/min throughput per worker.

## Files to create/edit

Create:
- `src/lib/auto-apply.server.ts`
- `src/lib/serp-track.server.ts`
- `src/lib/geo-aeo.server.ts`
- `src/lib/topical-gap.server.ts`
- `src/lib/optimization.functions.ts` (server fns: `enqueueFullOptimization`, `rollbackRevision`, `getOptimizationStatus`, `toggleAutoApply`)
- `src/routes/_authenticated/optimization.tsx`
- `src/routes/_authenticated/revisions.tsx`
- 2 migrations (schema + cron)

Edit:
- `src/lib/worker-jobs.server.ts` — add dispatchers for `audit_apply`, `serp.track`, `topical.gap_fill`, `geo_aeo.refresh`; extend `runAiVisibility` with 5 engines + weekly rollup.
- `src/routes/api/public/cron/worker.ts` — add new job_type cases.
- `src/components/dashboard/AppSidebar.tsx` — add Optimization + Revisions links + citation badge.
- `src/routes/_authenticated/dashboard.tsx` — add SERP trend sparklines.

## Out of scope (callable in next pass)
- Multi-language support
- Competitor backfill from Semrush (would 10x cost; gate behind explicit user trigger)
- Frontend editor for JSON-LD overrides
