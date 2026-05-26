import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useOrg } from "@/lib/org-context";
import { listUsageCounters } from "@/lib/usage.functions";
import { Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Page,
});

const EVENT_LABELS: Record<string, string> = {
  "brief.generated": "Briefs generated",
  "audit.run": "Content audits",
  "crawl.urls": "URLs crawled",
  "ai_visibility.probe": "AI visibility probes",
  "wp.fix.applied": "WordPress writes",
  "gsc.rows_imported": "Search Console rows",
  "vitals.measured": "Vitals measured",
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function previousMonth(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function UsagePanel() {
  const { currentOrg } = useOrg();
  const fn = useServerFn(listUsageCounters);
  const { data, isLoading } = useQuery({
    queryKey: ["usage-counters", currentOrg?.id],
    queryFn: () => fn({ data: { organizationId: currentOrg!.id } }),
    enabled: !!currentOrg?.id,
  });

  if (!currentOrg) {
    return (
      <Card>
        <CardContent className="p-8 text-sm text-muted-foreground">
          Select a workspace to view usage.
        </CardContent>
      </Card>
    );
  }

  const thisMonth = currentMonth();
  const lastMonth = previousMonth();
  const counters = data?.counters ?? [];
  const byType = new Map<string, { current: number; previous: number }>();
  for (const c of counters) {
    const slot = byType.get(c.event_type) ?? { current: 0, previous: 0 };
    if (c.period_month === thisMonth) slot.current = c.total_quantity;
    if (c.period_month === lastMonth) slot.previous = c.total_quantity;
    byType.set(c.event_type, slot);
  }
  const knownTypes = Object.keys(EVENT_LABELS);
  const allTypes = Array.from(new Set([...knownTypes, ...byType.keys()]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4" /> Usage this month
        </CardTitle>
        <CardDescription>
          Per-workspace consumption rolled up from background jobs and writes. See{" "}
          <code className="font-mono text-xs">docs/usage-metering.md</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {allTypes.map((t) => {
              const slot = byType.get(t) ?? { current: 0, previous: 0 };
              const delta = slot.current - slot.previous;
              const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
              const tone =
                delta > 0 ? "text-emerald-500" : delta < 0 ? "text-rose-500" : "text-muted-foreground";
              return (
                <div key={t} className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{EVENT_LABELS[t] ?? t}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {t}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tabular-nums">{slot.current}</span>
                    <span className={`flex items-center gap-1 text-xs ${tone}`}>
                      <Icon className="h-3 w-3" />
                      {delta === 0 ? "no change" : `${delta > 0 ? "+" : ""}${delta} vs last`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Workspace, members, billing, and usage." />
      <UsagePanel />
      <Card>
        <CardHeader>
          <CardTitle>Workspace & members</CardTitle>
          <CardDescription>
            Roles follow the matrix in <code className="font-mono text-xs">docs/permissions.md</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Member management UI is being wired up. The data model, RLS, role enforcement, and
          server functions are already in place.
        </CardContent>
      </Card>
    </div>
  );
}
