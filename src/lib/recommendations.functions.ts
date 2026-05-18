import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
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

const input = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
});

type Rec = {
  organization_id: string;
  site_id: string;
  post_id: string | null;
  category: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string | null;
  suggested_action: string | null;
  status: "open";
};

const REFRESH_DAYS = 180;
const STALE_DAYS = 365;
const OWNED_CATEGORIES = [
  "refresh",
  "expand",
  "striking-distance",
  "internal-link",
  "merge-or-prune",
];

export const generateRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => input.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: posts, error: postsErr } = await supabase
      .from("wordpress_posts")
      .select("id,title,url,word_count,modified_at,published_at,post_type")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .limit(2000);
    if (postsErr) throw postsErr;
    if (!posts || posts.length === 0) {
      return { ok: true as const, generated: 0, message: "No synced posts yet." };
    }

    // Pull last 28d GSC stats per page
    const since = new Date();
    since.setDate(since.getDate() - 28);
    const sinceStr = since.toISOString().slice(0, 10);
    const { data: gsc } = await supabase
      .from("search_console_daily")
      .select("page,clicks,impressions,position,query")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .gte("date", sinceStr)
      .limit(50000);

    type Stat = {
      clicks: number;
      impressions: number;
      bestPos: number;
      topQuery: string | null;
      topQueryClicks: number;
    };
    const byPage = new Map<string, Stat>();
    for (const r of gsc ?? []) {
      if (!r.page) continue;
      const s = byPage.get(r.page) ?? {
        clicks: 0,
        impressions: 0,
        bestPos: 100,
        topQuery: null,
        topQueryClicks: 0,
      };
      s.clicks += r.clicks ?? 0;
      s.impressions += r.impressions ?? 0;
      if ((r.position ?? 100) < s.bestPos) s.bestPos = r.position ?? 100;
      if ((r.clicks ?? 0) > s.topQueryClicks) {
        s.topQueryClicks = r.clicks ?? 0;
        s.topQuery = r.query;
      }
      byPage.set(r.page, s);
    }

    const now = Date.now();
    const recs: Rec[] = [];

    for (const p of posts) {
      if (!p.url) continue;
      const stat = byPage.get(p.url) ?? null;
      const ageDays = p.modified_at
        ? Math.floor((now - new Date(p.modified_at).getTime()) / 86400000)
        : null;

      // REFRESH: old + has impressions
      if (ageDays != null && ageDays > REFRESH_DAYS && stat && stat.impressions > 200) {
        recs.push({
          organization_id: data.organizationId,
          site_id: data.siteId,
          post_id: p.id,
          category: "refresh",
          severity: ageDays > STALE_DAYS ? "high" : "medium",
          title: `Refresh: ${p.title ?? p.url}`,
          detail: `Last updated ${ageDays} days ago. Last 28d: ${stat.clicks} clicks / ${stat.impressions} impressions.`,
          suggested_action:
            "Update facts, add new sections, refresh date, regenerate brief, then re-publish.",
          status: "open",
        });
      }

      // EXPAND: thin + ranks 8-20
      if (
        (p.word_count ?? 0) > 0 &&
        (p.word_count ?? 0) < 800 &&
        stat &&
        stat.bestPos >= 8 &&
        stat.bestPos <= 20
      ) {
        recs.push({
          organization_id: data.organizationId,
          site_id: data.siteId,
          post_id: p.id,
          category: "expand",
          severity: "high",
          title: `Expand: ${p.title ?? p.url}`,
          detail: `Only ${p.word_count} words but ranking #${Math.round(stat.bestPos)} for "${stat.topQuery ?? "target query"}". Adding depth could push it into top 5.`,
          suggested_action:
            "Add FAQ, examples, case studies, comparison tables, and internal links to related posts.",
          status: "open",
        });
      }

      // STRIKING-DISTANCE: pos 4-10, low CTR potential
      if (stat && stat.bestPos >= 4 && stat.bestPos <= 10 && stat.impressions > 500) {
        recs.push({
          organization_id: data.organizationId,
          site_id: data.siteId,
          post_id: p.id,
          category: "striking-distance",
          severity: "high",
          title: `Page-1 push: ${p.title ?? p.url}`,
          detail: `Avg position ${stat.bestPos.toFixed(1)} for "${stat.topQuery ?? "target"}" with ${stat.impressions} impressions / 28d. Optimize title + intro for CTR.`,
          suggested_action:
            "Rewrite title with keyword + benefit, tighten meta description, add answer-box block at the top.",
          status: "open",
        });
      }

      // ZOMBIE: indexed but no impressions in 28d
      if (stat == null && ageDays != null && ageDays > 90) {
        recs.push({
          organization_id: data.organizationId,
          site_id: data.siteId,
          post_id: p.id,
          category: "merge-or-prune",
          severity: "low",
          title: `Zero traffic: ${p.title ?? p.url}`,
          detail: `No clicks or impressions in 28 days, last updated ${ageDays} days ago.`,
          suggested_action:
            "Merge into a stronger pillar post and 301 redirect, or noindex if it has no SEO purpose.",
          status: "open",
        });
      }
    }

    // Internal-link opportunities: posts with high impressions and < 3 inbound mentions
    // (lightweight heuristic by counting mentions across content_text)
    const winners = posts
      .map((p) => ({ p, s: byPage.get(p.url) }))
      .filter((x): x is { p: (typeof posts)[number]; s: Stat } => !!x.s && x.s.impressions > 1000)
      .slice(0, 25);

    if (winners.length > 0) {
      // pull a small slice of content for matching
      const { data: contentRows } = await supabase
        .from("wordpress_posts")
        .select("id,url,content_text")
        .eq("organization_id", data.organizationId)
        .eq("site_id", data.siteId)
        .not("content_text", "is", null)
        .limit(500);

      for (const w of winners) {
        const slug = (w.p.url ?? "").split("/").filter(Boolean).pop() ?? "";
        if (!slug) continue;
        const inbound = (contentRows ?? []).filter(
          (c) =>
            c.id !== w.p.id &&
            (c.content_text ?? "").toLowerCase().includes(slug.replace(/-/g, " ")),
        ).length;
        if (inbound < 3) {
          recs.push({
            organization_id: data.organizationId,
            site_id: data.siteId,
            post_id: w.p.id,
            category: "internal-link",
            severity: "medium",
            title: `Add internal links to: ${w.p.title ?? w.p.url}`,
            detail: `Strong page (${w.s.impressions} impressions / 28d) with only ${inbound} inbound mentions across the site.`,
            suggested_action:
              "Identify 3–5 supporting posts and link to this page from contextually relevant paragraphs.",
            status: "open",
          });
        }
      }
    }

    if (recs.length === 0) {
      return { ok: true as const, generated: 0, message: "No new recommendations." };
    }

    // Reset only recommendation-engine rows so technical scan findings stay intact.
    await supabase
      .from("content_recommendations")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("status", "open")
      .in("category", OWNED_CATEGORIES);

    for (let i = 0; i < recs.length; i += 200) {
      const chunk = recs.slice(i, i + 200);
      const { error } = await supabase.from("content_recommendations").insert(chunk);
      if (error) throw error;
    }

    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "recommendations.generated",
      title: `${recs.length} recommendations generated`,
      description: `Refresh, expand, page-1 push, internal linking and pruning suggestions across ${posts.length} posts.`,
      link: "/recommendations",
    });

    return { ok: true as const, generated: recs.length, posts: posts.length };
  });

const updateInput = z.object({
  organizationId: z.string().uuid(),
  recommendationId: z.string().uuid(),
  status: z.enum(["open", "in_progress", "done", "dismissed"]),
});

export const updateRecommendationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => updateInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const { error } = await supabase
      .from("content_recommendations")
      .update({ status: data.status })
      .eq("id", data.recommendationId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    return { ok: true };
  });

// ---------------- Prioritized Action Queue ----------------
// Surfaces a single ranked list across all sites in the org, scored by
// (impact x confidence) / effort. Used on the dashboard.

const queueInput = z.object({
  organizationId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).optional(),
});

type PrioritizedAction = {
  id: string;
  site_id: string;
  site_name: string | null;
  post_id: string | null;
  post_title: string | null;
  post_url: string | null;
  category: string;
  severity: string;
  title: string;
  detail: string | null;
  suggested_action: string | null;
  status: string;
  impact: number;
  confidence: number;
  effort: number;
  priority: number;
  created_at: string;
};

// Heuristics: impact based on category (revenue proximity), confidence based
// on severity, effort based on category (refresh < expand < merge).
const IMPACT: Record<string, number> = {
  "striking-distance": 95,
  refresh: 80,
  expand: 75,
  "internal-link": 60,
  "merge-or-prune": 45,
  technical: 70,
  performance: 65,
  aeo: 55,
  geo: 50,
};
const EFFORT: Record<string, number> = {
  "striking-distance": 2,
  "internal-link": 2,
  refresh: 3,
  technical: 3,
  performance: 4,
  expand: 5,
  "merge-or-prune": 5,
  aeo: 3,
  geo: 3,
};
const CONFIDENCE: Record<string, number> = { high: 90, medium: 70, low: 50 };

export const getPrioritizedActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => queueInput.parse(i))
  .handler(async ({ data, context }): Promise<{ actions: PrioritizedAction[] }> => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: recs, error } = await supabase
      .from("content_recommendations")
      .select("id,site_id,post_id,category,severity,title,detail,suggested_action,status,created_at")
      .eq("organization_id", data.organizationId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    if (!recs || recs.length === 0) return { actions: [] };

    const siteIds = Array.from(new Set(recs.map((r) => r.site_id)));
    const postIds = Array.from(
      new Set(recs.map((r) => r.post_id).filter((x): x is string => !!x)),
    );
    const [{ data: sites }, { data: posts }] = await Promise.all([
      supabase.from("sites").select("id,name").in("id", siteIds),
      postIds.length
        ? supabase.from("wordpress_posts").select("id,title,url").in("id", postIds)
        : Promise.resolve({ data: [] as { id: string; title: string | null; url: string | null }[] }),
    ]);
    const siteMap = new Map((sites ?? []).map((s) => [s.id, s.name]));
    const postMap = new Map(
      (posts ?? []).map((p) => [p.id, { title: p.title, url: p.url }]),
    );

    const scored: PrioritizedAction[] = recs.map((r) => {
      const impact = IMPACT[r.category] ?? 50;
      const confidence = CONFIDENCE[r.severity] ?? 60;
      const effort = EFFORT[r.category] ?? 3;
      const priority = Math.round((impact * confidence) / effort);
      const post = r.post_id ? postMap.get(r.post_id) : undefined;
      return {
        id: r.id,
        site_id: r.site_id,
        site_name: siteMap.get(r.site_id) ?? null,
        post_id: r.post_id,
        post_title: post?.title ?? null,
        post_url: post?.url ?? null,
        category: r.category,
        severity: r.severity,
        title: r.title,
        detail: r.detail,
        suggested_action: r.suggested_action,
        status: r.status,
        impact,
        confidence,
        effort,
        priority,
        created_at: r.created_at,
      };
    });

    scored.sort((a, b) => b.priority - a.priority);
    return { actions: scored.slice(0, data.limit ?? 12) };
  });
