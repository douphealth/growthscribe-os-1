import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parse as parseHtml } from "node-html-parser";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWpConnection, fetchWpPost, updateWpPost } from "./wordpress.server";

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

const orgSite = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
});

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "you",
  "are",
  "but",
  "not",
  "have",
  "has",
  "was",
  "were",
  "will",
  "into",
  "over",
  "under",
  "when",
  "what",
  "which",
  "while",
  "they",
  "them",
  "their",
  "there",
  "these",
  "those",
  "about",
  "also",
  "more",
  "than",
  "then",
  "just",
  "only",
  "very",
  "some",
  "any",
  "all",
  "our",
  "out",
  "off",
  "one",
  "two",
  "new",
  "get",
  "can",
  "its",
  "it's",
  "how",
  "why",
  "who",
  "where",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function ngramScore(sourceTokens: Set<string>, candidate: string): number {
  const candTokens = tokenize(candidate);
  if (candTokens.length === 0) return 0;
  let hit = 0;
  for (const t of candTokens) if (sourceTokens.has(t)) hit++;
  return hit / candTokens.length;
}

// =====================================================================
// Internal linking engine: for each source post, find the top-N target
// posts whose title overlaps with source body and persist suggestions.
// =====================================================================

export const discoverInternalLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgSite.extend({ limit: z.number().int().min(1).max(50).default(20) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: posts, error } = await supabase
      .from("wordpress_posts")
      .select("id, url, title, content_text")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("status", "publish")
      .order("modified_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);
    if (error) throw error;
    const docs = posts ?? [];
    if (docs.length < 2) return { suggested: 0, scanned: docs.length };

    // Reset prior suggestions for this site so we don't accumulate stale data.
    await supabase
      .from("internal_link_opportunities")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("status", "suggested");

    const suggestions: Array<{
      organization_id: string;
      site_id: string;
      source_post_id: string;
      target_post_id: string;
      anchor_suggestion: string;
      relevance_score: number;
      context_snippet: string;
      status: string;
    }> = [];

    for (const src of docs) {
      if (!src.content_text) continue;
      const srcTokens = new Set(tokenize(src.content_text));
      if (srcTokens.size === 0) continue;
      const scored = docs
        .filter((t) => t.id !== src.id && t.title)
        .map((t) => ({ t, s: ngramScore(srcTokens, t.title!) }))
        .filter((x) => x.s >= 0.5)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);
      for (const { t, s } of scored) {
        const anchor = (t.title ?? "").trim();
        const lc = src.content_text.toLowerCase();
        const idx = lc.indexOf(anchor.toLowerCase());
        const snippet =
          idx >= 0
            ? src.content_text.slice(Math.max(0, idx - 60), idx + anchor.length + 60)
            : src.content_text.slice(0, 160);
        suggestions.push({
          organization_id: data.organizationId,
          site_id: data.siteId,
          source_post_id: src.id,
          target_post_id: t.id,
          anchor_suggestion: anchor,
          relevance_score: Math.round(s * 100) / 100,
          context_snippet: snippet,
          status: "suggested",
        });
      }
    }

    if (suggestions.length > 0) {
      const { error: insErr } = await supabase
        .from("internal_link_opportunities")
        .insert(suggestions);
      if (insErr) throw insErr;
    }
    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "internal-links.discovered",
      title: `Discovered ${suggestions.length} internal link opportunities`,
      description: `Scanned ${docs.length} posts`,
      link: "/technical",
    });
    return { scanned: docs.length, suggested: suggestions.length };
  });

const applyLinkInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  opportunityId: z.string().uuid(),
});

export const applyInternalLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => applyLinkInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: opp, error: oppErr } = await supabase
      .from("internal_link_opportunities")
      .select("id, source_post_id, target_post_id, anchor_suggestion, status")
      .eq("id", data.opportunityId)
      .eq("organization_id", data.organizationId)
      .single();
    if (oppErr || !opp) throw new Error("Opportunity not found");
    if (opp.status !== "suggested") throw new Error(`Already ${opp.status}`);
    if (!opp.source_post_id || !opp.target_post_id) throw new Error("Opportunity has no posts");

    const { data: src } = await supabase
      .from("wordpress_posts")
      .select("wp_post_id, post_type, content_html")
      .eq("id", opp.source_post_id)
      .single();
    const { data: tgt } = await supabase
      .from("wordpress_posts")
      .select("url")
      .eq("id", opp.target_post_id)
      .single();
    if (!src || !tgt?.url) throw new Error("Source or target post missing");

    const anchor = (opp.anchor_suggestion ?? "").trim();
    const html = src.content_html ?? "";
    if (!anchor || !html) throw new Error("Nothing to link");

    // Replace first un-linked occurrence (case-insensitive) with an <a>.
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Negative-lookahead skips occurrences already inside an anchor tag.
    const re = new RegExp(`(?<!<a[^>]*>[^<]*)\\b${escaped}\\b`, "i");
    if (!re.test(html)) {
      throw new Error("Anchor text not found in source post body");
    }
    const next = html.replace(re, `<a href="${tgt.url}">${anchor}</a>`);

    const conn = await getWpConnection(supabase, data.organizationId, data.siteId);
    if (!conn) throw new Error("WordPress is not connected for this site");
    await updateWpPost(conn, src.post_type, src.wp_post_id, { content: next });

    await supabase
      .from("internal_link_opportunities")
      .update({ status: "applied" })
      .eq("id", opp.id);
    await supabase.from("audit_logs").insert({
      actor_id: userId,
      organization_id: data.organizationId,
      action: "internal-link.apply",
      resource_type: "wordpress_post",
      resource_id: opp.source_post_id,
      metadata: { anchor, target: tgt.url } as Json,
    });
    return { ok: true };
  });

// =====================================================================
// Image alt SEO — scan posts, queue suggestions, bulk-apply by injecting
// alt attributes into <img> tags with empty alts.
// =====================================================================

function deriveAltFromSrc(src: string, fallback: string): string {
  try {
    const u = new URL(src, "https://example.com");
    const file = u.pathname.split("/").pop() ?? "";
    const stem = file.replace(/\.[a-z0-9]+$/i, "");
    const words = stem.replace(/[-_]+/g, " ").trim();
    if (words && /[a-z]/i.test(words)) {
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export const scanImageAlts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgSite.extend({ limit: z.number().int().min(1).max(50).default(25) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: posts, error } = await supabase
      .from("wordpress_posts")
      .select("id, url, title, content_html")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("status", "publish")
      .order("modified_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);
    if (error) throw error;

    await supabase
      .from("content_recommendations")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("status", "open")
      .eq("category", "image-alt");

    const findings: Array<{
      organization_id: string;
      site_id: string;
      post_id: string;
      category: string;
      severity: string;
      title: string;
      detail: string;
      suggested_action: string;
      status: string;
    }> = [];

    let totalMissing = 0;
    for (const p of posts ?? []) {
      if (!p.content_html) continue;
      const root = parseHtml(p.content_html, { lowerCaseTagName: true });
      const imgs = root.querySelectorAll("img");
      const missing = imgs.filter((i) => !(i.getAttribute("alt") ?? "").trim());
      if (missing.length === 0) continue;
      totalMissing += missing.length;
      findings.push({
        organization_id: data.organizationId,
        site_id: data.siteId,
        post_id: p.id,
        category: "image-alt",
        severity: missing.length > 5 ? "high" : "medium",
        title: `${missing.length} image${missing.length === 1 ? "" : "s"} missing alt — ${p.title ?? p.url}`,
        detail: `Found ${imgs.length} images, ${missing.length} without descriptive alt text. Hurts a11y and image search.`,
        suggested_action: "Bulk-apply auto-generates alt text from filenames and post title.",
        status: "open",
      });
    }
    if (findings.length > 0) {
      const { error: insErr } = await supabase.from("content_recommendations").insert(findings);
      if (insErr) throw insErr;
    }
    return { posts: posts?.length ?? 0, missing: totalMissing, findings: findings.length };
  });

export const bulkApplyImageAlts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgSite.extend({ limit: z.number().int().min(1).max(25).default(10) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const conn = await getWpConnection(supabase, data.organizationId, data.siteId);
    if (!conn) throw new Error("WordPress is not connected for this site");

    const { data: recs, error } = await supabase
      .from("content_recommendations")
      .select("id, post_id")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("category", "image-alt")
      .eq("status", "open")
      .limit(data.limit);
    if (error) throw error;

    let applied = 0;
    let altsWritten = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (const rec of recs ?? []) {
      try {
        if (!rec.post_id) continue;
        const { data: post } = await supabase
          .from("wordpress_posts")
          .select("wp_post_id, post_type, title, content_html")
          .eq("id", rec.post_id)
          .single();
        if (!post?.content_html) continue;
        const fallback = post.title ?? "Image";
        let count = 0;
        const next = post.content_html.replace(/<img\b([^>]*)>/gi, (full, attrs: string) => {
          if (/\balt\s*=\s*("[^"]*"|'[^']*')/i.test(attrs)) {
            // Replace empty alt with derived value.
            return full.replace(/\balt\s*=\s*("\s*"|'\s*')/i, () => {
              const srcMatch = attrs.match(/\bsrc\s*=\s*"([^"]+)"|\bsrc\s*=\s*'([^']+)'/i);
              const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? "") : "";
              const alt = deriveAltFromSrc(src, fallback).replace(/"/g, "&quot;");
              count++;
              return `alt="${alt}"`;
            });
          }
          const srcMatch = attrs.match(/\bsrc\s*=\s*"([^"]+)"|\bsrc\s*=\s*'([^']+)'/i);
          const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? "") : "";
          const alt = deriveAltFromSrc(src, fallback).replace(/"/g, "&quot;");
          count++;
          return `<img${attrs} alt="${alt}">`;
        });
        if (count === 0) continue;
        await updateWpPost(conn, post.post_type, post.wp_post_id, { content: next });
        await supabase.from("content_recommendations").update({ status: "done" }).eq("id", rec.id);
        applied++;
        altsWritten += count;
        await new Promise((r) => setTimeout(r, 300));
      } catch (e) {
        failures.push({ id: rec.id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    await supabase.from("audit_logs").insert({
      actor_id: userId,
      organization_id: data.organizationId,
      action: "image-alt.bulk_apply",
      resource_type: "site",
      resource_id: data.siteId,
      metadata: { applied, altsWritten, failed: failures.length, failures } as Json,
    });
    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "image-alt.bulk",
      title: `Wrote alt text on ${altsWritten} images`,
      description: `${applied} posts updated · ${failures.length} failed`,
      link: "/technical",
    });
    return { applied, altsWritten, failed: failures.length, failures };
  });
