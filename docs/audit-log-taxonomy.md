# Audit Log Taxonomy

Every privileged action MUST insert a row into `public.audit_logs` with a
stable `action` string from the taxonomy below. This is what powers the
`/audit-logs` page, compliance exports, and incident review.

## Shape

```ts
{
  organization_id: uuid,    // workspace the action happened in
  actor_id: uuid,           // auth.users.id of the human / service account
  action: string,           // namespaced verb — see taxonomy
  resource_type: string,    // e.g. "site", "wordpress_post", "brief"
  resource_id: uuid | null, // primary key of the affected row
  metadata: jsonb,          // action-specific context (diff, counts, etc.)
  ip_address: text | null   // best-effort client IP
}
```

## Taxonomy

Format: `<domain>.<verb>` — present tense, dot-separated, lowercase.

### Workspace
- `org.create`, `org.update`, `org.delete`
- `org.member.invite`, `org.member.role_change`, `org.member.remove`

### Integrations
- `integration.connect` — metadata: `{ provider, scopes }`
- `integration.disconnect`
- `integration.token_refresh_failed`

### Sites
- `site.add`, `site.remove`
- `site.crawl.enqueue`, `site.crawl.complete`
- `site.vitals.refresh`

### Content
- `content.audit.run`, `content.audit.complete`
- `content.recommendation.create`, `content.recommendation.dismiss`
- `content.brief.generate`, `content.brief.publish`
- `topical.map.generate`

### WordPress writes (always paired with `wp_revisions` row)
- `wp.fix.apply` — metadata: `{ field, before, after, revision_id }`
- `wp.fix.rollback` — metadata: `{ revision_id }`
- `wp.post.publish`

### Approvals
- `approval.request`, `approval.approve`, `approval.reject`

### AI Visibility
- `ai_visibility.probe.run`, `ai_visibility.probe.complete`

### Security / Auth
- `auth.login`, `auth.logout`, `auth.password_change`
- `auth.mfa.enroll`, `auth.mfa.disable`

## Rules

- **Never** log secrets, full access tokens, or full request bodies in
  `metadata`. Hash or truncate.
- Privileged actions without a corresponding audit entry should fail code
  review.
- `wp.fix.apply` MUST include the `revision_id` so rollback can find the
  snapshot in `wp_revisions`.
- The `action` string is the contract — do not rename without a migration
  that backfills old rows.