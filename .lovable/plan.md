
# GrowthScribe OS — One-Pass Overhaul

A single coherent pass covering data, intelligence, and design. Everything below ships together.

## 1. Real Google Search Console + GA4 data pulls

Replace the current "save property string" flow with the official Lovable Google Search Console connector and a GA4 Data API pull through the same gateway pattern.

- Connect the **Google Search Console** connector (uses `connector-gateway.lovable.dev/google_search_console`).
- New server fn `pullSearchConsole({ siteId, days })`:
  - Calls `POST /webmasters/v3/sites/{property}/searchAnalytics/query` with dimensions `[date, query, page]`, last N days, rowLimit 25 000, paginated.
  - Upserts into `search_console_daily` (clicks, impressions, ctr, position).
  - Updates `sites.monthly_clicks` / `monthly_impressions` from the last 28 days.
- New server fn `listGscProperties()` to populate the dropdown instead of free-text.
- For GA4: same connector pattern via `analyticsdata.googleapis.com/v1beta/properties/{id}:runReport` (sessions, users, engagedSessions, conversions, revenue by date + page) → `ga4_daily`. If the GA4 connector isn't separately available, surface a clear "manual property + nightly job" fallback.
- Both pulls are wired into the Integrations page as "Pull last 28 days" buttons and into a `data.sync` background_jobs row with progress.

## 2. Recommendations engine (end-to-end, no placeholder)

Turn `/recommendations` into a real prioritized worklist.

- New server fn `generateRecommendations({ siteId })` that combines, per post:
  - **Refresh**: `modified_at` older than 180 days AND has GSC impressions > threshold.
  - **Expand**: `word_count < 800` AND ranks pos 8–20 for any query.
  - **Merge**: cosine-similar titles + overlapping top queries between two posts.
  - **Internal-link**: posts with high impressions but no inbound link from related cluster posts → writes to `internal_link_opportunities`.
  - **Decay**: clicks dropped >40% vs prior 28 days.
- Each recommendation written to `content_recommendations` with severity, category, suggested_action, post_id.
- UI: filterable table (category, severity, status), bulk "Mark done", click-through to the post and to a one-click "Generate refresh brief" that pre-fills the brief generator.

## 3. Hardening Audits, Briefs, WordPress sync

- **Audits**: add bulk "Audit top 10 posts by impressions" action; show progress; persist rendered HTML→text length and word count; render recommendations with severity chips.
- **Briefs**: pre-seed Target keyword from selected post's top GSC query when available; render outline as collapsible tree; add "Send to Tasks" button (creates a task linked to the brief).
- **WordPress sync**: surface `totalsByType`, warnings, and last-error inline on each site card; auto-mark `stale` after 7 days since `last_synced_at`.
- All server fns: stricter Zod, consistent error envelopes, activity-log writes.

## 4. Design overhaul — Cloud White

A single coherent visual system applied app-wide. No per-page bespoke styling.

- Tokens in `src/styles.css` (oklch): off-white `--background`, blue-tinted `--muted`, slate `--foreground`, primary `#3B82F6` with `--primary-glow`, soft `--border`, refined `--shadow-elegant`, `--gradient-primary`.
- Typography pair: **Space Grotesk** (headings) + **Inter** (body). Larger heading scale, tighter tracking.
- Sidebar: redesign with org switcher, grouped nav sections (Insights, Content, Growth, Settings), active-state pill, subtle gradient header.
- PageHeader: bigger title, eyebrow chip, primary action, breadcrumb-style context.
- Cards: thinner borders, soft elevation, hover lift, gradient-on-primary CTAs.
- Dashboard: KPI tiles with sparkline placeholders driven by `search_console_daily`, recent activities with provider icons, "Next best actions" panel sourced from top 5 recommendations.
- Tables: compact density, sticky header, zebra-free, status badges.
- Empty states: warmer copy, single primary CTA, illustration via inline SVG.
- Motion: 150 ms ease-out on hover, 250 ms on dialogs (Tailwind defaults — no new deps).

## Technical details

- **New/edited files**:
  - `src/lib/integrations.functions.ts` (+ `pullSearchConsole`, `pullGa4`, `listGscProperties`)
  - `src/lib/recommendations.functions.ts` (new)
  - `src/lib/audit.functions.ts`, `src/lib/brief.functions.ts` (extend)
  - `src/routes/_authenticated/{integrations,recommendations,audits,briefs,dashboard}.tsx`
  - `src/components/dashboard/{AppSidebar,PageHeader,KpiTile,RecommendationsTable}.tsx`
  - `src/styles.css` (token rewrite + font imports)
  - `index.html` (Google Fonts preconnect)
- **Connector**: call `standard_connectors--connect` for `google_search_console`. GSC pulls go server-side only (`process.env.LOVABLE_API_KEY` + `process.env.GOOGLE_SEARCH_CONSOLE_API_KEY`).
- **No new tables required** — schema already covers `search_console_daily`, `ga4_daily`, `content_recommendations`, `internal_link_opportunities`, `background_jobs`.
- Verifier suite (`bun run typecheck`, `lint`, `test`, `db:types:verify`) must stay green.

## What I am explicitly NOT doing

- Not adding payments, SERP tracking, or AI-visibility tests beyond what already exists.
- Not adding new public pages.
- Not changing auth flows.

Approve and I'll execute the whole pass.
