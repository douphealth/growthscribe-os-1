# Usage Metering

Tracks per-organization consumption of metered resources for plan limits
and billing surfacing.

## Tables

- `usage_events` — append-only ledger. One row per metered action.
- `usage_counters` — monthly rollup, maintained by an `AFTER INSERT`
  trigger (`record_usage_event`) so reads stay O(1).

## Event types (canonical)

| event_type            | unit          | recorded when                                  |
| --------------------- | ------------- | ---------------------------------------------- |
| `brief.generated`     | 1 per brief   | AI brief factory completes                     |
| `audit.run`           | 1 per page    | content audit finishes scoring a URL           |
| `crawl.urls`          | 1 per URL     | site crawler processes a URL                   |
| `ai_visibility.probe` | 1 per query   | AI Visibility Lab queries an LLM engine        |
| `wp.fix.applied`      | 1 per change  | a WordPress write succeeds                     |
| `gsc.rows_imported`   | rows ingested | GSC import job completes                       |

## Recording

Server functions only. Use `recordUsageEvent` from
`src/lib/usage.functions.ts`:

```ts
await recordUsageEvent({
  data: {
    organizationId,
    eventType: "brief.generated",
    quantity: 1,
    metadata: { briefId },
  },
});
```

RLS guarantees the actor is a member of the org; the trigger keeps the
monthly counter consistent.

## Reading

`listUsageCounters({ data: { organizationId } })` returns up to 120 rows
(10 years × 12 months) of `{ event_type, period_month, total_quantity }`.
The UI groups by `period_month` for the current month and shows trend
against the previous one.