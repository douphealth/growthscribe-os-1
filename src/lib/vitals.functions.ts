import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const orgSite = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
});

export type Strategy = "mobile" | "desktop";

export type VitalsRow = {
  id: string;
  url: string;
  strategy: Strategy;
  performance_score: number | null;
  lcp_ms: number | null;
  inp_ms: number | null;
  cls: number | null;
  ttfb_ms: number | null;
  fcp_ms: number | null;
  fetched_at: string;
  post_id: string | null;
};

export type VitalsSummary = {
  strategy: Strategy;
  measured_urls: number;
  avg_performance: number | null;
  // p75 distributions
  p75_lcp_ms: number | null;
  p75_cls: number | null;
  p75_inp_ms: number | null;
  // CWV pass/fail counts (Google thresholds)
  good_count: number;
  needs_improvement_count: number;
  poor_count: number;
  last_measured_at: string | null;
};

function p75(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const idx = Math.min(xs.length - 1, Math.floor(0.75 * (xs.length - 1)));
  return xs[idx];
}

function classifyCwv(r: Pick<VitalsRow, "lcp_ms" | "cls" | "inp_ms">): "good" | "ni" | "poor" {
  const lcp = r.lcp_ms ?? Infinity;
  const cls = r.cls ?? Infinity;
  const inp = r.inp_ms ?? Infinity;
  const lcpClass = lcp <= 2500 ? 0 : lcp <= 4000 ? 1 : 2;
  const clsClass = cls <= 0.1 ? 0 : cls <= 0.25 ? 1 : 2;
  const inpClass = inp <= 200 ? 0 : inp <= 500 ? 1 : 2;
  const worst = Math.max(lcpClass, clsClass, inpClass);
  return worst === 0 ? "good" : worst === 1 ? "ni" : "poor";
}

/**
 * Latest vitals snapshot per (url, strategy) for a site.
 */
export const getLatestVitals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => orgSite.parse(i))
  .handler(async ({ data, context }): Promise<VitalsRow[]> => {
    const { supabase } = context;
    // Pull recent rows then dedupe per (url, strategy) by latest fetched_at.
    const { data: rows, error } = await supabase
      .from("page_vitals")
      .select(
        "id, url, strategy, performance_score, lcp_ms, inp_ms, cls, ttfb_ms, fcp_ms, fetched_at, post_id",
      )
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .order("fetched_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const seen = new Set<string>();
    const out: VitalsRow[] = [];
    for (const r of rows ?? []) {
      const k = `${r.url}::${r.strategy}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r as VitalsRow);
    }
    return out;
  });

/**
 * Aggregate Core Web Vitals summary per strategy (mobile + desktop) for a site.
 */
export const getVitalsSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => orgSite.parse(i))
  .handler(async ({ data, context }): Promise<VitalsSummary[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("page_vitals")
      .select(
        "url, strategy, performance_score, lcp_ms, inp_ms, cls, fetched_at",
      )
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .order("fetched_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);

    const latestPerKey = new Map<string, (typeof rows)[number]>();
    for (const r of rows ?? []) {
      const k = `${r.url}::${r.strategy}`;
      if (!latestPerKey.has(k)) latestPerKey.set(k, r);
    }

    const result: VitalsSummary[] = [];
    for (const strategy of ["mobile", "desktop"] as const) {
      const items = Array.from(latestPerKey.values()).filter((r) => r.strategy === strategy);
      if (items.length === 0) {
        result.push({
          strategy,
          measured_urls: 0,
          avg_performance: null,
          p75_lcp_ms: null,
          p75_cls: null,
          p75_inp_ms: null,
          good_count: 0,
          needs_improvement_count: 0,
          poor_count: 0,
          last_measured_at: null,
        });
        continue;
      }
      const perfs = items
        .map((r) => r.performance_score)
        .filter((n): n is number => typeof n === "number");
      const lcps = items.map((r) => r.lcp_ms ?? NaN).filter((n) => Number.isFinite(n));
      const clss = items.map((r) => Number(r.cls ?? NaN)).filter((n) => Number.isFinite(n));
      const inps = items.map((r) => r.inp_ms ?? NaN).filter((n) => Number.isFinite(n));
      let good = 0,
        ni = 0,
        poor = 0;
      for (const r of items) {
        const c = classifyCwv({
          lcp_ms: r.lcp_ms,
          cls: r.cls == null ? null : Number(r.cls),
          inp_ms: r.inp_ms,
        });
        if (c === "good") good++;
        else if (c === "ni") ni++;
        else poor++;
      }
      const last = items.reduce<string | null>(
        (acc, r) => (!acc || r.fetched_at > acc ? r.fetched_at : acc),
        null,
      );
      result.push({
        strategy,
        measured_urls: items.length,
        avg_performance:
          perfs.length > 0
            ? Math.round(perfs.reduce((a, b) => a + b, 0) / perfs.length)
            : null,
        p75_lcp_ms: p75(lcps),
        p75_cls: (() => {
          const v = p75(clss);
          return v == null ? null : Number(v.toFixed(3));
        })(),
        p75_inp_ms: p75(inps),
        good_count: good,
        needs_improvement_count: ni,
        poor_count: poor,
        last_measured_at: last,
      });
    }
    return result;
  });

/**
 * Historical vitals for a single URL across both strategies (for charts).
 */
export const getVitalsTrend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        organizationId: z.string().uuid(),
        siteId: z.string().uuid(),
        url: z.string().url(),
        days: z.number().int().min(1).max(180).default(30),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: rows, error } = await supabase
      .from("page_vitals")
      .select("strategy, performance_score, lcp_ms, inp_ms, cls, fetched_at")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("url", data.url)
      .gte("fetched_at", since)
      .order("fetched_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
