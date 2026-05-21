import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
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

const analyzeInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  url: z.string().url(),
});

function pick(html: string, re: RegExp) {
  const m = html.match(re);
  return m?.[1]?.trim() ?? null;
}
function pickAll(html: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) out.push(m[1].replace(/<[^>]+>/g, "").trim());
  }
  return out;
}

export const analyzeCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof analyzeInput>) => analyzeInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: SB; userId: string };
    await assertMember(supabase, userId, data.organizationId);

    const res = await fetch(data.url, {
      headers: { "User-Agent": "GrowthScribeBot/1.0 (+https://growthscribe-os.lovable.app)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Fetch ${res.status}`);
    const html = await res.text();

    const title = pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDesc = pick(
      html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    );
    const h1 = pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, "").trim() ?? null;
    const h2s = pickAll(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).slice(0, 25);
    const h3s = pickAll(html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi).slice(0, 25);

    const schemaTypes = new Set<string>();
    const jsonLdRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = jsonLdRe.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(m[1]);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const it of items) {
          const t = it?.["@type"];
          if (typeof t === "string") schemaTypes.add(t);
          else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && schemaTypes.add(x));
        }
      } catch {
        // ignore parse errors
      }
    }

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const wordCount = text ? text.split(/\s+/).length : 0;

    const host = new URL(data.url).hostname.replace(/^www\./, "");
    let internal = 0;
    let external = 0;
    const linkRe = /<a[^>]+href=["']([^"']+)["']/gi;
    while ((m = linkRe.exec(html)) !== null) {
      const href = m[1];
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      try {
        const u = new URL(href, data.url);
        if (u.hostname.replace(/^www\./, "") === host) internal++;
        else external++;
      } catch {
        // ignore
      }
    }

    const signals = {
      hasCanonical: /<link[^>]+rel=["']canonical["']/i.test(html),
      hasOgImage: /<meta[^>]+property=["']og:image["']/i.test(html),
      hasTwitterCard: /<meta[^>]+name=["']twitter:card["']/i.test(html),
      hasFaqSchema: schemaTypes.has("FAQPage"),
      hasArticleSchema: schemaTypes.has("Article") || schemaTypes.has("BlogPosting"),
      hasHowToSchema: schemaTypes.has("HowTo"),
      titleLength: title?.length ?? 0,
      metaDescriptionLength: metaDesc?.length ?? 0,
      h2Count: h2s.length,
      h3Count: h3s.length,
    };

    const { data: row, error } = await supabase
      .from("competitor_pages")
      .insert({
        organization_id: data.organizationId,
        site_id: data.siteId,
        competitor_domain: host,
        url: data.url,
        title,
        meta_description: metaDesc,
        h1,
        headings: { h2: h2s, h3: h3s } as unknown as Json,
        schema_types: Array.from(schemaTypes) as unknown as Json,
        word_count: wordCount,
        internal_links_count: internal,
        external_links_count: external,
        signals: signals as unknown as Json,
        analyzed_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;

    return { id: row.id, wordCount, schemaTypes: Array.from(schemaTypes), signals };
  });

const listInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const listCompetitorPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof listInput>) => listInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: SB; userId: string };
    await assertMember(supabase, userId, data.organizationId);
    const { data: rows, error } = await supabase
      .from("competitor_pages")
      .select(
        "id, competitor_domain, url, title, h1, word_count, schema_types, signals, analyzed_at",
      )
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .order("analyzed_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;
    return { rows: rows ?? [] };
  });