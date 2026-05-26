# GrowthScribe OS

An AI-powered organic growth command center for WordPress publishers,
affiliate marketers, and SEO teams. GrowthScribe OS helps you improve
rankings, topical authority, AI-search visibility (AEO/GEO), and revenue —
without mass-publishing low-quality AI content.

## Features

- Multi-tenant workspaces with role-based access (owner / admin / editor / analyst / viewer)
- Executive dashboard with sites, health, and topical authority scores
- AI-driven content audits, briefs, and recommendations
- Topical maps, internal-link opportunities, and AEO/GEO scoring
- WordPress sync and approval-based draft publishing
- GSC and GA4 integrations (queued via background jobs)
- AI visibility testing across Google AIO, Perplexity, ChatGPT and Claude
- Audit logs and editorial task workflows

## Tech Stack

- **Frontend:** React 19, TanStack Start (Router + Query), Vite 7, Tailwind v4, shadcn/ui
- **Backend:** TanStack `createServerFn` server functions, Cloudflare Workers runtime
- **Database & Auth:** Lovable Cloud (Supabase: Postgres + Auth + RLS)
- **AI:** Lovable AI Gateway (Gemini, GPT-5, Claude families)
- **Validation:** Zod end-to-end

## Local Setup

```bash
bun install
cp .env.example .env   # then fill in values
bun run dev
```

Useful scripts:

| Script              | Purpose                   |
| ------------------- | ------------------------- |
| `bun run dev`       | Start the Vite dev server |
| `bun run build`     | Production build          |
| `bun run typecheck` | Strict TypeScript check   |
| `bun run lint`      | ESLint                    |
| `bun run check`     | typecheck + lint          |
| `bun run test`      | Run Vitest suite          |
| `bun run db:types`  | Regenerate Supabase types |

## Environment Variables

See `.env.example` for the full list. Public (browser-safe):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

Server-only (never expose to the client):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LOVABLE_API_KEY`

## Backend / Database

The database is provisioned through Lovable Cloud. Schema migrations live
under `supabase/migrations/` and are applied automatically on deploy.

Key tables: `organizations`, `organization_members`, `sites`,
`wordpress_posts`, `content_audits`, `content_scores`,
`content_recommendations`, `content_briefs`, `topical_clusters`,
`internal_link_opportunities`, `ai_visibility_tests`,
`approval_requests`, `background_jobs`, `audit_logs`, `tasks`,
`integration_connections`.

## Security Model

- **Row Level Security** is enabled on every business table. All access is
  scoped through `is_org_member(auth.uid(), organization_id)` and
  `has_org_role(auth.uid(), org_id, role)` security-definer helpers.
- **Roles** are stored in `user_roles` (global) and `organization_members`
  (per-workspace) — never on the `profiles` table — preventing privilege
  escalation.
- **Server functions** use `requireSupabaseAuth` so the bearer token is
  validated on every RPC. Org membership is re-checked server-side before
  any write.
- **Admin client** (`client.server.ts`) is restricted to webhooks and
  trusted server routes; it never enters client bundles.
- **Audit logs** capture sensitive actions and are readable only by org
  admins.

## Roadmap

- WordPress REST integration (live verification, post sync, draft push)
- Google Search Console + GA4 OAuth and metric ingestion
- AI audit engine wired to Lovable AI Gateway
- AEO/GEO live testing against Perplexity and Google AIO
- Approval workflow UI with diff view and one-click publish
- Stripe-based plans, seats and usage metering
- Background-jobs worker (pg_cron + TanStack server routes)

## License

MIT License — open source and free to use, modify, and contribute to.

See [LICENSE](./LICENSE) for full details.

## Contributing

We welcome contributions! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) to get started.
