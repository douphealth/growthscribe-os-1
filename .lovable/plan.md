## Phased rollout to make every feature actually work

The app has all the UI and most server-fn scaffolding, but jobs queue and never run, and several scanners return placeholder data. I'll ship in three focused passes so each one is fully working before moving on, instead of half-finishing everything.

### Pass 1 (this turn) — Make the queue real

Without this, every "Run scan", "Sync", "Test AI visibility" button is silent.

1. **Schedule the worker via pg_cron** (`cron.schedule` calls
   `/api/public/cron/worker` every 60s with the anon `apikey` header). Also
   schedule `/api/public/cron/scan` daily and `/api/public/cron/gsc-pull`
   daily.
2. **Extend `worker.ts` dispatch** to handle every `job_type` currently
   enqueued by the UI:
   - `wp_verify` → ping `/wp-json` with stored creds, mark
     `integration_connections.status`.
   - `wp_sync` → full paginated sync of posts/pages, score each via
     `scoreContent`, upsert `wordpress_posts`.
   - `content_audit` → call existing `runContentAudit` logic (LLM via
     Lovable AI) and write to `content_audits`.
   - `brief_generate` → LLM call → fill `content_briefs.outline` /
     `aeo_questions` / `geo_signals` / `internal_links`.
   - `ai_visibility` → call Lovable AI Gateway for the configured engine,
     parse citations, persist to `ai_visibility_tests`.
   - `gsc_import` / `ga4_import` → stub-friendly: persist a "needs connector"
     error if the connector isn't connected; pull last 28 days when it is.
3. **Realtime job status in UI**: subscribe to `background_jobs` changes on
   the Technical / Inventory / AI-visibility pages so the user sees
   queued → running → succeeded without refresh.

### Pass 2 — Real on-page intelligence (next turn)

1. **PageSpeed per post** → new `page_vitals` table (LCP/INP/CLS/perf score
   per device), surfaced as a column + gauge in Content Inventory.
2. **One-click WP fix with diff preview**: route `/recommendations` opens a
   drawer that calls `previewWordPressFix` → renders side-by-side diff →
   `applyWordPressFix` PUTs to WP and marks recommendation `done`.
3. **IndexNow submit** for recently updated posts.

### Pass 3 — Differentiators

1. **Prioritized Action Queue** on dashboard, ranked
   `(impact × confidence) / effort`.
2. **Bulk apply runner** with rate-limit, rollback, audit log.
3. **Semrush enrichment loop** → top pages + keyword gaps surfaced as
   "striking distance" cards.
4. **Topical authority gap map** vs a competitor's Semrush top pages.

### Out of scope this rollout

- New auth flows, billing, custom design system.
- Building the full GA4/GSC OAuth UI — passes 1/2 just wire what the
  Google connector already exposes.

Approve Pass 1 and I'll ship it now; passes 2 and 3 follow in subsequent
turns so each ships fully tested instead of half-built.
