import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ENQUEUEABLE = [
  "crawl.site",
  "vitals.refresh",
  "gsc_import",
  "ga4_import",
  "wp_sync",
  "wp_verify",
] as const;

const input = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid().optional(),
  jobType: z.enum(ENQUEUEABLE),
  payload: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().min(0).max(10).default(5),
});

/**
 * Enqueue a background job. The worker picks it up on the next tick
 * (scheduled every minute by pg_cron). RLS ensures the caller belongs to
 * the organization via the `Org members jobs` policy on background_jobs.
 */
export const enqueueJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => input.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("background_jobs")
      .insert({
        organization_id: data.organizationId,
        site_id: data.siteId ?? null,
        created_by: userId,
        job_type: data.jobType,
        payload: data.payload as never,
        status: "queued",
        priority: data.priority,
        next_run_at: new Date().toISOString(),
      })
      .select("id, job_type, status")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });