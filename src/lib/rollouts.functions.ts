import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type SB = SupabaseClient<Database>;

const STAGE_ORDER = ["dry_run", "stage_10", "stage_50", "stage_100"] as const;
type Stage = (typeof STAGE_ORDER)[number];
const STAGE_PCT: Record<Stage, number> = {
  dry_run: 0,
  stage_10: 10,
  stage_50: 50,
  stage_100: 100,
};

async function assertMember(supabase: SB, userId: string, organizationId: string) {
  const { data } = await supabase
    .from("organization_members")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) throw new Error("Not a member of this organization");
}

async function getBaselineClicks(supabase: SB, organizationId: string, siteId: string) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("search_console_daily")
    .select("clicks")
    .eq("organization_id", organizationId)
    .eq("site_id", siteId)
    .gte("date", since);
  return (data ?? []).reduce((s, r) => s + (r.clicks ?? 0), 0);
}

export const createRollout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        organizationId: z.string().uuid(),
        siteId: z.string().uuid(),
        name: z.string().min(1).max(120),
        recommendationIds: z.array(z.string().uuid()).min(1).max(2000),
        regressionThresholdPct: z.number().min(0).max(100).default(15),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: recs, error: rErr } = await supabase
      .from("content_recommendations")
      .select("id, post_id")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .in("id", data.recommendationIds);
    if (rErr) throw rErr;
    const items = (recs ?? []).filter((r) => r.post_id);
    if (items.length === 0) throw new Error("No valid recommendations with post_id");

    const baseline = await getBaselineClicks(supabase, data.organizationId, data.siteId);

    const { data: rollout, error: roErr } = await supabase
      .from("rollouts")
      .insert({
        organization_id: data.organizationId,
        site_id: data.siteId,
        name: data.name,
        status: "draft",
        current_stage: "dry_run",
        total_count: items.length,
        regression_threshold_pct: data.regressionThresholdPct,
        baseline_clicks: baseline,
        baseline_captured_at: new Date().toISOString(),
        created_by: userId,
      })
      .select("id")
      .single();
    if (roErr) throw roErr;

    const rows = items.map((r) => ({
      rollout_id: rollout.id,
      organization_id: data.organizationId,
      recommendation_id: r.id,
      post_id: r.post_id,
      stage: "dry_run",
      status: "pending",
    }));
    const { error: iErr } = await supabase.from("rollout_items").insert(rows);
    if (iErr) throw iErr;

    return { rolloutId: rollout.id, total: items.length, baseline };
  });

export const listRollouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({ organizationId: z.string().uuid(), siteId: z.string().uuid().optional() })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    let q = supabase
      .from("rollouts")
      .select("*")
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.siteId) q = q.eq("site_id", data.siteId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return { rollouts: rows ?? [] };
  });

export const getRollout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ organizationId: z.string().uuid(), rolloutId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const { data: rollout, error } = await supabase
      .from("rollouts")
      .select("*")
      .eq("id", data.rolloutId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!rollout) throw new Error("Rollout not found");

    const { data: items } = await supabase
      .from("rollout_items")
      .select("id, stage, status, post_id, recommendation_id, changeset_id, error, applied_at")
      .eq("rollout_id", data.rolloutId)
      .order("created_at", { ascending: true })
      .limit(2000);
    return { rollout, items: items ?? [] };
  });

export const advanceRolloutStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ organizationId: z.string().uuid(), rolloutId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: rollout, error } = await supabase
      .from("rollouts")
      .select("*")
      .eq("id", data.rolloutId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!rollout) throw new Error("Rollout not found");
    if (["completed", "rolled_back", "failed"].includes(rollout.status)) {
      throw new Error(`Rollout is ${rollout.status}; cannot advance.`);
    }

    const currentIdx = STAGE_ORDER.indexOf(rollout.current_stage as Stage);
    if (currentIdx < 0) throw new Error("Invalid current stage");
    const nextStage = STAGE_ORDER[currentIdx + 1];
    if (!nextStage) throw new Error("Already at final stage");

    // Regression check before advancing past dry_run
    if (currentIdx >= 1 && rollout.baseline_clicks && rollout.baseline_clicks > 0) {
      const current = await getBaselineClicks(supabase, data.organizationId, rollout.site_id);
      const dropPct = ((rollout.baseline_clicks - current) / rollout.baseline_clicks) * 100;
      if (dropPct > rollout.regression_threshold_pct) {
        await supabase
          .from("rollouts")
          .update({
            status: "failed",
            notes: `Aborted: traffic dropped ${dropPct.toFixed(1)}% (threshold ${rollout.regression_threshold_pct}%).`,
          })
          .eq("id", rollout.id);
        throw new Error(`Regression detected (${dropPct.toFixed(1)}% drop). Rollout halted.`);
      }
    }

    const targetPct = STAGE_PCT[nextStage];
    const targetCount = Math.max(
      1,
      Math.ceil((rollout.total_count * targetPct) / 100) - rollout.applied_count,
    );

    const { data: pending } = await supabase
      .from("rollout_items")
      .select("id, post_id")
      .eq("rollout_id", rollout.id)
      .eq("status", "pending")
      .limit(targetCount);

    const batch = pending ?? [];
    let enqueued = 0;
    for (const it of batch) {
      if (!it.post_id) continue;
      if (nextStage === "dry_run") {
        await supabase
          .from("rollout_items")
          .update({ stage: nextStage, status: "applied", applied_at: new Date().toISOString() })
          .eq("id", it.id);
      } else {
        const { data: job } = await supabase
          .from("background_jobs")
          .insert({
            organization_id: data.organizationId,
            site_id: rollout.site_id,
            created_by: userId,
            job_type: "audit_apply",
            payload: { post_id: it.post_id, rollout_item_id: it.id } as never,
            status: "queued",
            priority: 5,
            next_run_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        await supabase
          .from("rollout_items")
          .update({ stage: nextStage, status: "applied", job_id: job?.id ?? null, applied_at: new Date().toISOString() })
          .eq("id", it.id);
      }
      enqueued++;
    }

    const newApplied = rollout.applied_count + enqueued;
    const isFinal = nextStage === "stage_100" && newApplied >= rollout.total_count;
    await supabase
      .from("rollouts")
      .update({
        current_stage: nextStage,
        applied_count: newApplied,
        status: isFinal ? "completed" : nextStage === "dry_run" ? "dry_run" : "rolling_out",
      })
      .eq("id", rollout.id);

    return { advancedTo: nextStage, enqueued, applied: newApplied };
  });

export const rollbackRollout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ organizationId: z.string().uuid(), rolloutId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: items } = await supabase
      .from("rollout_items")
      .select("id, changeset_id")
      .eq("rollout_id", data.rolloutId)
      .eq("status", "applied");

    let rolled = 0;
    for (const it of items ?? []) {
      await supabase
        .from("rollout_items")
        .update({ status: "rolled_back" })
        .eq("id", it.id);
      rolled++;
    }

    await supabase
      .from("rollouts")
      .update({ status: "rolled_back", rolled_back_count: rolled })
      .eq("id", data.rolloutId)
      .eq("organization_id", data.organizationId);

    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "rollout.rolled_back",
      title: `Rolled back ${rolled} items`,
      description: "Bulk rollout reverted.",
      link: "/rollouts",
    });

    return { rolledBack: rolled };
  });

export const listOpenRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ organizationId: z.string().uuid(), siteId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const { data: recs, error } = await supabase
      .from("content_recommendations")
      .select("id, title, category, severity, post_id, created_at")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("status", "open")
      .not("post_id", "is", null)
      .order("severity", { ascending: false })
      .limit(500);
    if (error) throw error;
    return { recommendations: recs ?? [] };
  });