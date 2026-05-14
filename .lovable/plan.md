
# GrowthScribe OS — Production Refactor Plan

This is a large refactor (18 work items, schema changes, multi-tenancy, tests, server functions). I'll execute it in 5 sequenced phases so each phase leaves the app in a working state. The landing page and existing UI style stay intact throughout.

## Phase 1 — Repo hygiene & tooling

- Rename package `tanstack_start_ts` → `growthscribe-os` in `package.json`.
- Add scripts: `typecheck` (`tsc --noEmit`), `check` (lint + typecheck), `test` (`vitest run`), `db:types` (Supabase types regen helper, documented in README).
- Add `.env.example` with placeholders (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`).
- Update `.gitignore` to ignore `.env`, `.env.local`, `.env.*.local`. Note: I cannot remove `.env` from git history, but I'll document the rotation step in the README and in the response.
- Re-enable strict ESLint rules in `eslint.config.js` (no global disable of `no-unused-vars`, keep `@typescript-eslint/no-explicit-any` as warning).
- Install Vitest + `@testing-library/react` + `jsdom` + `@vitest/ui`.

## Phase 2 — Multi-tenant database migration

One migration that:
- Creates `organizations`, `organization_members` (with `org_role` enum: `owner`, `admin`, `editor`, `analyst`, `viewer`).
- Adds security-definer helpers: `is_org_member(_user, _org)`, `has_org_role(_user, _org, _role)`, `current_user_orgs()`.
- Adds `organization_id uuid` column to all business tables (`sites`, `content_audits`, `content_briefs`, `tasks`, `topical_maps`, `integrations`, `activities`).
- Backfills `organization_id` by creating one default org per existing `owner_id` and assigning that user as owner member.
- Creates new product tables: `integration_connections`, `wordpress_posts`, `content_scores`, `content_recommendations`, `internal_link_opportunities`, `topical_clusters`, `ai_visibility_tests`, `approval_requests`, `background_jobs`. (`audit_logs` already exists — extend with `organization_id`.)
- Drops old owner-based RLS policies and replaces them with org-scoped policies using `is_org_member()`. Keeps RLS enabled on every table.
- Updates `handle_new_user()` trigger to also create a personal organization on signup and add the user as owner member.

## Phase 3 — Server functions

Migrate to TanStack `createServerFn` (per stack rules — no Supabase Edge Functions). Create stubs in `src/lib/`:
- `wordpress.functions.ts` → `verifyWordpressConnection`, `syncWordpressContent`, `createWordpressDraft`, `publishApprovedDraft`
- `content.functions.ts` → `runContentAudit`, `generateContentBrief`
- `approvals.functions.ts` → `requestPublishApproval`
- `analytics.functions.ts` → `importGscData`, `importGa4Data`
- `ai.functions.ts` → `runAiVisibilityTest`

Each stub: validates input with Zod, requires `requireSupabaseAuth`, verifies org membership, inserts a `background_jobs` row with status `queued`, returns the job id. Real provider work is `TODO` but the contract + auth + persistence is real.

## Phase 4 — Frontend

- `OrganizationProvider` context that loads current user's orgs and exposes `currentOrg`, `setCurrentOrg`, `role`.
- Org switcher in sidebar.
- Onboarding route `/_authenticated/onboarding` with 4 steps: create org → add first site → connect WordPress (placeholder form) → connect GSC/GA4 (placeholder forms). Skippable.
- Update existing routes (`dashboard`, `sites`, `audits`) to scope all queries by `organization_id`. TanStack Query keys become `['sites', orgId]`, `['dashboard-stats', orgId, userId]`, etc.
- Add empty / loading / error states (skeletons + retry buttons) to every route.
- Replace all `any` types with `Tables<'sites'>` etc. from generated `Database` types.
- Keep landing page (`/`) and current visual style untouched.

## Phase 5 — Tests + README

- Vitest setup (`vitest.config.ts`, `src/test/setup.ts` with jsdom).
- Tests:
  - `auth-guard.test.tsx` — `_authenticated` redirects unauthenticated.
  - `dashboard.test.tsx` — renders empty state when no sites.
  - `site-form.test.tsx` — Zod validation on URL + name.
- Professional `README.md` with: product purpose, stack, local setup, env vars, Supabase setup, security model (RLS + org membership + service role boundaries), roadmap.

## Technical notes

- Multi-tenancy uses **org membership**, not global admin. Existing `is_admin()` is kept only for platform-level audit log access.
- All new RLS policies use security-definer helpers to avoid recursion.
- `organization_id` is NOT NULL on new rows; backfill ensures existing rows have a value before adding the constraint.
- Server function stubs persist `background_jobs` so the UI can poll real status today; provider integrations land as follow-ups without UI changes.
- Old `.env` rotation: I'll instruct you to rotate the Supabase publishable key in the chat — agents can't rewrite git history.

## Out of scope (explicit)

- Real WordPress / GSC / GA4 / OpenAI provider implementations (stubs only).
- Payments / Stripe (you said "optional").
- Removing committed `.env` from git history (requires user action).

---

Approve and I'll execute Phase 1 → 5 in order, pausing only for the migration approval in Phase 2.
