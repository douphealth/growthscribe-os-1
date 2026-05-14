import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callLovableAIStructured } from "./ai-gateway";

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

const input = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
});

type MapResult = {
  pillars: {
    pillar: string;
    intent: string;
    coverage_status: "covered" | "partial" | "gap";
    priority: number;
    clusters: {
      cluster: string;
      intent: string;
      coverage_status: "covered" | "partial" | "gap";
      priority: number;
    }[];
  }[];
};

export const generateTopicalMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => input.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: posts, error: pErr } = await supabase
      .from("wordpress_posts")
      .select("title,excerpt,categories,tags")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .limit(150);
    if (pErr) throw pErr;
    if (!posts || posts.length === 0) {
      throw new Error("Sync WordPress content first — no posts found for this site.");
    }

    const corpus = posts
      .map((p) => `- ${p.title ?? "Untitled"} | ${(p.excerpt ?? "").slice(0, 140)}`)
      .join("\n")
      .slice(0, 16000);

    const result = await callLovableAIStructured<MapResult>(
      "You are a topical-authority strategist. Cluster the site's content into 4–8 pillar topics with 3–6 supporting clusters each. Mark each as covered, partial, or gap based on the corpus.",
      `Site corpus (titles + excerpts):\n${corpus}`,
      "topical_map",
      {
        type: "object",
        properties: {
          pillars: {
            type: "array",
            items: {
              type: "object",
              properties: {
                pillar: { type: "string" },
                intent: { type: "string" },
                coverage_status: { type: "string", enum: ["covered", "partial", "gap"] },
                priority: { type: "integer", minimum: 0, maximum: 10 },
                clusters: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      cluster: { type: "string" },
                      intent: { type: "string" },
                      coverage_status: { type: "string", enum: ["covered", "partial", "gap"] },
                      priority: { type: "integer", minimum: 0, maximum: 10 },
                    },
                    required: ["cluster", "intent", "coverage_status", "priority"],
                  },
                },
              },
              required: ["pillar", "intent", "coverage_status", "priority", "clusters"],
            },
          },
        },
        required: ["pillars"],
      },
    );

    // Replace existing map for this site
    await supabase
      .from("topical_maps")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId);

    let inserted = 0;
    for (const p of result.pillars) {
      const { data: pillarRow, error: pErr2 } = await supabase
        .from("topical_maps")
        .insert({
          organization_id: data.organizationId,
          site_id: data.siteId,
          owner_id: userId,
          pillar: p.pillar,
          intent: p.intent,
          coverage_status: p.coverage_status,
          priority: p.priority,
        })
        .select("id")
        .single();
      if (pErr2) throw pErr2;
      inserted++;
      if (p.clusters.length > 0) {
        const rows = p.clusters.map((c) => ({
          organization_id: data.organizationId,
          site_id: data.siteId,
          owner_id: userId,
          pillar: p.pillar,
          cluster: c.cluster,
          parent_id: pillarRow.id,
          intent: c.intent,
          coverage_status: c.coverage_status,
          priority: c.priority,
        }));
        const { error: cErr } = await supabase.from("topical_maps").insert(rows);
        if (cErr) throw cErr;
        inserted += rows.length;
      }
    }

    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "topical_map.generated",
      title: "Topical map generated",
      description: `${result.pillars.length} pillars · ${inserted} nodes`,
      link: `/topical-maps`,
    });

    return { pillars: result.pillars.length, nodes: inserted };
  });
