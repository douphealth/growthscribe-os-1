import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Database } from "@/integrations/supabase/types";
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

const briefInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  title: z.string().min(3).max(200),
  targetKeyword: z.string().min(2).max(120).optional(),
});

type BriefResult = {
  search_intent: string;
  word_count_target: number;
  outline: { heading: string; level: number; notes: string }[];
  aeo_questions: string[];
  geo_signals: string[];
  internal_links: { anchor: string; rationale: string }[];
};

export const generateContentBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => briefInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    // Pull a small sample of existing posts for internal-link context
    const { data: posts } = await supabase
      .from("wordpress_posts")
      .select("title,url,excerpt")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .limit(40);

    const linkCandidates = (posts ?? [])
      .filter((p) => p.title)
      .map((p) => `- ${p.title} :: ${p.url}`)
      .join("\n");

    const result = await callLovableAIStructured<BriefResult>(
      "You are a senior content strategist producing actionable, SEO + AEO + GEO optimized content briefs. Be precise and structural.",
      `Brief title: ${data.title}\nTarget keyword: ${data.targetKeyword ?? "(none)"}\n\nExisting site pages (use for internal-link suggestions):\n${linkCandidates || "(none)"}`,
      "content_brief",
      {
        type: "object",
        properties: {
          search_intent: { type: "string", enum: ["informational", "commercial", "transactional", "navigational"] },
          word_count_target: { type: "integer", minimum: 300, maximum: 5000 },
          outline: {
            type: "array",
            items: {
              type: "object",
              properties: {
                heading: { type: "string" },
                level: { type: "integer", minimum: 1, maximum: 4 },
                notes: { type: "string" },
              },
              required: ["heading", "level", "notes"],
            },
          },
          aeo_questions: { type: "array", items: { type: "string" } },
          geo_signals: { type: "array", items: { type: "string" } },
          internal_links: {
            type: "array",
            items: {
              type: "object",
              properties: { anchor: { type: "string" }, rationale: { type: "string" } },
              required: ["anchor", "rationale"],
            },
          },
        },
        required: ["search_intent", "word_count_target", "outline", "aeo_questions", "geo_signals", "internal_links"],
      },
    );

    const { data: brief, error } = await supabase
      .from("content_briefs")
      .insert({
        organization_id: data.organizationId,
        site_id: data.siteId,
        owner_id: userId,
        title: data.title,
        target_keyword: data.targetKeyword ?? null,
        search_intent: result.search_intent,
        word_count_target: result.word_count_target,
        outline: result.outline as unknown as Json,
        aeo_questions: result.aeo_questions as unknown as Json,
        geo_signals: result.geo_signals as unknown as Json,
        internal_links: result.internal_links as unknown as Json,
        ai_generated: true,
      })
      .select("id")
      .single();
    if (error) throw error;

    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "brief.generated",
      title: `Brief generated: ${data.title}`,
      description: `${result.outline.length} sections · ${result.word_count_target} words target`,
      link: `/briefs`,
    });

    return { briefId: brief.id };
  });
