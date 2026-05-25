import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useOrg } from "@/lib/org-context";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowDownRight, ArrowUpRight, Minus, Sparkles, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getForecast, type ForecastMetric, type ForecastResponse } from "@/lib/forecast.functions";

export const Route = createFileRoute("/_authenticated/forecast")({
  component: ForecastPage,
  head: () => ({
    meta: [
      { title: "Forecast — GrowthScribe" },
      {
        name: "description",
        content: "Predictive 30/60/90-day traffic & revenue forecasts with seasonality and what-if simulation.",
      },
    ],
  }),
});

function fmt(n: number | null | undefined, unit: "count" | "currency" = "count", opts: { sign?: boolean } = {}) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = opts.sign && v > 0 ? "+" : "";
  if (unit === "currency") {
    return sign + v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }
  if (Math.abs(v) >= 1000) {
    return sign + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return sign + v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function Delta({ value, pct }: { value: number; pct: number }) {
  const Icon = value === 0 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const cls = value > 0 ? "text-emerald-600" : value < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 text-xs tabular-nums ${cls}`}>
      <Icon className="h-3 w-3" />
      {fmt(value, "count", { sign: true })} ({pct > 0 ? "+" : ""}
      {pct.toFixed(1)}%)
    </span>
  );
}

function MetricChart({ m, horizonDays }: { m: ForecastMetric; horizonDays: number }) {
  const data = useMemo(() => {
    return m.series.map((p) => ({
      date: p.date,
      actual: p.actual,
      forecast: p.forecast,
      whatIf: p.whatIf,
      band: p.lower != null && p.upper != null ? [p.lower, p.upper] : null,
    }));
  }, [m.series]);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">{m.label}</CardTitle>
            <CardDescription className="mt-1 flex flex-wrap items-center gap-3 text-xs">
              <span>Last 30: <span className="font-medium text-foreground">{fmt(m.summary.last30Actual, m.unit)}</span></span>
              <span>Next 30: <span className="font-medium text-foreground">{fmt(m.summary.next30Forecast, m.unit)}</span></span>
              <Delta value={m.summary.next30Delta} pct={m.summary.next30DeltaPct} />
              {m.summary.mape != null && (
                <Badge variant="outline" className="text-[10px]">MAPE {m.summary.mape.toFixed(1)}%</Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">
                Seasonality {(m.summary.seasonalityStrength * 100).toFixed(0)}%
              </Badge>
            </CardDescription>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>{horizonDays}-day forecast</div>
            <div className="font-medium text-foreground">{fmt(m.summary.horizonForecast, m.unit)}</div>
            {m.summary.next30WhatIf !== m.summary.next30Forecast && (
              <div className="text-emerald-600">
                What-if: {fmt(m.summary.horizonWhatIf, m.unit)}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`band-${m.metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(d) => String(d).slice(5)}
                minTickGap={28}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => (m.unit === "currency" ? `$${Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(0)}k` : v}` : String(v))}
                width={48}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(value: unknown, name: string) => {
                  if (value == null) return ["—", name];
                  if (Array.isArray(value)) return [`${fmt(value[0], m.unit)} – ${fmt(value[1], m.unit)}`, "80% interval"];
                  return [fmt(Number(value), m.unit), name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                type="monotone"
                dataKey="band"
                name="80% interval"
                stroke="none"
                fill={`url(#band-${m.metric})`}
                isAnimationActive={false}
              />
              <Line type="monotone" dataKey="actual" name="Actual" stroke="hsl(var(--foreground))" dot={false} strokeWidth={1.6} />
              <Line type="monotone" dataKey="forecast" name="Forecast" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.8} strokeDasharray="4 3" />
              <Line type="monotone" dataKey="whatIf" name="What-if" stroke="hsl(142 71% 45%)" dot={false} strokeWidth={1.6} strokeDasharray="2 2" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function ForecastPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const [siteId, setSiteId] = useState<string>("all");
  const [horizonDays, setHorizonDays] = useState<number>(90);
  const [whatIfLiftPct, setWhatIfLiftPct] = useState<number>(0);

  const sitesQ = useQuery({
    queryKey: ["sites-for-forecast", orgId],
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

  const forecastFn = useServerFn(getForecast);
  const fq = useQuery<ForecastResponse>({
    queryKey: ["forecast", orgId, siteId, horizonDays, whatIfLiftPct],
    enabled: !!orgId,
    queryFn: () =>
      forecastFn({
        data: {
          organizationId: orgId!,
          siteId: siteId === "all" ? undefined : siteId,
          horizonDays,
          lookbackDays: Math.max(horizonDays * 2, 90),
          whatIfLiftPct,
        },
      }),
  });

  if (!orgId) {
    return (
      <PageHeader
        title="Forecast"
        description="Select a workspace to view predictive traffic and revenue forecasts."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Predictive Forecast"
        description="30/60/90-day traffic and revenue projections with day-of-week seasonality and what-if simulation."
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Site</span>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger className="w-48 h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sites</SelectItem>
                {(sitesQ.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Horizon</span>
            <Tabs value={String(horizonDays)} onValueChange={(v) => setHorizonDays(Number(v))}>
              <TabsList className="h-9">
                <TabsTrigger value="30" className="text-xs">30d</TabsTrigger>
                <TabsTrigger value="60" className="text-xs">60d</TabsTrigger>
                <TabsTrigger value="90" className="text-xs">90d</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex min-w-64 flex-col gap-1">
            <span className="text-xs text-muted-foreground flex items-center justify-between">
              <span>What-if lift</span>
              <span className="font-medium text-foreground">
                {whatIfLiftPct > 0 ? "+" : ""}{whatIfLiftPct.toFixed(0)}%
              </span>
            </span>
            <Slider
              min={-20}
              max={50}
              step={1}
              value={[whatIfLiftPct]}
              onValueChange={([v]) => setWhatIfLiftPct(v)}
            />
          </div>
          {fq.data && fq.data.suggestedLiftPct > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setWhatIfLiftPct(fq.data!.suggestedLiftPct)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Apply {fq.data.openRecommendations} open recs (+{fq.data.suggestedLiftPct}%)
            </Button>
          )}
        </CardContent>
      </Card>

      {fq.isLoading && (
        <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">Computing forecast…</CardContent></Card>
      )}
      {fq.isError && (
        <Card><CardContent className="p-12 text-center text-sm text-destructive">{String((fq.error as Error)?.message ?? "Failed to compute forecast")}</CardContent></Card>
      )}

      {fq.data && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {fq.data.metrics.map((m) => {
              const trendUp = m.summary.trendPerDay > 0;
              return (
                <Card key={m.metric}>
                  <CardHeader className="pb-2">
                    <CardDescription className="text-xs">{m.label}</CardDescription>
                    <CardTitle className="text-2xl tabular-nums">
                      {fmt(m.summary.next30Forecast, m.unit)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center justify-between text-xs">
                      <Delta value={m.summary.next30Delta} pct={m.summary.next30DeltaPct} />
                      <span className={`inline-flex items-center gap-1 ${trendUp ? "text-emerald-600" : "text-muted-foreground"}`}>
                        <TrendingUp className="h-3 w-3" />
                        {m.summary.trendPerDay > 0 ? "+" : ""}{m.summary.trendPerDay.toFixed(2)}/day
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {fq.data.metrics.map((m) => (
              <MetricChart key={m.metric} m={m} horizonDays={fq.data!.horizonDays} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}