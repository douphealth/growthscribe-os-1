import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useOrg } from "@/lib/org-context";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { getLiftSummary, getRecentLift } from "@/lib/lift.functions";

export const Route = createFileRoute("/_authenticated/lift")({
  component: LiftPage,
  head: () => ({
    meta: [
      { title: "Lift — GrowthScribe" },
      { name: "description", content: "ROI of approved changes: pre vs post traffic, impressions, and SERP position." },
    ],
  }),
});

function fmtNum(n: number | null | undefined, opts: { sign?: boolean } = {}) {
  if (n == null) return "—";
  const v = Number(n);
  const s = opts.sign && v > 0 ? "+" : "";
  return s + v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function DeltaCell({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const v = Number(value);
  const good = invert ? v < 0 : v > 0;
  const bad = invert ? v > 0 : v < 0;
  const Icon = v === 0 ? Minus : good ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${good ? "text-emerald-600" : bad ? "text-destructive" : "text-muted-foreground"}`}>
      <Icon className="h-3 w-3" />
      {fmtNum(v, { sign: true })}
    </span>
  );
}

function LiftPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const [siteId, setSiteId] = useState<string>("all");
  const [windowDays, setWindowDays] = useState<number>(28);

  const sites = useQuery({
    queryKey: ["sites-for-lift", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites")
        .select("id, name")
        .eq("organization_id", orgId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const summaryFn = useServerFn(getLiftSummary);
  const recentFn = useServerFn(getRecentLift);
  const filter = { organizationId: orgId!, windowDays, siteId: siteId === "all" ? undefined : siteId };

  const summary = useQuery({
    queryKey: ["lift-summary", orgId, siteId, windowDays],
    enabled: !!orgId,
    queryFn: () => summaryFn({ data: filter }),
  });
  const recent = useQuery({
    queryKey: ["lift-recent", orgId, siteId, windowDays],
    enabled: !!orgId,
    queryFn: () => recentFn({ data: { ...filter, limit: 100 } }),
  });

  if (!orgId) {
    return <PageHeader title="Lift" description="Select a workspace to view ROI of approved changes." />;
  }

  const s = summary.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lift measurement"
        description="Pre vs post traffic, impressions, and SERP-position delta for every approved changeset."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={siteId} onValueChange={setSiteId}>
          <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sites</SelectItem>
            {(sites.data ?? []).map((x) => (
              <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7-day window</SelectItem>
            <SelectItem value="14">14-day window</SelectItem>
            <SelectItem value="28">28-day window</SelectItem>
            <SelectItem value="56">56-day window</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Clicks Δ" value={fmtNum(s?.total_clicks_delta ?? 0, { sign: true })} tone={s && s.total_clicks_delta > 0 ? "good" : s && s.total_clicks_delta < 0 ? "bad" : "neutral"} />
        <Stat label="Impressions Δ" value={fmtNum(s?.total_impressions_delta ?? 0, { sign: true })} tone={s && s.total_impressions_delta > 0 ? "good" : s && s.total_impressions_delta < 0 ? "bad" : "neutral"} />
        <Stat label="Avg position Δ" value={s?.avg_position_delta != null ? fmtNum(s.avg_position_delta, { sign: true }) : "—"} tone={s?.avg_position_delta != null && s.avg_position_delta < 0 ? "good" : s?.avg_position_delta != null && s.avg_position_delta > 0 ? "bad" : "neutral"} />
        <Stat label="Measured / total" value={`${s?.measured_changesets ?? 0} / ${s?.total_changesets ?? 0}`} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Winners" value={String(s?.winners ?? 0)} tone="good" />
        <Stat label="Losers" value={String(s?.losers ?? 0)} tone="bad" />
        <Stat label="Neutral" value={String(s?.neutral ?? 0)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent measurements ({windowDays}d window)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recent.isLoading ? (
            <p className="p-6 text-xs text-muted-foreground">Loading…</p>
          ) : (recent.data ?? []).length === 0 ? (
            <p className="p-6 text-xs text-muted-foreground">
              No measurements yet. Lift is computed for each changeset once the post-change window completes.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-3 py-2">Post</th>
                    <th className="px-3 py-2">Measured</th>
                    <th className="px-3 py-2 text-right">Clicks Δ</th>
                    <th className="px-3 py-2 text-right">Impr. Δ</th>
                    <th className="px-3 py-2 text-right">Pos. Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recent.data!.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">
                        <div className="flex max-w-md flex-col">
                          <span className="truncate font-medium">{r.post_title ?? "(unknown post)"}</span>
                          {r.post_url && (
                            <a href={r.post_url} target="_blank" rel="noreferrer" className="truncate text-[10px] text-muted-foreground hover:underline">
                              {r.post_url}
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(r.measured_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right"><DeltaCell value={r.clicks_delta} /></td>
                      <td className="px-3 py-2 text-right"><DeltaCell value={r.impressions_delta} /></td>
                      <td className="px-3 py-2 text-right"><DeltaCell value={r.position_delta} invert /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        <Badge variant="outline" className="mr-2">How it works</Badge>
        For every approved changeset we snapshot Search Console metrics for the matched URL across the chosen window before and after the change, then store the delta in <code>lift_measurements</code>.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  const color = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}