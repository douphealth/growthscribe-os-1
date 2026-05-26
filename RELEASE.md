# GrowthScribe OS v0.1.0

**Initial open-source release of GrowthScribe OS.**

## What's Included

- Multi-tenant workspace support with role-based access control
- Executive dashboard with site health and topical authority scores
- AI-driven content audits, briefs, and recommendations
- Topical maps and internal-link opportunity detection
- WordPress sync with approval-based draft publishing
- Google Search Console integration for metric ingestion
- AI visibility testing (AEO/GEO) across Google AIO, Perplexity, ChatGPT, and Claude
- Audit logs and editorial task workflows
- Background job engine with cron-triggered scans
- Full MIT license — open source and ready to contribute

## Tech Highlights

- React 19 + TanStack Start + Tailwind v4 + shadcn/ui
- TanStack server functions on Cloudflare Workers
- Lovable Cloud (Supabase) for Postgres, Auth, and RLS
- Lovable AI Gateway for Gemini, GPT-5, and Claude

## Install

```bash
bun install
cp .env.example .env
bun run dev
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [README.md](./README.md) for more.
