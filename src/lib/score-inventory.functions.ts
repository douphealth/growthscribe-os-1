import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreContent } from "./content-scoring";

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
  siteId: z.string().uuid().optional(),
  onlyMissing: z.boolean().optional().default(true),
});

export const scoreInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => input.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    let q = supabase
      .from("wordpress_posts")
      .select("id,title,excerpt,content_html,content_text,word_count,url,seo_score")
      .eq("organization_id", data.organizationId)
      .limit(2000);
    if (data.siteId) q = q.eq("site_id", data.siteId);
    if (data.onlyMissing) q = q.is("seo_score", null);

    const { data: rows, error } = await q;
    if (error) throw error;
    if (!rows || rows.length === 0) return { ok: true as const, scored: 0 };

    let scored = 0;
    for (const r of rows) {
      const s = scoreContent({
        title: r.title,
        excerpt: r.excerpt,
        contentHtml: r.content_html,
        contentText: r.content_text,
        wordCount: r.word_count,
        url: r.url,
      });
      const { error: upErr } = await supabase
        .from("wordpress_posts")
        .update({
          seo_score: s.seo_score,
          aeo_score: s.aeo_score,
          geo_score: s.geo_score,
        })
        .eq("id", r.id)
        .eq("organization_id", data.organizationId);
      if (!upErr) scored += 1;
    }

    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "inventory.scored",
      title: `Scored ${scored} posts`,
      description: "Computed SEO / AEO / GEO scores from synced content.",
      link: "/content-inventory",
    });

    return { ok: true as const, scored };
  });
