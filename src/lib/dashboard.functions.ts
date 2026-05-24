import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DashboardSummary = {
  sites: number;
  audits: number;
  open_tasks: number;
  briefs: number;
  monthly_clicks: number;
  monthly_impressions: number;
  recent_activities: Array<{
    id: string;
    type: string;
    title: string;
    description: string | null;
    link: string | null;
    created_at: string;
  }>;
  active_jobs: Array<{
    id: string;
    job_type: string;
    status: string;
    created_at: string;
    items_processed: number | null;
    total_items: number | null;
  }>;
};

export const getDashboardSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ organizationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<DashboardSummary> => {
    const { supabase } = context;
    const { data: result, error } = await supabase.rpc("get_dashboard_summary", {
      _org_id: data.organizationId,
    });
    if (error) throw new Error(error.message);
    return result as unknown as DashboardSummary;
  });