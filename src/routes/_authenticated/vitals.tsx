import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Gauge, RefreshCw, Smartphone, Monitor, Activity } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import { supabase } from "@/integrations/supabase/client";
import {
  getLatestVitals,
  getVitalsSummary,
  type VitalsRow,
  type VitalsSummary,
  type Strategy,
} from "@/lib/vitals.functions";
import { enqueueJob } from "@/lib/jobs.functions";

export const Route = createFileRoute("/_authenticated/vitals")({
  component: VitalsPage,
});

type Site = { id: string; name: string; url: string | null };

const LCP_GOOD = 2500,
  LCP_NI = 4000;
const CLS_GOOD = 0.1,
  CLS_NI = 0.25;
const INP_GOOD = 200,
  INP_NI = 500;

function metricTone(
  v: number | null | undefined,
  good: number,
  ni: number,
): "good" | "ni" | "poor" | "none" {
  if (v == null || !Number.isFinite(v)) return "none";
  if (v <= good) return "good";
  if (v <= ni) return "ni";
  return "poor";
}

function toneClass(t: "good" | "ni" | "poor" | "none") {
  if (t === "good") return "text-emerald-600 dark:text-emerald-400";
  if (t === "ni") return "text-amber-600 dark:text-amber-400";
  if (t === "poor") return "text-destructive";
  return "text-muted-foreground";
}

function toneBadge(t: "good" | "ni" | "poor" | "none") {
  const v = t === "poor" ? "destructive" : t === "ni" ? "secondary" : "outline";
  const label = t === "good" ? "Good" : t === "ni" ? "Needs work" : t === "poor" ? "Poor" : "—";
  return <Badge variant={v as "destructive" | "secondary" | "outline"}>{label}</Badge>;
}

function fmtMs(v: number | null | undefined) {
  if (v == null) return "—";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(2)} s`;
}

function fmtCls(v: number | string | null | undefined) {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(3);
}

function fmtScore(v: number | null) {
  if (v == null) return "—";
  return `${v}`;
}

function VitalsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(10);
  const [filter, setFilter] = useState("");

  const sitesQ = useQuery<Site[]>({
    queryKey: ["sites", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites")
        .select("id, name, url")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (data && data.length > 0 && !siteId) setSiteId(data[0].id);
      return data ?? [];
    },
  });

  const summaryFn = useServerFn(getVitalsSummary);
  const latestFn = useServerFn(getLatestVitals);
  const enqueueFn = useServerFn(enqueueJob);

  const summaryQ = useQuery<VitalsSummary[]>({
    queryKey: ["vitals-summary", orgId, siteId],
    enabled: !!orgId && !!siteId,
    refetchInterval: 30_000,
    queryFn: () => summaryFn({ data: { organizationId: orgId!, siteId: siteId! } }),
  });

  const latestQ = useQuery<VitalsRow[]>({
    queryKey: ["vitals-latest", orgId, siteId],
    enabled: !!orgId && !!siteId,
    refetchInterval: 30_000,
    queryFn: () => latestFn({ data: { organizationId: orgId!, siteId: siteId! } }),
  });

  async function refreshVitals() {
    if (!orgId || !siteId) return;
    try {
      await enqueueFn({
        data: {
          organizationId: orgId,
          siteId,
          jobType: "vitals.refresh",
          payload: { limit },
          priority: 6,
        },
      });
      toast.success(`Queued PageSpeed scan for top ${limit} pages`, {
        description: "Results stream in as the worker completes each URL.",
      });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["vitals-summary", orgId, siteId] });
        qc.invalidateQueries({ queryKey: ["vitals-latest", orgId, siteId] });
      }, 2_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to queue scan");
    }
  }

  if (!orgId) {
    return <PageHeader title="Core Web Vitals" description="Select a workspace to view vitals." />;
  }

  const sites = sitesQ.data ?? [];
  const summaries = summaryQ.data ?? [];
  const summaryByStrategy: Record<Strategy, VitalsSummary | undefined> = {
    mobile: summaries.find((s) => s.strategy === "mobile"),
    desktop: summaries.find((s) => s.strategy === "desktop"),
  };

  const allRows = latestQ.data ?? [];
  const filteredRows = allRows.filter((r) =>
    !filter ? true : r.url.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Core Web Vitals"
        description="Real PageSpeed Insights field & lab data per URL, mobile and desktop. Powered by Google Lighthouse."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={siteId ?? undefined} onValueChange={(v) => setSiteId(v)}>
          <SelectTrigger className="h-9 w-64 text-xs">
            <SelectValue placeholder="Pick a site" />
          </SelectTrigger>
          <SelectContent>
            {sites.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-xs">
                {s.name} {s.url ? `· ${new URL(s.url).hostname}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
          <SelectTrigger className="h-9 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[5, 10, 25].map((n) => (
              <SelectItem key={n} value={String(n)} className="text-xs">
                Top {n} URLs
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={refreshVitals} disabled={!siteId} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Run PageSpeed scan
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Mobile-first thresholds. p75 = the 75th-percentile value across measured URLs.
        </span>
      </div>

      <Tabs defaultValue="mobile" className="mt-4">
        <TabsList>
          <TabsTrigger value="mobile" className="gap-1.5">
            <Smartphone className="h-3.5 w-3.5" /> Mobile
          </TabsTrigger>
          <TabsTrigger value="desktop" className="gap-1.5">
            <Monitor className="h-3.5 w-3.5" /> Desktop
          </TabsTrigger>
        </TabsList>
        {(["mobile", "desktop"] as const).map((strategy) => {
          const s = summaryByStrategy[strategy];
          const rows = filteredRows.filter((r) => r.strategy === strategy);
          return (
            <TabsContent key={strategy} value={strategy} className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <SummaryStat
                  label="Avg performance"
                  value={fmtScore(s?.avg_performance ?? null)}
                  hint={`${s?.measured_urls ?? 0} URLs measured`}
                  icon={<Gauge className="h-4 w-4" />}
                  tone={
                    s?.avg_performance == null
                      ? "none"
                      : s.avg_performance >= 90
                        ? "good"
                        : s.avg_performance >= 50
                          ? "ni"
                          : "poor"
                  }
                />
                <SummaryStat
                  label="p75 LCP"
                  value={fmtMs(s?.p75_lcp_ms ?? null)}
                  hint={`Good ≤ ${fmtMs(LCP_GOOD)}`}
                  icon={<Activity className="h-4 w-4" />}
                  tone={metricTone(s?.p75_lcp_ms ?? null, LCP_GOOD, LCP_NI)}
                />
                <SummaryStat
                  label="p75 CLS"
                  value={fmtCls(s?.p75_cls ?? null)}
                  hint={`Good ≤ ${CLS_GOOD}`}
                  icon={<Activity className="h-4 w-4" />}
                  tone={metricTone(s?.p75_cls ?? null, CLS_GOOD, CLS_NI)}
                />
                <SummaryStat
                  label="p75 INP"
                  value={fmtMs(s?.p75_inp_ms ?? null)}
                  hint={`Good ≤ ${INP_GOOD} ms`}
                  icon={<Activity className="h-4 w-4" />}
                  tone={metricTone(s?.p75_inp_ms ?? null, INP_GOOD, INP_NI)}
                />
              </div>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-sm">
                    CWV pass/fail · {strategy}
                  </CardTitle>
                  <span className="text-[11px] text-muted-foreground">
                    Last measured:{" "}
                    {s?.last_measured_at
                      ? new Date(s.last_measured_at).toLocaleString()
                      : "never"}
                  </span>
                </CardHeader>
                <CardContent className="pt-0">
                  <PassFailBar
                    good={s?.good_count ?? 0}
                    ni={s?.needs_improvement_count ?? 0}
                    poor={s?.poor_count ?? 0}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-sm">Per-URL latest</CardTitle>
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter URLs…"
                    className="h-8 w-56 text-xs"
                  />
                </CardHeader>
                <CardContent className="p-0">
                  {latestQ.isLoading ? (
                    <p className="p-6 text-xs text-muted-foreground">Loading…</p>
                  ) : rows.length === 0 ? (
                    <p className="p-6 text-xs text-muted-foreground">
                      No measurements yet for {strategy}. Run a PageSpeed scan above to populate.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2">URL</th>
                            <th className="px-3 py-2 text-right">Perf</th>
                            <th className="px-3 py-2 text-right">LCP</th>
                            <th className="px-3 py-2 text-right">CLS</th>
                            <th className="px-3 py-2 text-right">INP</th>
                            <th className="px-3 py-2 text-right">TTFB</th>
                            <th className="px-3 py-2">CWV</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {rows.map((r) => {
                            const lcpT = metricTone(r.lcp_ms, LCP_GOOD, LCP_NI);
                            const clsT = metricTone(
                              r.cls == null ? null : Number(r.cls),
                              CLS_GOOD,
                              CLS_NI,
                            );
                            const inpT = metricTone(r.inp_ms, INP_GOOD, INP_NI);
                            const worst: "good" | "ni" | "poor" | "none" = [
                              lcpT,
                              clsT,
                              inpT,
                            ].reduce<"good" | "ni" | "poor" | "none">((acc, t) => {
                              const rank = (x: typeof acc) =>
                                x === "poor" ? 3 : x === "ni" ? 2 : x === "good" ? 1 : 0;
                              return rank(t) > rank(acc) ? t : acc;
                            }, "none");
                            return (
                              <tr key={r.id} className="hover:bg-muted/30">
                                <td className="px-3 py-2">
                                  <a
                                    href={r.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-mono text-[11px] text-foreground hover:underline"
                                  >
                                    {(() => {
                                      try {
                                        const u = new URL(r.url);
                                        return u.pathname + (u.search || "");
                                      } catch {
                                        return r.url;
                                      }
                                    })()}
                                  </a>
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  <span className={toneClass(
                                    r.performance_score == null
                                      ? "none"
                                      : r.performance_score >= 90
                                        ? "good"
                                        : r.performance_score >= 50
                                          ? "ni"
                                          : "poor",
                                  )}>
                                    {fmtScore(r.performance_score)}
                                  </span>
                                </td>
                                <td className={`px-3 py-2 text-right tabular-nums ${toneClass(lcpT)}`}>
                                  {fmtMs(r.lcp_ms)}
                                </td>
                                <td className={`px-3 py-2 text-right tabular-nums ${toneClass(clsT)}`}>
                                  {fmtCls(r.cls)}
                                </td>
                                <td className={`px-3 py-2 text-right tabular-nums ${toneClass(inpT)}`}>
                                  {fmtMs(r.inp_ms)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                  {fmtMs(r.ttfb_ms)}
                                </td>
                                <td className="px-3 py-2">{toneBadge(worst)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone: "good" | "ni" | "poor" | "none";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
          <span className="text-muted-foreground/60">{icon}</span>
        </div>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass(tone)}`}>{value}</p>
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function PassFailBar({
  good,
  ni,
  poor,
}: {
  good: number;
  ni: number;
  poor: number;
}) {
  const total = good + ni + poor;
  if (total === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No URLs measured yet — run a PageSpeed scan to populate this view.
      </p>
    );
  }
  const gPct = (good / total) * 100;
  const nPct = (ni / total) * 100;
  const pPct = (poor / total) * 100;
  return (
    <div className="space-y-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        <div style={{ width: `${gPct}%` }} className="bg-emerald-500" title={`Good: ${good}`} />
        <div style={{ width: `${nPct}%` }} className="bg-amber-500" title={`Needs improvement: ${ni}`} />
        <div style={{ width: `${pPct}%` }} className="bg-destructive" title={`Poor: ${poor}`} />
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> {good} good
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500" /> {ni} needs improvement
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-destructive" /> {poor} poor
        </span>
      </div>
    </div>
  );
}
