# Role Permission Matrix

GrowthScribe OS uses **organization-scoped roles** stored in
`organization_members.role` (enum `org_role`). The matrix below is the source
of truth for what each role can do. RLS policies and server functions must
match this table.

| Capability                                      | Owner | Admin | Editor | Analyst | Viewer |
| ----------------------------------------------- | :---: | :---: | :----: | :-----: | :----: |
| View workspace dashboards / scores              |  ✓    |  ✓    |   ✓    |    ✓    |   ✓    |
| Connect / disconnect WordPress + GSC + GA4      |  ✓    |  ✓    |        |         |        |
| Run crawl / GSC import / vitals jobs            |  ✓    |  ✓    |   ✓    |    ✓    |        |
| Generate AI briefs                              |  ✓    |  ✓    |   ✓    |         |        |
| Approve recommendations                         |  ✓    |  ✓    |   ✓    |         |        |
| Apply changes to WordPress (write)              |  ✓    |  ✓    |   ✓    |         |        |
| Rollback WordPress revisions                    |  ✓    |  ✓    |        |         |        |
| Manage members / roles / billing                |  ✓    |  ✓    |        |         |        |
| Read audit logs                                 |  ✓    |  ✓    |        |         |        |
| Read usage counters (own org)                   |  ✓    |  ✓    |   ✓    |    ✓    |   ✓    |
| Delete site / workspace                         |  ✓    |        |        |         |        |

## Enforcement

- **Database** — every table has RLS keyed off `is_org_member` /
  `is_org_admin` security-definer helpers. Never check roles client-side
  before a write; always rely on RLS.
- **Server functions** — protected functions use `requireSupabaseAuth`. For
  write-only capabilities (apply fix, approve, rollback), re-check the role
  in the handler before mutating.
- **UI** — hide actions the current role cannot perform, but treat UI
  gating as UX-only. The actual block must always be in the database or
  server function.

## Adding a new capability

1. Add a row to this table with the role columns ticked.
2. Add or update the RLS policy on the affected table.
3. If the action runs through a server function, add an explicit role check
   inside `.handler()` before mutating.
4. Add an audit-log entry (see `docs/audit-log-taxonomy.md`).