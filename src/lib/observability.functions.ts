import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

const orgInput = z.object({
  organizationId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(100),
  level: z.enum(["all", "error", "warn", "info"]).default("all"),
  source: z.enum(["all", "server", "client", "worker"]).default("all"),
  since: z.enum(["1h", "24h", "7d", "30d"]).default("24h"),
});

function sinceTimestamp(s: "1h" | "24h" | "7d" | "30d"): string {
  const ms = { "1h": 3_600e3, "24h": 86_400e3, "7d": 7 * 86_400e3, "30d": 30 * 86_400e3 }[s];
  return new Date(Date.now() - ms).toISOString();
}

export type ErrorEventRow = {
  id: string;
  created_at: string;
  message: string;
  level: string;
  source: string;
  route: string | null;
  request_id: string | null;
  user_id: string | null;
  error_stack: string | null;
  context: Json;
};

export type JobLogRow = {
  id: string;
  job_id: string;
  created_at: string;
  level: string;
  message: string;
  request_id: string | null;
  duration_ms: number | null;
  metadata: Json;
};

export type AuditLogRow = {
  id: string;
  created_at: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  actor_id: string | null;
  ip_address: string | null;
  metadata: Json;
};

export type ObservabilitySummary = {
  errors_24h: number;
  errors_1h: number;
  job_errors_24h: number;
  audit_events_24h: number;
  top_routes: Array<{ route: string; count: number }>;
  top_messages: Array<{ message: string; count: number; last_seen: string }>;
};

export type AiCostSummary = {
  window: "24h" | "7d" | "30d";
  total_events: number;
  total_quantity: number;
  total_tokens: number;
  total_cost_usd: number;
  by_model: Array<{ model: string; events: number; tokens: number; cost_usd: number }>;
  by_event_type: Array<{ event_type: string; events: number; quantity: number }>;
  daily: Array<{ day: string; tokens: number; cost_usd: number }>;
};

export type SiteHealthSummary = {
  window: "24h" | "7d";
  error_rate_per_hour: number;
  job_failure_rate: number;
  jobs_total: number;
  jobs_failed: number;
  p50_duration_ms: number | null;
  p95_duration_ms: number | null;
  slo: {
    error_rate_ok: boolean;
    job_failure_rate_ok: boolean;
    p95_ok: boolean;
    overall_ok: boolean;
  };
  thresholds: { error_rate_per_hour: number; job_failure_rate: number; p95_duration_ms: number };
};

export const getErrorEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => orgInput.parse(i))
  .handler(async ({ data, context }): Promise<ErrorEventRow[]> => {
    const { supabase } = context;
    let q = supabase
      .from("error_events")
      .select(
        "id, created_at, message, level, source, route, request_id, user_id, error_stack, context",
      )
      .eq("organization_id", data.organizationId)
      .gte("created_at", sinceTimestamp(data.since))
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.level !== "all") q = q.eq("level", data.level);
    if (data.source !== "all") q = q.eq("source", data.source);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as ErrorEventRow[];
  });

export const getJobLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => orgInput.parse(i))
  .handler(async ({ data, context }): Promise<JobLogRow[]> => {
    const { supabase } = context;
    let q = supabase
      .from("job_logs")
      .select("id, job_id, created_at, level, message, request_id, duration_ms, metadata")
      .eq("organization_id", data.organizationId)
      .gte("created_at", sinceTimestamp(data.since))
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.level !== "all") q = q.eq("level", data.level);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as JobLogRow[];
  });

export const getAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        organizationId: z.string().uuid(),
        limit: z.number().int().min(1).max(500).default(200),
        since: z.enum(["1h", "24h", "7d", "30d"]).default("7d"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<AuditLogRow[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("audit_logs")
      .select("id, created_at, action, resource_type, resource_id, actor_id, ip_address, metadata")
      .eq("organization_id", data.organizationId)
      .gte("created_at", sinceTimestamp(data.since))
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return (rows ?? []) as AuditLogRow[];
  });

export const getObservabilitySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ organizationId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ObservabilitySummary> => {
    const { supabase } = context;
    const oneHourAgo = new Date(Date.now() - 3_600e3).toISOString();
    const dayAgo = new Date(Date.now() - 86_400e3).toISOString();

    const [errors24h, errors1h, jobErrors24h, audits24h, recent] = await Promise.all([
      supabase
        .from("error_events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId)
        .eq("level", "error")
        .gte("created_at", dayAgo),
      supabase
        .from("error_events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId)
        .eq("level", "error")
        .gte("created_at", oneHourAgo),
      supabase
        .from("job_logs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId)
        .eq("level", "error")
        .gte("created_at", dayAgo),
      supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId)
        .gte("created_at", dayAgo),
      supabase
        .from("error_events")
        .select("route, message, created_at")
        .eq("organization_id", data.organizationId)
        .gte("created_at", dayAgo)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const routeCounts = new Map<string, number>();
    const msgCounts = new Map<string, { count: number; last_seen: string }>();
    for (const r of recent.data ?? []) {
      const route = (r.route ?? "(unknown)").toString();
      routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1);
      const key = (r.message ?? "").toString().slice(0, 160);
      const prev = msgCounts.get(key);
      if (!prev) msgCounts.set(key, { count: 1, last_seen: r.created_at as string });
      else prev.count += 1;
    }

    return {
      errors_24h: errors24h.count ?? 0,
      errors_1h: errors1h.count ?? 0,
      job_errors_24h: jobErrors24h.count ?? 0,
      audit_events_24h: audits24h.count ?? 0,
      top_routes: Array.from(routeCounts.entries())
        .map(([route, count]) => ({ route, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      top_messages: Array.from(msgCounts.entries())
        .map(([message, v]) => ({ message, count: v.count, last_seen: v.last_seen }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };
  });

const windowInput = z.object({
  organizationId: z.string().uuid(),
  window: z.enum(["24h", "7d", "30d"]).default("7d"),
});

function windowMs(w: "24h" | "7d" | "30d"): number {
  return { "24h": 86_400e3, "7d": 7 * 86_400e3, "30d": 30 * 86_400e3 }[w];
}

export const getAiCostSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => windowInput.parse(i))
  .handler(async ({ data, context }): Promise<AiCostSummary> => {
    const { supabase } = context;
    const since = new Date(Date.now() - windowMs(data.window)).toISOString();
    const { data: rows, error } = await supabase
      .from("usage_events")
      .select("event_type, quantity, metadata, created_at")
      .eq("organization_id", data.organizationId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const ai = (rows ?? []).filter((r) => {
      const t = (r.event_type ?? "").toLowerCase();
      return t.includes("ai") || t.includes("llm") || t.includes("token") || t.includes("gemini") || t.includes("gpt");
    });

    let totalTokens = 0;
    let totalCost = 0;
    let totalQty = 0;
    const byModel = new Map<string, { events: number; tokens: number; cost_usd: number }>();
    const byType = new Map<string, { events: number; quantity: number }>();
    const daily = new Map<string, { tokens: number; cost_usd: number }>();

    for (const r of ai) {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      const model = typeof m.model === "string" ? m.model : "(unknown)";
      const tokens = Number(m.tokens ?? m.total_tokens ?? 0);
      const cost = Number(m.cost_usd ?? m.cost ?? 0);
      const qty = Number(r.quantity ?? 1);
      totalTokens += tokens;
      totalCost += cost;
      totalQty += qty;
      const mm = byModel.get(model) ?? { events: 0, tokens: 0, cost_usd: 0 };
      mm.events += 1;
      mm.tokens += tokens;
      mm.cost_usd += cost;
      byModel.set(model, mm);
      const tt = byType.get(r.event_type) ?? { events: 0, quantity: 0 };
      tt.events += 1;
      tt.quantity += qty;
      byType.set(r.event_type, tt);
      const day = (r.created_at as string).slice(0, 10);
      const dd = daily.get(day) ?? { tokens: 0, cost_usd: 0 };
      dd.tokens += tokens;
      dd.cost_usd += cost;
      daily.set(day, dd);
    }

    return {
      window: data.window,
      total_events: ai.length,
      total_quantity: totalQty,
      total_tokens: totalTokens,
      total_cost_usd: +totalCost.toFixed(4),
      by_model: Array.from(byModel.entries())
        .map(([model, v]) => ({ model, ...v, cost_usd: +v.cost_usd.toFixed(4) }))
        .sort((a, b) => b.cost_usd - a.cost_usd || b.tokens - a.tokens)
        .slice(0, 12),
      by_event_type: Array.from(byType.entries())
        .map(([event_type, v]) => ({ event_type, ...v }))
        .sort((a, b) => b.events - a.events)
        .slice(0, 12),
      daily: Array.from(daily.entries())
        .map(([day, v]) => ({ day, tokens: v.tokens, cost_usd: +v.cost_usd.toFixed(4) }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    };
  });

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

const slowThresholdMs = 30_000;
const slowErrorRatePerHour = 5;
const slowJobFailureRate = 0.05;

export const getSiteHealthSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      organizationId: z.string().uuid(),
      window: z.enum(["24h", "7d"]).default("24h"),
    }).parse(i),
  )
  .handler(async ({ data, context }): Promise<SiteHealthSummary> => {
    const { supabase } = context;
    const ms = data.window === "24h" ? 86_400e3 : 7 * 86_400e3;
    const since = new Date(Date.now() - ms).toISOString();
    const hours = ms / 3_600e3;

    const [errCount, jobsAll, jobsFailed, durRows] = await Promise.all([
      supabase
        .from("error_events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId)
        .eq("level", "error")
        .gte("created_at", since),
      supabase
        .from("background_jobs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId)
        .gte("created_at", since),
      supabase
        .from("background_jobs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId)
        .eq("status", "failed")
        .gte("created_at", since),
      supabase
        .from("job_logs")
        .select("duration_ms")
        .eq("organization_id", data.organizationId)
        .not("duration_ms", "is", null)
        .gte("created_at", since)
        .limit(2000),
    ]);

    const sorted = (durRows.data ?? [])
      .map((r) => Number(r.duration_ms))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);

    const errorRate = (errCount.count ?? 0) / hours;
    const jobsTotal = jobsAll.count ?? 0;
    const jobsFail = jobsFailed.count ?? 0;
    const failRate = jobsTotal === 0 ? 0 : jobsFail / jobsTotal;

    const slo = {
      error_rate_ok: errorRate <= slowErrorRatePerHour,
      job_failure_rate_ok: failRate <= slowJobFailureRate,
      p95_ok: p95 == null ? true : p95 <= slowThresholdMs,
    };

    return {
      window: data.window,
      error_rate_per_hour: +errorRate.toFixed(2),
      job_failure_rate: +failRate.toFixed(4),
      jobs_total: jobsTotal,
      jobs_failed: jobsFail,
      p50_duration_ms: p50,
      p95_duration_ms: p95,
      slo: { ...slo, overall_ok: slo.error_rate_ok && slo.job_failure_rate_ok && slo.p95_ok },
      thresholds: {
        error_rate_per_hour: slowErrorRatePerHour,
        job_failure_rate: slowJobFailureRate,
        p95_duration_ms: slowThresholdMs,
      },
    };
  });