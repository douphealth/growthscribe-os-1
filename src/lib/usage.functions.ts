import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RecordSchema = z.object({
  organizationId: z.string().uuid(),
  eventType: z.string().min(1).max(80),
  quantity: z.number().int().min(1).max(10_000).default(1),
  metadata: z.record(z.any()).optional(),
});

export const recordUsageEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RecordSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("usage_events").insert({
      organization_id: data.organizationId,
      actor_id: userId,
      event_type: data.eventType,
      quantity: data.quantity,
      metadata: data.metadata ?? {},
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ListSchema = z.object({ organizationId: z.string().uuid() });

export const listUsageCounters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: counters, error } = await supabase
      .from("usage_counters")
      .select("event_type,period_month,total_quantity")
      .eq("organization_id", data.organizationId)
      .order("period_month", { ascending: false })
      .limit(120);
    if (error) throw new Error(error.message);
    return { counters: counters ?? [] };
  });