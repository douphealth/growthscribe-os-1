import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type SB = SupabaseClient<Database>;
async function assertMember(supabase: SB, userId: string, organizationId: string) {
  const { data, error } = await supabase
    .from("organization_members")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Not a member of this organization");
}

const gscInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  property: z.string().trim().min(4).max(300),
});

export const saveGscProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => gscInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    await supabase
      .from("integration_connections")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("provider", "gsc");
    const { error } = await supabase.from("integration_connections").insert({
      organization_id: data.organizationId,
      site_id: data.siteId,
      provider: "gsc",
      status: "connected",
      created_by: userId,
      config: { property: data.property } as Json,
    });
    if (error) throw error;
    await supabase
      .from("sites")
      .update({ gsc_property: data.property })
      .eq("id", data.siteId)
      .eq("organization_id", data.organizationId);
    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "integration.gsc.connected",
      title: "Search Console linked",
      description: data.property,
      link: "/integrations",
    });
    return { ok: true };
  });

const ga4Input = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  propertyId: z.string().trim().min(3).max(80),
});

export const saveGa4Property = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ga4Input.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    await supabase
      .from("integration_connections")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("provider", "ga4");
    const { error } = await supabase.from("integration_connections").insert({
      organization_id: data.organizationId,
      site_id: data.siteId,
      provider: "ga4",
      status: "connected",
      created_by: userId,
      config: { property_id: data.propertyId } as Json,
    });
    if (error) throw error;
    await supabase
      .from("sites")
      .update({ ga4_property_id: data.propertyId })
      .eq("id", data.siteId)
      .eq("organization_id", data.organizationId);
    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "integration.ga4.connected",
      title: "GA4 linked",
      description: data.propertyId,
      link: "/integrations",
    });
    return { ok: true };
  });
