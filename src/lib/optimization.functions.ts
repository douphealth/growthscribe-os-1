import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { rollbackWpRevision } from "./auto-apply.server";

export const enqueueFullOptimization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ organizationId: z.string().uuid(), siteId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: res, error } = await supabase.rpc("enqueue_full_optimization", {
      _org_id: data.organizationId,
      _site_id: data.siteId,
    });
    if (error) throw error;
    return res as { enqueued: number };
  });

export const getOptimizationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ organizationId: z.string().uuid(), siteId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: res, error } = await supabase.rpc("get_optimization_status", {
      _org_id: data.organizationId,
      _site_id: data.siteId,
    });
    if (error) throw error;
    return (res ?? {}) as Record<string, number | string | null>;
  });

export const toggleAutoApply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        organizationId: z.string().uuid(),
        mode: z.enum(["full", "draft_only", "paused"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("auto_apply_settings")
      .upsert(
        {
          organization_id: data.organizationId,
          mode: data.mode,
          paused: data.mode === "paused",
          updated_at: new Date().toISOString(),
          updated_by: userId,
        },
        { onConflict: "organization_id" },
      );
    if (error) throw error;
    return { ok: true };
  });

export const rollbackRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ revisionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const { data: rev } = await supabase
      .from("wp_revisions")
      .select("organization_id")
      .eq("id", data.revisionId)
      .maybeSingle();
    if (!rev) throw new Error("Revision not found");
    return rollbackWpRevision(supabaseAdmin, data.revisionId, userId);
  });