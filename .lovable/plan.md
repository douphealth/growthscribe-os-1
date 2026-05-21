
## Why a phased rollout

What you're describing is roughly 6–8 weeks of focused product work (job engine + WP + GSC/GA4 + crawler + scoring + topical + AI visibility lab + 10 new pages + CI + docs). If I try to ship it in one turn, every layer ends up half-built — exactly the trap the current plan.md was already trying to escape.

Instead I'll ship it in **4 passes**, each one fully working and shippable before the next. You approve this plan, then I execute Pass 1 immediately and stop. After you verify, say "go" and I run Pass 2.

---

## Pass 1 — Foundation: job engine + WP + scoring core (this turn)

The thing that unblocks everything else. Without it, no scan/sync/audit/AI test actually runs.

**Database migration**
- Extend `background_jobs`: `retry_count`, `max_retries`, `last_error`, `idempotency_key`, `priority`, `scheduled_at`, `locked_at`, `locked_by`, `next_run_at`. Unique index on `(organization_id, idempotency_key)`.
- New `job_logs` table (job_id, level, message, metadata, created_at).
- Extend `wordpress_posts` with `canonical_url`, `seo_plugin` (yoast/rankmath/aioseo/none), `yoast_meta` jsonb.
- New `wp_revisions` table for rollback metadata (post_id, before, after, applied_by, applied_at, job_id).
- New `score_breakdowns` table: one row per (post_id, score_type) with `score`, `explanation`, `evidence jsonb`, `recommended_actions jsonb`, `estimated_impact`, `confidence`, `computed_at`.
- RLS on all new tables (org-scoped via `is_org_member`).

**Worker**
- Rewrite `src/lib/worker-jobs.server.ts` with: atomic claim via `UPDATE ... RETURNING` + `locked_at`, exponential backoff (`next_run_at = now() + 2^retry_count * 30s`), per-org concurrency cap (max 3 running per org), structured `job_logs` writes, idempotency-key dedup, max_retries → `failed` terminal state.
- Dispatch table covering all 11 job types listed. Pass 1 ships **real** handlers for: `wp.verify`, `wp.sync`, `content.audit`, `vitals.refresh`. The other 7 are wired as stubs that write a clear "not yet implemented" `job_logs` entry so the UI surfaces something honest.

**WordPress integration (production)**
- `wp.verify`: ping `/wp-json`, detect Yoast/RankMath/AIOSEO from `/wp-json` namespaces, persist on `sites`.
- `wp.sync`: paginated pull of posts + pages with `context=edit`, canonical extraction, SEO-plugin meta capture, score recomputation via existing `scoreContent`.
- `applyWordPressFix` already exists — wrap it so every apply writes a `wp_revisions` row + audit log. Drawer already shows diff; verify the rollback button works.

**Scoring core**
- Refactor `content-scoring.ts` to return `{ score, explanation, evidence, recommendedActions, estimatedImpact, confidence }` per dimension and persist to `score_breakdowns`.
- Ship Technical, ContentQuality, AEO, GEO, InternalLink scorers with explainable breakdowns. The other 5 (EEAT, Topical, Revenue, Decay, Growth) get a v0 implementation that returns a real number from available signals + `confidence: "low"` so the UI never lies about precision.

**UI**
- New `ActiveJobsBanner` already exists — make it subscribe to `background_jobs` via realtime + show retry/cancel.
- Add `ScoreBreakdownCard` component (used by inventory/recommendations).
- Realtime subscription on jobs page so users see queued → running → succeeded without refresh.

**Cron**
- Confirm `pg_cron` schedules `/api/public/cron/worker` every 60s.

**Out of Pass 1 scope:** GSC/GA4 ingestion, full crawler, topical engine, AI visibility lab, 10 new pages, CI workflow. Those are Passes 2–4.

---

## Pass 2 — Data ingestion + technical crawler

- GSC + GA4: real handlers for `gsc.import` / `ga4.import` via the existing Google connector. New tables `gsc_page_query_metrics`, `ga4_page_metrics` keyed by (site, page, query, date). Decay detector = 28-day rolling clicks delta.
- Crawler: `crawl.site` handler hits sitemap → fetches each URL → stores status, canonical, robots, title/meta lengths, h1/h2, schema types, internal link graph, image alt coverage, redirect chains in a new `page_audits` table.
- PageSpeed/Vitals: `vitals.refresh` calls PSI API per URL (needs `PAGESPEED_API_KEY` — I'll request via `add_secret` when we get here).
- New page: **Technical SEO** redesign (replaces current placeholder) with filterable findings table + bulk Apply.

---

## Pass 3 — Topical authority + AI visibility lab + Brief factory

- New tables: `topic_entities`, `query_intent_map`, `competitor_pages` (extend existing `topical_clusters` / `topical_cluster_pages`).
- `topical.map` handler: LLM-driven pillar/cluster generation from existing inventory + GSC queries + Semrush enrichment (connector already exists).
- Cannibalization + internal-link opportunity detection → write to existing `internal_link_opportunities`.
- **AI Visibility Lab** page: prompt library, scheduled runs, multi-engine (Gemini/GPT/Perplexity via Lovable AI Gateway), citation parser, brand/competitor mention extraction, time-series chart.
- **Brief Factory**: real `brief.generate` handler that consumes audit + topical + GSC signals.

---

## Pass 4 — Executive UI shell + enterprise hardening

- Sidebar collapse to 5 outcome-led sections (Command Center / Intelligence / Create / AI Visibility / Settings).
- New pages: Growth Command Center (prioritized action queue front and center), Site Intelligence, Experiments, Executive Reports (weekly digest).
- Role permission matrix (viewer / editor / admin / owner) enforced both via RLS helpers and server-fn guards.
- Audit log taxonomy: standardize `action` strings, add `category`.
- Usage metering table (`org_usage_daily`) — counts jobs run, AI tokens used, WP applies.
- CI workflow file already exists; extend with `db:types:check` gating + migration smoke test.
- Docs: `docs/architecture.md`, `docs/job-engine.md`, `docs/scoring.md`.

---

## Technical notes (for the record)

- All new server-side work goes through `createServerFn` + `requireSupabaseAuth`. No new Supabase Edge Functions.
- WP app passwords stay encrypted via the existing AES-GCM helper in `wordpress.server.ts`.
- Service role key never crosses the client boundary.
- Realtime: enable replication on `background_jobs` and `job_logs` in the Pass 1 migration.
- Scoring uses Lovable AI Gateway (no user API key needed).

---

## What I need from you

Reply **"approve pass 1"** and I'll execute it in the next turn — migration first (you'll get a one-click approval for the SQL), then worker rewrite, WP handlers, scoring refactor, and UI wiring. Reply with edits if you want to reshape any pass before I start.
