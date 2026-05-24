import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  context: unknown;
};

export type JobLogRow = {
  id: string;
  job_id: string;
  created_at: string;
  level: string;
  message: string;
  request_id: string | null;
  duration_ms: number | null;
  metadata: unknown;
};

export type AuditLogRow = {
  id: string;
  created_at: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  actor_id: string | null;
  ip_address: string | null;
  metadata: unknown;
};

export type ObservabilitySummary = {
  errors_24h: number;
  errors_1h: number;
  job_errors_24h: number;
  audit_events_24h: number;
  top_routes: Array<{ route: string; count: number }>;
  top_messages: Array<{ message: string; count: number; last_seen: string }>;
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