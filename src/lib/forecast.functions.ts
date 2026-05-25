import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid().optional(),
  horizonDays: z.number().int().min(7).max(180).default(90),
  lookbackDays: z.number().int().min(28).max(365).default(180),
  whatIfLiftPct: z.number().min(-100).max(500).default(0),
});

export type ForecastPoint = {
  date: string;
  actual: number | null;
  forecast: number | null;
  lower: number | null;
  upper: number | null;
  whatIf: number | null;
};

export type ForecastMetric = {
  metric: "clicks" | "impressions" | "sessions" | "revenue";
  label: string;
  unit: "count" | "currency";
  series: ForecastPoint[];
  summary: {
    last30Actual: number;
    next30Forecast: number;
    next30Delta: number;
    next30DeltaPct: number;
    next30WhatIf: number;
    horizonForecast: number;
    horizonWhatIf: number;
    trendPerDay: number;
    seasonalityStrength: number; // 0..1
    mape: number | null; // backtest MAPE
  };
};

export type ForecastResponse = {
  generatedAt: string;
  horizonDays: number;
  lookbackDays: number;
  whatIfLiftPct: number;
  metrics: ForecastMetric[];
  openRecommendations: number;
  suggestedLiftPct: number;
};

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/**
 * Holt-Winters-lite forecast:
 *  - Aggregate to daily series
 *  - Compute multiplicative day-of-week seasonal factors (7-day cycle)
 *  - Fit OLS linear trend on de-seasonalized series
 *  - Forecast = (intercept + slope * t) * seasonal[dow]
 *  - 80% prediction band from residual stdev
 *  - Backtest MAPE on last 14 days (hold-out)
 */
function forecastSeries(
  daily: Map<string, number>,
  startDate: Date,
  endDate: Date,
  horizonDays: number,
  whatIfLiftPct: number,
): { series: ForecastPoint[]; trendPerDay: number; seasonalityStrength: number; mape: number | null } {
  // Build a dense series from startDate..endDate
  const dense: { date: Date; value: number }[] = [];
  for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {
    dense.push({ date: new Date(d), value: daily.get(toDateKey(d)) ?? 0 });
  }
  const n = dense.length;
  if (n < 14) {
    // Not enough history: emit empty forecast
    return { series: [], trendPerDay: 0, seasonalityStrength: 0, mape: null };
  }

  // Compute mean per day-of-week and overall mean
  const dowSum = [0, 0, 0, 0, 0, 0, 0];
  const dowCount = [0, 0, 0, 0, 0, 0, 0];
  let overallSum = 0;
  for (const p of dense) {
    const dow = p.date.getUTCDay();
    dowSum[dow] += p.value;
    dowCount[dow] += 1;
    overallSum += p.value;
  }
  const overallMean = overallSum / n || 1e-9;
  const seasonal = dowSum.map((s, i) => {
    const m = dowCount[i] ? s / dowCount[i] : overallMean;
    return overallMean > 0 ? m / overallMean : 1;
  });
  // Seasonality strength: variance of seasonal factors normalized
  const sMean = seasonal.reduce((a, b) => a + b, 0) / 7;
  const sVar = seasonal.reduce((a, b) => a + (b - sMean) ** 2, 0) / 7;
  const seasonalityStrength = Math.max(0, Math.min(1, Math.sqrt(sVar)));

  // De-seasonalize
  const deseason = dense.map((p) => {
    const f = seasonal[p.date.getUTCDay()] || 1;
    return p.value / (f || 1);
  });

  // OLS linear trend on deseason: y = a + b * t
  const xs = deseason.map((_, i) => i);
  const meanX = (n - 1) / 2;
  const meanY = deseason.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (deseason[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const intercept = meanY - slope * meanX;

  // Residual stdev on actuals
  let resSqSum = 0;
  for (let i = 0; i < n; i++) {
    const fit = (intercept + slope * i) * (seasonal[dense[i].date.getUTCDay()] || 1);
    resSqSum += (dense[i].value - fit) ** 2;
  }
  const resStd = Math.sqrt(resSqSum / Math.max(1, n - 2));

  // Backtest MAPE: train on first n-14, predict last 14
  let mape: number | null = null;
  if (n >= 42) {
    const trainN = n - 14;
    const trainXs = xs.slice(0, trainN);
    const trainDes = deseason.slice(0, trainN);
    const mX = trainXs.reduce((a, b) => a + b, 0) / trainN;
    const mY = trainDes.reduce((a, b) => a + b, 0) / trainN;
    let tn = 0;
    let td = 0;
    for (let i = 0; i < trainN; i++) {
      tn += (trainXs[i] - mX) * (trainDes[i] - mY);
      td += (trainXs[i] - mX) ** 2;
    }
    const tSlope = td > 0 ? tn / td : 0;
    const tIntercept = mY - tSlope * mX;
    let pct = 0;
    let cnt = 0;
    for (let i = trainN; i < n; i++) {
      const pred = Math.max(0, (tIntercept + tSlope * i) * (seasonal[dense[i].date.getUTCDay()] || 1));
      const act = dense[i].value;
      if (act > 0) {
        pct += Math.abs(act - pred) / act;
        cnt++;
      }
    }
    mape = cnt > 0 ? pct / cnt : null;
  }

  // Emit actuals
  const series: ForecastPoint[] = dense.map((p, i) => ({
    date: toDateKey(p.date),
    actual: p.value,
    forecast: null,
    lower: null,
    upper: null,
    whatIf: null,
  }));

  // Emit forecast for horizonDays after endDate
  for (let k = 1; k <= horizonDays; k++) {
    const futureDate = addDays(endDate, k);
    const t = n - 1 + k;
    const seas = seasonal[futureDate.getUTCDay()] || 1;
    const base = Math.max(0, (intercept + slope * t) * seas);
    // Widening interval: 1.28 * resStd * sqrt(1 + k/30)
    const halfWidth = 1.28 * resStd * Math.sqrt(1 + k / 30);
    const lift = whatIfLiftPct / 100;
    series.push({
      date: toDateKey(futureDate),
      actual: null,
      forecast: round(base),
      lower: round(Math.max(0, base - halfWidth)),
      upper: round(base + halfWidth),
      whatIf: round(Math.max(0, base * (1 + lift))),
    });
  }

  return { series, trendPerDay: slope, seasonalityStrength, mape };
}

function round(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function summarize(
  series: ForecastPoint[],
  trendPerDay: number,
  seasonalityStrength: number,
  mape: number | null,
  horizonDays: number,
): ForecastMetric["summary"] {
  const actuals = series.filter((p) => p.actual != null);
  const forecasts = series.filter((p) => p.forecast != null);
  const last30 = actuals.slice(-30).reduce((a, b) => a + (b.actual ?? 0), 0);
  const next30Forecast = forecasts.slice(0, 30).reduce((a, b) => a + (b.forecast ?? 0), 0);
  const next30WhatIf = forecasts.slice(0, 30).reduce((a, b) => a + (b.whatIf ?? 0), 0);
  const horizonForecast = forecasts.reduce((a, b) => a + (b.forecast ?? 0), 0);
  const horizonWhatIf = forecasts.reduce((a, b) => a + (b.whatIf ?? 0), 0);
  const delta = next30Forecast - last30;
  const deltaPct = last30 > 0 ? (delta / last30) * 100 : 0;
  return {
    last30Actual: round(last30),
    next30Forecast: round(next30Forecast),
    next30Delta: round(delta),
    next30DeltaPct: round(deltaPct),
    next30WhatIf: round(next30WhatIf),
    horizonForecast: round(horizonForecast),
    horizonWhatIf: round(horizonWhatIf),
    trendPerDay: round(trendPerDay),
    seasonalityStrength: round(seasonalityStrength),
    mape: mape == null ? null : round(mape * 100),
  };
}

export const getForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => input.parse(i))
  .handler(async ({ data, context }): Promise<ForecastResponse> => {
    const { supabase } = context;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const endDate = addDays(today, -1);
    const startDate = addDays(endDate, -(data.lookbackDays - 1));
    const startKey = toDateKey(startDate);
    const endKey = toDateKey(endDate);

    // Pull GSC
    let gscQ = supabase
      .from("search_console_daily")
      .select("date, clicks, impressions, site_id")
      .eq("organization_id", data.organizationId)
      .gte("date", startKey)
      .lte("date", endKey);
    if (data.siteId) gscQ = gscQ.eq("site_id", data.siteId);
    const { data: gscRows, error: gscErr } = await gscQ;
    if (gscErr) throw new Error(gscErr.message);

    // Pull GA4
    let gaQ = supabase
      .from("ga4_daily")
      .select("date, sessions, revenue, site_id")
      .eq("organization_id", data.organizationId)
      .gte("date", startKey)
      .lte("date", endKey);
    if (data.siteId) gaQ = gaQ.eq("site_id", data.siteId);
    const { data: gaRows, error: gaErr } = await gaQ;
    if (gaErr) throw new Error(gaErr.message);

    const clicksByDay = new Map<string, number>();
    const imprByDay = new Map<string, number>();
    for (const r of gscRows ?? []) {
      const k = String(r.date);
      clicksByDay.set(k, (clicksByDay.get(k) ?? 0) + (r.clicks ?? 0));
      imprByDay.set(k, (imprByDay.get(k) ?? 0) + (r.impressions ?? 0));
    }

    const sessByDay = new Map<string, number>();
    const revByDay = new Map<string, number>();
    for (const r of gaRows ?? []) {
      const k = String(r.date);
      sessByDay.set(k, (sessByDay.get(k) ?? 0) + (r.sessions ?? 0));
      revByDay.set(k, (revByDay.get(k) ?? 0) + Number(r.revenue ?? 0));
    }

    // Count open recommendations and suggest lift %
    let openCount = 0;
    let suggestedLift = 0;
    {
      let rq = supabase
        .from("content_recommendations")
        .select("id, severity", { count: "exact" })
        .eq("organization_id", data.organizationId)
        .in("severity", ["high", "critical", "medium"]);
      if (data.siteId) rq = rq.eq("site_id", data.siteId);
      const { data: recs, count } = await rq.limit(1000);
      openCount = count ?? recs?.length ?? 0;
      // Suggested lift: capped 18% — calibrated from typical SEO win rates
      const sevWeight = (recs ?? []).reduce((a, r) => {
        const s = String(r.severity);
        return a + (s === "critical" ? 1.5 : s === "high" ? 1 : 0.4);
      }, 0);
      suggestedLift = Math.min(18, Math.round(sevWeight * 0.6 * 10) / 10);
    }

    function build(
      map: Map<string, number>,
      metric: ForecastMetric["metric"],
      label: string,
      unit: ForecastMetric["unit"],
    ): ForecastMetric {
      const { series, trendPerDay, seasonalityStrength, mape } = forecastSeries(
        map,
        startDate,
        endDate,
        data.horizonDays,
        data.whatIfLiftPct,
      );
      return {
        metric,
        label,
        unit,
        series,
        summary: summarize(series, trendPerDay, seasonalityStrength, mape, data.horizonDays),
      };
    }

    return {
      generatedAt: new Date().toISOString(),
      horizonDays: data.horizonDays,
      lookbackDays: data.lookbackDays,
      whatIfLiftPct: data.whatIfLiftPct,
      openRecommendations: openCount,
      suggestedLiftPct: suggestedLift,
      metrics: [
        build(clicksByDay, "clicks", "Organic Clicks", "count"),
        build(imprByDay, "impressions", "Impressions", "count"),
        build(sessByDay, "sessions", "Sessions", "count"),
        build(revByDay, "revenue", "Revenue", "currency"),
      ],
    };
  });