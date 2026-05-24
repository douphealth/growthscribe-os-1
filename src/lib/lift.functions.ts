import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid().optional(),
  windowDays: z.number().int().min(1).max(90).default(28),
  limit: z.number().int().min(1).max(200).default(50),
});

export type LiftRow = {
  id: string;
  changeset_id: string;
  site_id: string;
  window_days: number;
  measured_at: string;
  baseline_clicks: number | null;
  post_clicks: number | null;
  clicks_delta: number | null;
  baseline_impressions: number | null;
  post_impressions: number | null;
  impressions_delta: number | null;
  baseline_position: number | null;
  post_position: number | null;
  position_delta: number | null;
  post_title?: string | null;
  post_url?: string | null;
};

export type LiftSummary = {
  total_changesets: number;
  measured_changesets: number;
  total_clicks_delta: number;
  total_impressions_delta: number;
  avg_position_delta: number | null;
  winners: number;
  losers: number;
  neutral: number;
};

export const getLiftSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => input.parse(i))
  .handler(async ({ data, context }): Promise<LiftSummary> => {
    const { supabase } = context;
    let q = supabase
      .from("lift_measurements")
      .select("clicks_delta, impressions_delta, position_delta, changeset_id")
      .eq("organization_id", data.organizationId)
      .eq("window_days", data.windowDays);
    if (data.siteId) q = q.eq("site_id", data.siteId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    let totalChanges = 0;
    {
      let cq = supabase
        .from("content_changesets")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId);
      if (data.siteId) cq = cq.eq("site_id", data.siteId);
      const r = await cq;
      totalChanges = r.count ?? 0;
    }

    let clicks = 0;
    let imps = 0;
    let posSum = 0;
    let posN = 0;
    let winners = 0;
    let losers = 0;
    let neutral = 0;
    for (const r of rows ?? []) {
      clicks += Number(r.clicks_delta ?? 0);
      imps += Number(r.impressions_delta ?? 0);
      if (r.position_delta != null) {
        posSum += Number(r.position_delta);
        posN += 1;
      }
      const cd = Number(r.clicks_delta ?? 0);
      if (cd > 0) winners += 1;
      else if (cd < 0) losers += 1;
      else neutral += 1;
    }
    return {
      total_changesets: totalChanges,
      measured_changesets: rows?.length ?? 0,
      total_clicks_delta: clicks,
      total_impressions_delta: imps,
      avg_position_delta: posN > 0 ? +(posSum / posN).toFixed(2) : null,
      winners,
      losers,
      neutral,
    };
  });

export const getRecentLift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => input.parse(i))
  .handler(async ({ data, context }): Promise<LiftRow[]> => {
    const { supabase } = context;
    let q = supabase
      .from("lift_measurements")
      .select(
        "id, changeset_id, site_id, window_days, measured_at, baseline_clicks, post_clicks, clicks_delta, baseline_impressions, post_impressions, impressions_delta, baseline_position, post_position, position_delta, content_changesets!inner(post_id, wordpress_posts(title, url))",
      )
      .eq("organization_id", data.organizationId)
      .eq("window_days", data.windowDays)
      .order("measured_at", { ascending: false })
      .limit(data.limit);
    if (data.siteId) q = q.eq("site_id", data.siteId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => {
      const cs = (r as unknown as { content_changesets?: { wordpress_posts?: { title?: string; url?: string } } }).content_changesets;
      return {
        id: r.id,
        changeset_id: r.changeset_id,
        site_id: r.site_id,
        window_days: r.window_days,
        measured_at: r.measured_at,
        baseline_clicks: r.baseline_clicks as number | null,
        post_clicks: r.post_clicks as number | null,
        clicks_delta: r.clicks_delta as number | null,
        baseline_impressions: r.baseline_impressions as number | null,
        post_impressions: r.post_impressions as number | null,
        impressions_delta: r.impressions_delta as number | null,
        baseline_position: r.baseline_position as number | null,
        post_position: r.post_position as number | null,
        position_delta: r.position_delta as number | null,
        post_title: cs?.wordpress_posts?.title ?? null,
        post_url: cs?.wordpress_posts?.url ?? null,
      };
    });
  });