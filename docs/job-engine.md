# Background Job Engine

The cron worker at `/api/public/cron/worker` drains `background_jobs` every
60 seconds via pg_cron. As of Pass 1 it supports retry with exponential
backoff, per-org concurrency caps, idempotency keys, and structured
per-job logs.

## Lifecycle

`queued` → atomic claim → `running` → either `succeeded` or
(if `retry_count < max_retries`) back to `queued` with
`next_run_at = now() + 30s * 2^retry_count` — otherwise terminal `failed`.

## Columns added in Pass 1

| Column | Purpose |
| --- | --- |
| `retry_count` / `max_retries` | Attempt accounting; default max = 3 |
| `last_error` | Last error message (separate from final `error`) |
| `idempotency_key` | Unique per `(organization_id, idempotency_key)` |
| `priority` | Higher value claimed first |
| `scheduled_at` / `next_run_at` | Worker only picks jobs where `next_run_at <= now()` |
| `locked_at` / `locked_by` | Identifies which worker holds the job |

## Logs

Every job lifecycle event writes to `job_logs` (job_id, level, message,
metadata). RLS-scoped to org members.

## Realtime

`background_jobs` and `job_logs` are published to `supabase_realtime`. The
`ActiveJobsBanner` component subscribes per organization.

## Reaping stuck jobs

Jobs `running` for more than 10 minutes are returned to `queued` with a
`last_error` of `"reaped: ..."`, so they get retried instead of stranded.