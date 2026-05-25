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

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function countWords(t: string): number {
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
}

type DraftResult = {
  title: string;
  meta_description: string;
  content_html: string;
  citations: { label: string; url: string }[];
};

const MODEL = "google/gemini-3-flash-preview";

const draftSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 10, maxLength: 140 },
    meta_description: { type: "string", minLength: 60, maxLength: 200 },
    content_html: {
      type: "string",
      description:
        "Complete article HTML using <h2>, <h3>, <p>, <ul>, <li>, <strong>, <a>. No <html>/<body>/<head>. No inline styles.",
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, url: { type: "string" } },
        required: ["label", "url"],
      },
    },
  },
  required: ["title", "meta_description", "content_html", "citations"],
};

const generateInput = z.object({
  organizationId: z.string().uuid(),
  briefId: z.string().uuid(),
  tone: z.enum(["professional", "conversational", "authoritative", "playful", "technical"]).default("professional"),
  persona: z.string().trim().max(200).optional(),
});

export const generateDraftFromBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => generateInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: brief, error: bErr } = await supabase
      .from("content_briefs")
      .select("*")
      .eq("id", data.briefId)
      .eq("organization_id", data.organizationId)
      .single();
    if (bErr || !brief) throw new Error("Brief not found");

    const outline = (brief.outline as unknown as { heading: string; level: number; notes: string }[]) ?? [];
    const aeo = (brief.aeo_questions as unknown as string[]) ?? [];
    const geo = (brief.geo_signals as unknown as string[]) ?? [];
    const intLinks =
      (brief.internal_links as unknown as { anchor: string; rationale: string }[]) ?? [];

    const outlineText = outline
      .map((s) => `${"#".repeat(s.level)} ${s.heading}\n   ${s.notes}`)
      .join("\n");

    const systemPrompt =
      "You are a senior SEO content writer. Produce a complete, original, ready-to-publish article in valid HTML. " +
      "Follow the outline strictly. Include factual citations only when you can name a real source (no fabricated URLs). " +
      "Use <h2>/<h3> for structure, short paragraphs, bullet lists where useful. Naturally weave the target keyword.";

    const userPrompt =
      `Title: ${brief.title}\n` +
      `Target keyword: ${brief.target_keyword ?? "(none)"}\n` +
      `Search intent: ${brief.search_intent ?? "informational"}\n` +
      `Target word count: ${brief.word_count_target ?? 1200}\n` +
      `Tone: ${data.tone}\n` +
      (data.persona ? `Audience persona: ${data.persona}\n` : "") +
      `\nOutline:\n${outlineText}\n` +
      (aeo.length ? `\nAnswer these questions in the article: ${aeo.join("; ")}\n` : "") +
      (geo.length ? `\nIncorporate these GEO/E-E-A-T signals: ${geo.join("; ")}\n` : "") +
      (intLinks.length
        ? `\nWhere natural, link with these anchors: ${intLinks.map((l) => l.anchor).join(", ")}\n`
        : "");

    const result = await callLovableAIStructured<DraftResult>(
      systemPrompt,
      userPrompt,
      "write_article",
      draftSchema,
      MODEL,
    );

    const text = stripHtml(result.content_html);
    const wc = countWords(text);

    const { data: row, error } = await supabase
      .from("content_drafts")
      .insert({
        organization_id: data.organizationId,
        site_id: brief.site_id,
        brief_id: brief.id,
        title: result.title || brief.title,
        meta_description: result.meta_description,
        target_keyword: brief.target_keyword,
        tone: data.tone,
        persona: data.persona ?? null,
        content_html: result.content_html,
        content_text: text,
        word_count: wc,
        citations: (result.citations ?? []) as unknown as Json,
        model: MODEL,
        status: "draft",
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;

    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "draft.generated",
      title: `Draft written: ${result.title}`,
      description: `${wc} words · tone ${data.tone}`,
      link: `/writer`,
    });

    return { draftId: row.id };
  });

const regenInput = z.object({
  organizationId: z.string().uuid(),
  draftId: z.string().uuid(),
  tone: z.enum(["professional", "conversational", "authoritative", "playful", "technical"]).optional(),
  persona: z.string().trim().max(200).optional(),
  instructions: z.string().trim().max(2000).optional(),
});

export const regenerateDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => regenInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: draft, error: dErr } = await supabase
      .from("content_drafts")
      .select("*")
      .eq("id", data.draftId)
      .eq("organization_id", data.organizationId)
      .single();
    if (dErr || !draft) throw new Error("Draft not found");

    const tone = data.tone ?? draft.tone;
    const persona = data.persona ?? draft.persona ?? undefined;

    const systemPrompt =
      "You are a senior SEO editor. Rewrite the supplied article to improve clarity, depth and SEO. " +
      "Return complete, original HTML — no <html>/<body>. Preserve factual claims; do not fabricate URLs.";
    const userPrompt =
      `Title: ${draft.title}\n` +
      `Target keyword: ${draft.target_keyword ?? "(none)"}\n` +
      `Tone: ${tone}\n` +
      (persona ? `Persona: ${persona}\n` : "") +
      (data.instructions ? `\nEditor instructions: ${data.instructions}\n` : "") +
      `\nCurrent article HTML:\n${draft.content_html}`;

    const result = await callLovableAIStructured<DraftResult>(
      systemPrompt,
      userPrompt,
      "rewrite_article",
      draftSchema,
      MODEL,
    );
    const text = stripHtml(result.content_html);
    const wc = countWords(text);

    const { error: uErr } = await supabase
      .from("content_drafts")
      .update({
        title: result.title || draft.title,
        meta_description: result.meta_description,
        content_html: result.content_html,
        content_text: text,
        word_count: wc,
        citations: (result.citations ?? []) as unknown as Json,
        tone,
        persona: persona ?? null,
        model: MODEL,
      })
      .eq("id", data.draftId);
    if (uErr) throw uErr;
    return { ok: true };
  });

const saveInput = z.object({
  organizationId: z.string().uuid(),
  draftId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  meta_description: z.string().trim().max(220).optional(),
  content_html: z.string().min(20).max(200_000),
});

export const saveDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => saveInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const text = stripHtml(data.content_html);
    const { error } = await supabase
      .from("content_drafts")
      .update({
        title: data.title,
        meta_description: data.meta_description ?? null,
        content_html: data.content_html,
        content_text: text,
        word_count: countWords(text),
      })
      .eq("id", data.draftId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

const publishInput = z.object({
  organizationId: z.string().uuid(),
  draftId: z.string().uuid(),
});

export const publishDraftToWordpress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => publishInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: draft, error } = await supabase
      .from("content_drafts")
      .select("*")
      .eq("id", data.draftId)
      .eq("organization_id", data.organizationId)
      .single();
    if (error || !draft) throw new Error("Draft not found");

    const conn = await loadWpConnection(supabase, data.organizationId, draft.site_id);
    if (!conn) throw new Error("WordPress is not connected for this site");
    const token = Buffer.from(`${conn.username}:${conn.appPassword}`).toString("base64");
    const res = await fetch(`${conn.url}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${token}`,
      },
      body: JSON.stringify({
        status: "draft",
        title: draft.title,
        content: draft.content_html,
        excerpt: draft.meta_description ?? "",
      }),
    });
    if (!res.ok) throw new Error(`WordPress publish failed: HTTP ${res.status}`);
    const body = (await res.json()) as { id?: number; link?: string };
    const result = { wpPostId: body?.id ?? null, link: body?.link ?? null };

    await supabase
      .from("content_drafts")
      .update({
        status: "published",
        wp_post_id: result.wpPostId,
        wp_link: result.link,
        published_at: new Date().toISOString(),
      })
      .eq("id", data.draftId);

    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "draft.published",
      title: `Draft sent to WordPress: ${draft.title}`,
      description: result.link ?? "WP draft created",
      link: result.link ?? "/writer",
    });

    return result;
  });

const deleteInput = z.object({
  organizationId: z.string().uuid(),
  draftId: z.string().uuid(),
});

export const deleteDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => deleteInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const { error } = await supabase
      .from("content_drafts")
      .delete()
      .eq("id", data.draftId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });