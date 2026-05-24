import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrg } from "@/lib/org-context";
import {
  getErrorEvents,
  getJobLogs,
  getAuditLogs,
  getObservabilitySummary,
} from "@/lib/observability.functions";

export const Route = createFileRoute("/_authenticated/observability")({
  component: Page,
});

type Since = "1h" | "24h" | "7d" | "30d";
type Level = "all" | "error" | "warn" | "info";
type Source = "all" | "server" | "client" | "worker";

function fmt(ts: string) {
  return new Date(ts).toLocaleString();
}

function levelBadge(level: string) {
  const v =
    level === "error" ? "destructive" : level === "warn" ? "secondary" : "outline";
  return <Badge variant={v as "destructive" | "secondary" | "outline"}>{level}</Badge>;
}

function Page() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const [since, setSince] = useState<Since>("24h");
  const [level, setLevel] = useState<Level>("all");
  const [source, setSource] = useState<Source>("all");

  const summaryFn = useServerFn(getObservabilitySummary);
  const errorsFn = useServerFn(getErrorEvents);
  const jobsFn = useServerFn(getJobLogs);
  const auditFn = useServerFn(getAuditLogs);

  const summary = useQuery({
    queryKey: ["obs-summary", orgId],
    queryFn: () => summaryFn({ data: { organizationId: orgId! } }),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });
  const errors = useQuery({
    queryKey: ["obs-errors", orgId, since, level, source],
    queryFn: () =>
      errorsFn({ data: { organizationId: orgId!, since, level, source, limit: 100 } }),
    enabled: !!orgId,
  });
  const jobs = useQuery({
    queryKey: ["obs-jobs", orgId, since, level],
    queryFn: () =>
      jobsFn({ data: { organizationId: orgId!, since, level, source: "all", limit: 100 } }),
    enabled: !!orgId,
  });
  const audit = useQuery({
    queryKey: ["obs-audit", orgId, since],
    queryFn: () =>
      auditFn({
        data: { organizationId: orgId!, since: since === "1h" ? "24h" : since, limit: 200 },
      }),
    enabled: !!orgId,
  });

  if (!orgId) {
    return <PageHeader title="Observability" description="Select a workspace to view telemetry." />;
  }

  return (
    <>
      <PageHeader
        title="Observability"
        description="Errors, job traces, and audit events for this workspace. Updated live."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Errors (1h)" value={summary.data?.errors_1h ?? 0} tone={summary.data?.errors_1h ? "alert" : "ok"} />
        <StatCard label="Errors (24h)" value={summary.data?.errors_24h ?? 0} />
        <StatCard label="Job failures (24h)" value={summary.data?.job_errors_24h ?? 0} />
        <StatCard label="Audit events (24h)" value={summary.data?.audit_events_24h ?? 0} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Top error messages (24h)</CardTitle></CardHeader>
          <CardContent>
            {(summary.data?.top_messages ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No errors in window.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {summary.data!.top_messages.map((m, i) => (
                  <li key={i} className="flex items-start justify-between gap-3">
                    <span className="line-clamp-2 font-mono">{m.message || "(empty)"}</span>
                    <Badge variant="outline" className="shrink-0">×{m.count}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Top routes (24h)</CardTitle></CardHeader>
          <CardContent>
            {(summary.data?.top_routes ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No errors in window.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {summary.data!.top_routes.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono">{r.route}</span>
                    <Badge variant="outline">×{r.count}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Filters:</span>
        <Select value={since} onValueChange={(v) => setSince(v as Since)}>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1h">Last 1h</SelectItem>
            <SelectItem value="24h">Last 24h</SelectItem>
            <SelectItem value="7d">Last 7d</SelectItem>
            <SelectItem value="30d">Last 30d</SelectItem>
          </SelectContent>
        </Select>
        <Select value={level} onValueChange={(v) => setLevel(v as Level)}>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="warn">Warn</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(v) => setSource(v as Source)}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="server">Server</SelectItem>
            <SelectItem value="client">Client</SelectItem>
            <SelectItem value="worker">Worker</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="errors" className="mt-4">
        <TabsList>
          <TabsTrigger value="errors">Error Events</TabsTrigger>
          <TabsTrigger value="jobs">Job Logs</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
        </TabsList>

        <TabsContent value="errors">
          <Card>
            <CardContent className="p-0">
              {errors.isLoading ? (
                <p className="p-6 text-xs text-muted-foreground">Loading…</p>
              ) : (errors.data ?? []).length === 0 ? (
                <p className="p-6 text-xs text-muted-foreground">No matching events.</p>
              ) : (
                <ul className="divide-y">
                  {errors.data!.map((e) => (
                    <li key={e.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            {levelBadge(e.level)}
                            <span>{e.source}</span>
                            {e.route && <span className="font-mono">{e.route}</span>}
                            {e.request_id && <span className="font-mono opacity-70">req {e.request_id.slice(0, 8)}</span>}
                            <span>{fmt(e.created_at)}</span>
                          </div>
                          <p className="mt-1 break-words font-mono text-xs">{e.message}</p>
                          {e.error_stack && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[11px] text-muted-foreground">Stack</summary>
                              <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[10px] leading-snug">{e.error_stack}</pre>
                            </details>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs">
          <Card>
            <CardContent className="p-0">
              {jobs.isLoading ? (
                <p className="p-6 text-xs text-muted-foreground">Loading…</p>
              ) : (jobs.data ?? []).length === 0 ? (
                <p className="p-6 text-xs text-muted-foreground">No job logs in window.</p>
              ) : (
                <ul className="divide-y">
                  {jobs.data!.map((j) => (
                    <li key={j.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {levelBadge(j.level)}
                        <span className="font-mono">job {j.job_id.slice(0, 8)}</span>
                        {j.request_id && <span className="font-mono opacity-70">req {j.request_id.slice(0, 8)}</span>}
                        {j.duration_ms != null && <span>{j.duration_ms}ms</span>}
                        <span>{fmt(j.created_at)}</span>
                      </div>
                      <p className="mt-1 break-words font-mono text-xs">{j.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardContent className="p-0">
              {audit.isLoading ? (
                <p className="p-6 text-xs text-muted-foreground">Loading…</p>
              ) : (audit.data ?? []).length === 0 ? (
                <p className="p-6 text-xs text-muted-foreground">No audit events in window. Admin-only.</p>
              ) : (
                <ul className="divide-y">
                  {audit.data!.map((a) => (
                    <li key={a.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <Badge variant="outline">{a.action}</Badge>
                        {a.resource_type && <span className="font-mono">{a.resource_type}</span>}
                        {a.resource_id && <span className="font-mono opacity-70">{a.resource_id.slice(0, 8)}</span>}
                        {a.ip_address && <span>{a.ip_address}</span>}
                        <span>{fmt(a.created_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "alert";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-2xl font-semibold ${
            tone === "alert" ? "text-destructive" : "text-foreground"
          }`}
        >
          {value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}