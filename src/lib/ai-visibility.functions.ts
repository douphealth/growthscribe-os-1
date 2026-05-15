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

const ENGINES = ["gpt", "gemini", "perplexity"] as const;
type Engine = (typeof ENGINES)[number];

const ENGINE_MODELS: Record<Engine, string> = {
  gpt: "openai/gpt-5-mini",
  gemini: "google/gemini-2.5-flash",
  perplexity: "google/gemini-2.5-pro", // proxy via gateway
};

const SYS_PROMPT = `You are simulating a search-style answer engine. Given a user query, respond with the answer you would naturally produce, including any sources or citations you would normally surface (URLs, brand names). Do NOT add disclaimers about being an AI or about real-time access. Always include a "Sources:" line at the end listing 3-7 distinct domains in plain text (one per line, format: domain - short reason). If you genuinely have no candidates, return "Sources: none".`;

async function callGateway(model: string, query: string): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYS_PROMPT },
        { role: "user", content: query },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gateway ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.replace(/^www\./, "").toLowerCase();
  }
}

function findMention(content: string, siteHost: string) {
  const lower = content.toLowerCase();
  const host = siteHost.toLowerCase();
  const bare = host.replace(/^www\./, "");
  const root = bare.split(".").slice(-2).join(".");
  const appears = lower.includes(bare) || lower.includes(root);
  // try to extract a citation URL
  const urlRegex = /https?:\/\/[^\s)\]]+/gi;
  const urls = Array.from(content.matchAll(urlRegex)).map((m) => m[0]);
  const citation = urls.find((u) => hostOf(u).endsWith(root)) ?? null;
  // crude rank: order of first occurrence in "Sources:" block
  let rank: number | null = null;
  const srcIdx = lower.lastIndexOf("sources:");
  if (appears && srcIdx >= 0) {
    const block = content.slice(srcIdx);
    const lines = block
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean);
    const idx = lines.findIndex((l) => l.toLowerCase().includes(root));
    if (idx >= 0) rank = idx + 1;
  }
  return { appears, citation, rank };
}

const runInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  queries: z.array(z.string().trim().min(2).max(300)).min(1).max(10),
  engines: z
    .array(z.enum(ENGINES))
    .min(1)
    .default([...ENGINES]),
});

export const runAiVisibilityTests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof runInput>) => runInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: SB; userId: string };
    await assertMember(supabase, userId, data.organizationId);

    const { data: site, error: siteErr } = await supabase
      .from("sites")
      .select("id, organization_id, url, name")
      .eq("id", data.siteId)
      .maybeSingle();
    if (siteErr) throw siteErr;
    if (!site || site.organization_id !== data.organizationId) {
      throw new Error("Site not found");
    }
    const siteHost = hostOf(site.url);

    const rows: Array<{
      organization_id: string;
      site_id: string;
      query: string;
      engine: string;
      appears: boolean;
      rank: number | null;
      citation_url: string | null;
      raw_response: Json;
    }> = [];

    for (const query of data.queries) {
      for (const engine of data.engines) {
        try {
          const content = await callGateway(ENGINE_MODELS[engine], query);
          const { appears, citation, rank } = findMention(content, siteHost);
          rows.push({
            organization_id: data.organizationId,
            site_id: data.siteId,
            query,
            engine,
            appears,
            rank,
            citation_url: citation,
            raw_response: { content } as Json,
          });
        } catch (err) {
          rows.push({
            organization_id: data.organizationId,
            site_id: data.siteId,
            query,
            engine,
            appears: false,
            rank: null,
            citation_url: null,
            raw_response: { error: err instanceof Error ? err.message : String(err) } as Json,
          });
        }
      }
    }

    const { error: insErr } = await supabase.from("ai_visibility_tests").insert(rows);
    if (insErr) throw insErr;

    const total = rows.length;
    const hits = rows.filter((r) => r.appears).length;
    return {
      ok: true,
      total,
      hits,
      coverage: total ? hits / total : 0,
      rows,
    };
  });

const listInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const listAiVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof listInput>) => listInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: SB; userId: string };
    await assertMember(supabase, userId, data.organizationId);
    const { data: rows, error } = await supabase
      .from("ai_visibility_tests")
      .select("id, query, engine, appears, rank, citation_url, tested_at")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .order("tested_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;

    const byEngine: Record<string, { total: number; hits: number }> = {};
    for (const r of rows ?? []) {
      const e = r.engine;
      byEngine[e] ||= { total: 0, hits: 0 };
      byEngine[e].total++;
      if (r.appears) byEngine[e].hits++;
    }
    return { rows: rows ?? [], byEngine };
  });

// --- Schema.org JSON-LD generator (GEO/AEO) ---
const schemaInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  postId: z.string().uuid(),
  schemaType: z.enum(["Article", "FAQ", "HowTo", "Product"]).default("Article"),
});

export const generateSchema = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof schemaInput>) => schemaInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: SB; userId: string };
    await assertMember(supabase, userId, data.organizationId);
    const { data: post, error } = await supabase
      .from("wordpress_posts")
      .select(
        "id, site_id, title, url, excerpt, content_text, content_html, published_at, modified_at, author",
      )
      .eq("id", data.postId)
      .eq("site_id", data.siteId)
      .maybeSingle();
    if (error) throw error;
    if (!post) throw new Error("Post not found");

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const sys = `You output ONLY valid JSON-LD schema.org markup as a JSON object (no prose, no code fences). Use https://schema.org context. Keep claims grounded in the provided content.`;
    const user = `Generate a ${data.schemaType} JSON-LD object for this page.
URL: ${post.url ?? ""}
Title: ${post.title ?? ""}
Author: ${post.author ?? ""}
Published: ${post.published_at ?? ""}
Modified: ${post.modified_at ?? ""}
Excerpt: ${post.excerpt ?? ""}
Content (truncated): ${(post.content_text ?? post.content_html ?? "").slice(0, 4000)}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Gateway ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: Json;
    try {
      parsed = JSON.parse(raw) as Json;
    } catch {
      throw new Error("Model returned invalid JSON");
    }
    return {
      schema: parsed,
      scriptTag: `<script type="application/ld+json">${JSON.stringify(parsed)}</script>`,
    };
  });
