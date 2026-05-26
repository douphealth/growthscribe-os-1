import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getScoreBreakdowns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        organizationId: z.string().uuid(),
        postId: z.string().uuid().optional(),
        siteId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).default(50),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase
      .from("score_breakdowns")
      .select("*")
      .eq("organization_id", data.organizationId)
      .order("computed_at", { ascending: false })
      .limit(data.limit);
    if (data.postId) q = q.eq("post_id", data.postId);
    if (data.siteId) q = q.eq("site_id", data.siteId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return { breakdowns: rows ?? [] };
  });