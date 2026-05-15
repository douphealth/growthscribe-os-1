
# GrowthScribe OS — Phased SOTA rollout

You picked: all three scopes, phased; PageSpeed + GA4 + Semrush + IndexNow; one-click apply with diff preview. I'll ship Phase 1 in this pass and queue Phases 2–3 for follow-ups so each lands deep, tested, and reliable instead of shallow everywhere.

## Phase 1 (this pass) — Technical SEO scanner + one-click WP fixes

A real per-URL scanner that pulls the page, parses it, queries PageSpeed, scores it, persists findings, and lets the user apply fixes back to WordPress with a side-by-side diff.

### What ships

1. **Site crawl + per-page scan** (`runTechnicalScan(siteId)`)
   - Reads `wordpress_posts` for the site (already synced).
   - Per post: fetch URL with timeout/retry, parse with `node-html-parser`, extract `title`, meta description, canonical, OG/Twitter, H1 count, image alt coverage, internal/external link counts, schema.org JSON-LD presence, word count.
   - Calls Google **PageSpeed Insights v5** (mobile + desktop) for Core Web Vitals: LCP, INP, CLS, performance score. No API key needed for low volume; uses `PAGESPEED_API_KEY` env if present.
   - Writes structured findings to `content_recommendations` (severity, category, suggested_action, post_id) with a `meta_json` payload of before-state.

2. **One-click apply with diff** (`applyWordPressFix(recommendationId, payload)`)
   - Server fn fetches the post via WP REST (`/wp-json/wp/v2/{type}/{id}`).
   - Computes the proposed change (e.g. new SEO title via Yoast/RankMath meta, new alt text, injected JSON-LD).
   - Returns `{ before, after, diff }` for preview.
   - On confirm, `PUT`s back to WP using stored Application Password.
   - Logs to `activities` and `audit_logs`. Marks recommendation `done`.

3. **Bing IndexNow** (`submitIndexNow(siteId, urls[])`)
   - Generates per-site key file at `/{key}.txt`, persists key in `sites.config_json`.
   - POSTs to `https://api.indexnow.org/indexnow` with the URL list.
   - "Submit recently updated" button on each site card.

4. **Semrush enrichment** for the recommendations engine
   - `enrichWithSemrush(siteId)` calls `semrush--top_pages` + `semrush--page_analysis` for the site's top URLs and merges keyword + difficulty into `keyword_rankings`.

5. **New page `/technical`**
   - Site picker, "Run scan" button (queues `background_jobs` row, polls progress).
   - Results table grouped by issue type with severity chips, before/after preview drawer, "Apply fix" + "Apply all in group" buttons.
   - PageSpeed gauge per device, CWV pass/fail badges.

6. **Cloud White polish**
   - Reuses existing tokens. New `Gauge`, `DiffViewer`, `IssueRow` components — no new design system.

### Files

```text
src/lib/technical.functions.ts         # runTechnicalScan, applyWordPressFix, submitIndexNow, enrichWithSemrush
src/lib/wordpress.server.ts            # extend with putPost + meta helpers
src/components/technical/Gauge.tsx
src/components/technical/DiffViewer.tsx
src/components/technical/IssueRow.tsx
src/routes/_authenticated/technical.tsx
```

DB: no schema change required — `content_recommendations.meta` is encoded in `detail`/`suggested_action`. If we need richer payloads I'll add a single `meta` jsonb column via migration; otherwise skipped.

### Dependencies

- `node-html-parser` (Worker-safe, no native deps).
- No new design libs.

### Verification

- `bun run typecheck`, `lint`, `test`, `build`. New unit test for the parser (extract from a fixture HTML) and for the diff serializer.

## Phase 2 (next pass) — GEO/AEO + AI visibility

- Schema.org generator (Article, FAQ, HowTo) wired into `applyWordPressFix`.
- Entity extraction → `entities` table, answer-snippet rewriter.
- AI citation tracker hitting Lovable AI Gateway (Gemini, GPT-5) with batched prompts; persists to `ai_visibility_tests` (already exists).
- Per-site AEO score on the dashboard.

## Phase 3 (pass after that) — Bulk auto-apply + GA4 + automation

- GA4 connector (you'll be prompted to connect it).
- Bulk fix runner with rate-limit + rollback.
- Scheduled scans via `pg_cron` → `/api/public/cron/scan` route.

## Out of scope (intentionally)

- Payments, SERP rank tracking, anything not requested.
- New auth flows.
- Replacing the existing recommendations / audits / briefs pages — they get linked from the new `/technical` page.

Approve and I'll execute Phase 1 now.
