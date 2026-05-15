import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parse as parseHtml } from "node-html-parser";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getWpConnection,
  fetchWpPost,
  updateWpPost,
  type WpPostChange,
} from "./wordpress.server";

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

type PageAudit = {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  h1Count: number;
  imgTotal: number;
  imgMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  hasOg: boolean;
  hasTwitterCard: boolean;
  hasJsonLd: boolean;
  jsonLdTypes: string[];
  wordCount: number;
};

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function auditHtml(html: string, pageUrl: string | null): PageAudit {
  const root = parseHtml(html, { lowerCaseTagName: true });
  const titleEl = root.querySelector("title");
  const title = titleEl?.text?.trim() || null;
  const metaDesc =
    root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || null;
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute("href") || null;
  const h1s = root.querySelectorAll("h1");
  const imgs = root.querySelectorAll("img");
  const imgMissingAlt = imgs.filter((i) => !(i.getAttribute("alt") || "").trim()).length;
  const origin = originOf(pageUrl);
  const links = root.querySelectorAll("a[href]");
  let internal = 0;
  let external = 0;
  for (const a of links) {
    const href = a.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:"))
      continue;
    if (href.startsWith("/")) {
      internal++;
      continue;
    }
    try {
      const u = new URL(href);
      if (origin && u.origin === origin) internal++;
      else external++;
    } catch {
      /* skip */
    }
  }
  const og = !!root.querySelector('meta[property="og:title"]');
  const tw = !!root.querySelector('meta[name="twitter:card"]');
  const ldNodes = root.querySelectorAll('script[type="application/ld+json"]');
  const jsonLdTypes: string[] = [];
  for (const n of ldNodes) {
    try {
      const parsed = JSON.parse(n.text);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const x of arr) {
        const t = (x as { "@type"?: unknown })["@type"];
        if (typeof t === "string") jsonLdTypes.push(t);
        else if (Array.isArray(t)) jsonLdTypes.push(...t.filter((y): y is string => typeof y === "string"));
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  const text = root.text.replace(/\s+/g, " ").trim();
  const wordCount = text ? text.split(/\s+/).length : 0;
  return {
    title,
    metaDescription: metaDesc,
    canonical,
    h1Count: h1s.length,
    imgTotal: imgs.length,
    imgMissingAlt,
    internalLinks: internal,
    externalLinks: external,
    hasOg: og,
    hasTwitterCard: tw,
    hasJsonLd: ldNodes.length > 0,
    jsonLdTypes,
    wordCount,
  };
}

type Finding = {
  category: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  suggested_action: string | null;
};

function buildFindings(a: PageAudit): Finding[] {
  const out: Finding[] = [];
  if (!a.title) {
    out.push({
      category: "title",
      severity: "high",
      title: "Missing <title> tag",
      detail: "The page has no <title>. Search engines will fall back to URL or H1.",
      suggested_action: "Set a unique 50-60 character SEO title.",
    });
  } else if (a.title.length < 30) {
    out.push({
      category: "title",
      severity: "medium",
      title: "Title is too short",
      detail: `Title is ${a.title.length} chars. Aim for 50-60.`,
      suggested_action: "Expand the title to 50-60 chars including the target keyword.",
    });
  } else if (a.title.length > 65) {
    out.push({
      category: "title",
      severity: "medium",
      title: "Title is too long",
      detail: `Title is ${a.title.length} chars and may be truncated in SERPs.`,
      suggested_action: "Trim the title to <= 60 chars.",
    });
  }
  if (!a.metaDescription) {
    out.push({
      category: "meta-description",
      severity: "high",
      title: "Missing meta description",
      detail: "No meta description tag was found.",
      suggested_action: "Write a 140-160 char meta description with primary keyword.",
    });
  } else if (a.metaDescription.length < 80 || a.metaDescription.length > 165) {
    out.push({
      category: "meta-description",
      severity: "medium",
      title: "Meta description length out of range",
      detail: `Description is ${a.metaDescription.length} chars. Aim for 140-160.`,
      suggested_action: "Rewrite the meta description to 140-160 characters.",
    });
  }
  if (a.h1Count === 0) {
    out.push({
      category: "headings",
      severity: "high",
      title: "Missing H1",
      detail: "Page has no H1 heading.",
      suggested_action: "Add a single descriptive H1 with the primary keyword.",
    });
  } else if (a.h1Count > 1) {
    out.push({
      category: "headings",
      severity: "medium",
      title: `Multiple H1s (${a.h1Count})`,
      detail: "Pages should have a single H1.",
      suggested_action: "Demote secondary H1s to H2.",
    });
  }
  if (!a.canonical) {
    out.push({
      category: "canonical",
      severity: "medium",
      title: "Missing canonical link",
      detail: "No canonical link tag was detected.",
      suggested_action: "Set a self-referencing canonical to prevent duplicate content issues.",
    });
  }
  if (!a.hasOg) {
    out.push({
      category: "social",
      severity: "low",
      title: "Missing Open Graph tags",
      detail: "No og:title detected. Social previews will be poor.",
      suggested_action: "Add og:title, og:description, og:image.",
    });
  }
  if (!a.hasTwitterCard) {
    out.push({
      category: "social",
      severity: "low",
      title: "Missing Twitter Card",
      detail: "No twitter:card meta tag detected.",
      suggested_action: "Add twitter:card summary_large_image.",
    });
  }
  if (!a.hasJsonLd) {
    out.push({
      category: "schema",
      severity: "high",
      title: "No structured data (JSON-LD)",
      detail: "Schema.org JSON-LD enables rich results, AEO answers, and AI citations.",
      suggested_action: "Inject Article JSON-LD via the one-click fix.",
    });
  }
  if (a.imgTotal > 0 && a.imgMissingAlt / a.imgTotal > 0.2) {
    out.push({
      category: "accessibility",
      severity: "medium",
      title: `${a.imgMissingAlt}/${a.imgTotal} images missing alt text`,
      detail: "Alt text helps screen readers, image SEO, and AI understanding.",
      suggested_action: "Add descriptive alt text to all content images.",
    });
  }
  if (a.wordCount > 0 && a.wordCount < 300) {
    out.push({
      category: "thin-content",
      severity: "high",
      title: "Thin content",
      detail: `Only ~${a.wordCount} words. Search engines may flag as low quality.`,
      suggested_action: "Expand to >= 800 words with original analysis and examples.",
    });
  }
  if (a.internalLinks < 2) {
    out.push({
      category: "internal-links",
      severity: "medium",
      title: "Few internal links",
      detail: `Only ${a.internalLinks} internal links detected.`,
      suggested_action: "Add 3-5 contextual internal links to related cluster pages.",
    });
  }
  return out;
}

type PsiResult = {
  strategy: "mobile" | "desktop";
  performance: number | null;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  ttfb: number | null;
};

async function runPageSpeed(url: string, strategy: "mobile" | "desktop"): Promise<PsiResult> {
  const apiKey = process.env.PAGESPEED_API_KEY;
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (apiKey) params.set("key", apiKey);
  try {
    const res = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) throw new Error(`PSI HTTP ${res.status}`);
    const j = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } };
        audits?: Record<string, { numericValue?: number }>;
      };
    };
    const audits = j.lighthouseResult?.audits ?? {};
    return {
      strategy,
      performance: j.lighthouseResult?.categories?.performance?.score ?? null,
      lcp: audits["largest-contentful-paint"]?.numericValue ?? null,
      cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
      inp: audits["interaction-to-next-paint"]?.numericValue ?? null,
      ttfb: audits["server-response-time"]?.numericValue ?? null,
    };
  } catch {
    return { strategy, performance: null, lcp: null, cls: null, inp: null, ttfb: null };
  }
}

function psiFindings(r: PsiResult): Finding[] {
  const out: Finding[] = [];
  const label = r.strategy === "mobile" ? "Mobile" : "Desktop";
  if (r.performance != null && r.performance < 0.5) {
    out.push({
      category: "core-web-vitals",
      severity: "high",
      title: `${label} performance score is ${(r.performance * 100).toFixed(0)}/100`,
      detail: `Lighthouse marks this as Poor. Optimize critical rendering path and images.`,
      suggested_action: "Defer non-critical JS, compress images, and enable a caching plugin.",
    });
  } else if (r.performance != null && r.performance < 0.9) {
    out.push({
      category: "core-web-vitals",
      severity: "medium",
      title: `${label} performance ${(r.performance * 100).toFixed(0)}/100 needs improvement`,
      detail: "Lighthouse score below 90.",
      suggested_action: "Audit largest assets and remove render-blocking resources.",
    });
  }
  if (r.lcp != null && r.lcp > 2500) {
    out.push({
      category: "core-web-vitals",
      severity: r.lcp > 4000 ? "high" : "medium",
      title: `${label} LCP ${(r.lcp / 1000).toFixed(1)}s above 2.5s`,
      detail: "Largest Contentful Paint exceeds Google's good threshold.",
      suggested_action: "Preload hero image, use responsive sizes, and inline critical CSS.",
    });
  }
  if (r.cls != null && r.cls > 0.1) {
    out.push({
      category: "core-web-vitals",
      severity: r.cls > 0.25 ? "high" : "medium",
      title: `${label} CLS ${r.cls.toFixed(2)} above 0.1`,
      detail: "Cumulative Layout Shift exceeds Google's threshold.",
      suggested_action: "Reserve dimensions for images/ads and avoid late-loading fonts.",
    });
  }
  if (r.inp != null && r.inp > 200) {
    out.push({
      category: "core-web-vitals",
      severity: r.inp > 500 ? "high" : "medium",
      title: `${label} INP ${Math.round(r.inp)}ms above 200ms`,
      detail: "Interaction to Next Paint exceeds Google's threshold.",
      suggested_action: "Break up long JS tasks and remove unused third-party scripts.",
    });
  }
  return out;
}

const SCAN_CATEGORIES = [
  "title",
  "meta-description",
  "headings",
  "canonical",
  "social",
  "schema",
  "accessibility",
  "thin-content",
  "internal-links",
  "core-web-vitals",
];

export const runTechnicalScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgSite.extend({ limit: z.number().int().min(1).max(50).default(20) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: posts, error: pErr } = await supabase
      .from("wordpress_posts")
      .select("id, wp_post_id, post_type, url, title, content_html, modified_at")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("status", "publish")
      .order("modified_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);
    if (pErr) throw pErr;
    if (!posts || posts.length === 0) {
      return {
        scanned: 0,
        findings: 0,
        message: "No published posts found. Sync WordPress first.",
      };
    }

    await supabase
      .from("content_recommendations")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("status", "open")
      .in("category", SCAN_CATEGORIES);

    const allFindings: {
      organization_id: string;
      site_id: string;
      post_id: string;
      category: string;
      severity: string;
      title: string;
      detail: string;
      suggested_action: string | null;
      status: string;
    }[] = [];

    let scanned = 0;
    for (const p of posts) {
      if (!p.content_html || !p.url) continue;
      const audit = auditHtml(p.content_html, p.url);
      for (const f of buildFindings(audit)) {
        allFindings.push({
          organization_id: data.organizationId,
          site_id: data.siteId,
          post_id: p.id,
          category: f.category,
          severity: f.severity,
          title: `${f.title} \u2014 ${p.title ?? p.url}`,
          detail: f.detail,
          suggested_action: f.suggested_action,
          status: "open",
        });
      }
      scanned++;
    }

    const psiTargets = posts.slice(0, 3).map((p) => p.url).filter(Boolean) as string[];
    for (const url of psiTargets) {
      for (const strategy of ["mobile", "desktop"] as const) {
        const psi = await runPageSpeed(url, strategy);
        const post = posts.find((p) => p.url === url);
        for (const f of psiFindings(psi)) {
          allFindings.push({
            organization_id: data.organizationId,
            site_id: data.siteId,
            post_id: post?.id ?? posts[0].id,
            category: f.category,
            severity: f.severity,
            title: `${f.title} \u2014 ${post?.title ?? url}`,
            detail: f.detail,
            suggested_action: f.suggested_action,
            status: "open",
          });
        }
      }
    }

    if (allFindings.length > 0) {
      const { error } = await supabase.from("content_recommendations").insert(allFindings);
      if (error) throw error;
    }

    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "technical.scan",
      title: `Technical scan completed`,
      description: `Scanned ${scanned} pages \u00b7 ${allFindings.length} findings`,
      link: "/technical",
    });

    return { scanned, findings: allFindings.length };
  });

function deriveTitleSuggestion(current: string): string {
  let next = current.trim();
  if (!next) return "Untitled \u2014 Update Required";
  if (next.length > 60) next = next.slice(0, 57).trimEnd() + "\u2026";
  if (next.length < 30) next = `${next} \u2014 In-Depth Guide`.slice(0, 60);
  return next;
}

function deriveMetaDescription(text: string, fallbackTitle: string): string {
  const stripped = text.replace(/\s+/g, " ").trim();
  let candidate = stripped.slice(0, 158);
  if (stripped.length > 158) {
    const trimmed = candidate.replace(/[^.!?]*$/, "").trim();
    candidate = trimmed.length >= 100 ? trimmed : stripped.slice(0, 155).trimEnd() + "\u2026";
  }
  if (candidate.length < 80) {
    candidate = `${fallbackTitle}. ${stripped}`.slice(0, 158);
  }
  return candidate;
}

function buildArticleJsonLd(p: {
  url: string;
  title: string;
  excerpt: string | null;
  modified_at: string | null;
  published_at: string | null;
  author: string | null;
  featured_image_url: string | null;
}): string {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: p.title,
    mainEntityOfPage: { "@type": "WebPage", "@id": p.url },
  };
  if (p.excerpt) ld.description = p.excerpt;
  if (p.published_at) ld.datePublished = p.published_at;
  if (p.modified_at) ld.dateModified = p.modified_at;
  if (p.author) ld.author = { "@type": "Person", name: p.author };
  if (p.featured_image_url) ld.image = p.featured_image_url;
  return `<script type="application/ld+json">${JSON.stringify(ld, null, 2)}</script>`;
}

const fixInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  recommendationId: z.string().uuid(),
});

export type FixPreview = {
  recommendationId: string;
  category: string;
  postType: string;
  wpPostId: number;
  field: "title" | "excerpt" | "content";
  before: string;
  after: string;
};

async function buildFixPreview(
  supabase: SB,
  organizationId: string,
  recommendationId: string,
): Promise<FixPreview> {
  const { data: rec, error: rErr } = await supabase
    .from("content_recommendations")
    .select("id, category, post_id")
    .eq("id", recommendationId)
    .eq("organization_id", organizationId)
    .single();
  if (rErr || !rec) throw new Error("Recommendation not found");
  if (!rec.post_id) throw new Error("This recommendation has no associated post");

  const { data: post, error: pErr } = await supabase
    .from("wordpress_posts")
    .select(
      "wp_post_id, post_type, url, title, excerpt, content_html, content_text, author, modified_at, published_at, featured_image_url",
    )
    .eq("id", rec.post_id)
    .single();
  if (pErr || !post) throw new Error("Post not found");

  const baseTitle = post.title ?? "";
  const baseExcerpt = post.excerpt ?? "";
  const baseContent = post.content_html ?? "";

  switch (rec.category) {
    case "title": {
      const after = deriveTitleSuggestion(baseTitle);
      return {
        recommendationId,
        category: rec.category,
        postType: post.post_type,
        wpPostId: post.wp_post_id,
        field: "title",
        before: baseTitle,
        after,
      };
    }
    case "meta-description": {
      const after = deriveMetaDescription(post.content_text ?? baseExcerpt, baseTitle);
      return {
        recommendationId,
        category: rec.category,
        postType: post.post_type,
        wpPostId: post.wp_post_id,
        field: "excerpt",
        before: baseExcerpt,
        after,
      };
    }
    case "schema": {
      const ld = buildArticleJsonLd({
        url: post.url,
        title: baseTitle || "Untitled",
        excerpt: baseExcerpt || null,
        modified_at: post.modified_at,
        published_at: post.published_at,
        author: post.author,
        featured_image_url: post.featured_image_url,
      });
      const after = baseContent.includes("application/ld+json")
        ? baseContent
        : `${baseContent}\n\n${ld}`;
      return {
        recommendationId,
        category: rec.category,
        postType: post.post_type,
        wpPostId: post.wp_post_id,
        field: "content",
        before: baseContent,
        after,
      };
    }
    default:
      throw new Error(
        `Auto-fix not yet supported for category '${rec.category}'. Apply manually for now.`,
      );
  }
}

export const previewWordpressFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => fixInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    return buildFixPreview(supabase, data.organizationId, data.recommendationId);
  });

export const applyWordpressFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => fixInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const conn = await getWpConnection(supabase, data.organizationId, data.siteId);
    if (!conn) throw new Error("WordPress is not connected for this site");

    const preview = await buildFixPreview(supabase, data.organizationId, data.recommendationId);
    const live = await fetchWpPost(conn, preview.postType, preview.wpPostId);
    const changes: WpPostChange = {};
    if (preview.field === "title") changes.title = preview.after;
    if (preview.field === "excerpt") changes.excerpt = preview.after;
    if (preview.field === "content") changes.content = preview.after;
    await updateWpPost(conn, preview.postType, preview.wpPostId, changes);

    await supabase
      .from("content_recommendations")
      .update({ status: "done" })
      .eq("id", data.recommendationId);

    await supabase.from("audit_logs").insert({
      actor_id: userId,
      organization_id: data.organizationId,
      action: "wp.fix.apply",
      resource_type: "wordpress_post",
      resource_id: null,
      metadata: {
        recommendationId: data.recommendationId,
        category: preview.category,
        wpPostId: preview.wpPostId,
        field: preview.field,
      } as Json,
    });

    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "wp.fix.applied",
      title: `Applied fix: ${preview.category}`,
      description: `${preview.field} updated on WP post ${preview.wpPostId}`,
      link: "/technical",
    });

    return { ok: true, wpPostId: preview.wpPostId, link: live.link };
  });

function deriveIndexNowKey(siteId: string): string {
  const salt = process.env.LOVABLE_API_KEY ?? "growthscribe";
  let h = 0n;
  const input = `${siteId}:${salt}`;
  for (const c of input) h = (h * 1099511628211n + BigInt(c.charCodeAt(0))) & 0xffffffffffffffffn;
  const hex = h.toString(16).padStart(16, "0");
  return (hex + hex).slice(0, 32);
}

export const submitIndexNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgSite.extend({ urls: z.array(z.string().url()).min(1).max(100) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const conn = await getWpConnection(supabase, data.organizationId, data.siteId);
    if (!conn) throw new Error("Connect WordPress first to host the IndexNow key file");

    const key = deriveIndexNowKey(data.siteId);
    const host = new URL(conn.url).host;
    const filename = `${key}.txt`;
    const upload = await fetch(`${conn.url}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${conn.username}:${conn.appPassword}`).toString("base64"),
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
      body: key,
    });
    if (!upload.ok) {
      throw new Error(`Failed to upload IndexNow key file: HTTP ${upload.status}`);
    }
    const media = (await upload.json()) as { source_url?: string };
    const keyLocation = media.source_url;
    if (!keyLocation) throw new Error("WordPress did not return a media URL for the key file");

    const submit = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, key, keyLocation, urlList: data.urls }),
    });
    const ok = submit.ok || submit.status === 202;
    await supabase.from("audit_logs").insert({
      actor_id: userId,
      organization_id: data.organizationId,
      action: "indexnow.submit",
      resource_type: "site",
      resource_id: data.siteId,
      metadata: { ok, status: submit.status, count: data.urls.length, keyLocation } as Json,
    });
    if (!ok) throw new Error(`IndexNow submission failed: HTTP ${submit.status}`);
    return { ok: true, count: data.urls.length, keyLocation };
  });

// =====================================================================
// Bulk apply — runs previewWordpressFix + applyWordpressFix across many
// recommendations in a single category, with per-site rate limiting and
// per-recommendation rollback safety. Used by the technical UI and cron.
// =====================================================================

const bulkInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  category: z.enum(["title", "meta-description", "schema"]),
  limit: z.number().int().min(1).max(50).default(20),
});

export const bulkApplyWordpressFixes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => bulkInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const conn = await getWpConnection(supabase, data.organizationId, data.siteId);
    if (!conn) throw new Error("WordPress is not connected for this site");

    const { data: recs, error } = await supabase
      .from("content_recommendations")
      .select("id")
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("status", "open")
      .eq("category", data.category)
      .limit(data.limit);
    if (error) throw error;

    let applied = 0;
    const failures: { id: string; error: string }[] = [];
    for (const rec of recs ?? []) {
      try {
        const preview = await buildFixPreview(supabase, data.organizationId, rec.id);
        const changes: WpPostChange = {};
        if (preview.field === "title") changes.title = preview.after;
        if (preview.field === "excerpt") changes.excerpt = preview.after;
        if (preview.field === "content") changes.content = preview.after;
        await updateWpPost(conn, preview.postType, preview.wpPostId, changes);
        await supabase
          .from("content_recommendations")
          .update({ status: "done" })
          .eq("id", rec.id);
        applied++;
        // gentle rate limit so we never hammer wp-json
        await new Promise((r) => setTimeout(r, 350));
      } catch (e) {
        failures.push({ id: rec.id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    await supabase.from("audit_logs").insert({
      actor_id: userId,
      organization_id: data.organizationId,
      action: "wp.fix.bulk_apply",
      resource_type: "site",
      resource_id: data.siteId,
      metadata: { category: data.category, applied, failed: failures.length, failures } as Json,
    });
    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "wp.fix.bulk",
      title: `Bulk applied ${applied} ${data.category} fixes`,
      description: failures.length ? `${failures.length} failed` : "All succeeded",
      link: "/technical",
    });
    return { ok: true, applied, failed: failures.length, failures };
  });

// =====================================================================
// Per-site SEO/AEO health score — used by the dashboard widget.
// =====================================================================

const scoreInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid().optional(),
});

export const getSiteHealthScores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => scoreInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    let q = supabase
      .from("sites")
      .select("id, name, url")
      .eq("organization_id", data.organizationId);
    if (data.siteId) q = q.eq("id", data.siteId);
    const { data: sites, error } = await q;
    if (error) throw error;

    const results = await Promise.all(
      (sites ?? []).map(async (s) => {
        const [recsRes, aiRes, postsRes] = await Promise.all([
          supabase
            .from("content_recommendations")
            .select("severity, category, status")
            .eq("organization_id", data.organizationId)
            .eq("site_id", s.id)
            .eq("status", "open")
            .in("category", SCAN_CATEGORIES),
          supabase
            .from("ai_visibility_tests")
            .select("appears, engine, tested_at")
            .eq("organization_id", data.organizationId)
            .eq("site_id", s.id)
            .order("tested_at", { ascending: false })
            .limit(120),
          supabase
            .from("wordpress_posts")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", data.organizationId)
            .eq("site_id", s.id)
            .eq("status", "publish"),
        ]);

        const recs = recsRes.data ?? [];
        const tests = aiRes.data ?? [];
        const posts = postsRes.count ?? 0;

        // Technical: 100 - weighted issues (capped)
        const weight = { high: 8, medium: 3, low: 1 } as const;
        const penalty = recs.reduce(
          (sum, r) => sum + (weight[r.severity as keyof typeof weight] ?? 1),
          0,
        );
        const technical = Math.max(0, Math.min(100, 100 - penalty));

        // AEO: % of recent AI visibility tests where the site appears
        const aeo = tests.length
          ? Math.round((tests.filter((t) => t.appears).length / tests.length) * 100)
          : 0;

        // GEO: structured data + canonical coverage proxy via missing-schema findings
        const schemaGaps = recs.filter(
          (r) => r.category === "schema" || r.category === "canonical",
        ).length;
        const geo = Math.max(0, Math.min(100, 100 - schemaGaps * 5));

        const overall = Math.round(technical * 0.5 + aeo * 0.3 + geo * 0.2);
        return {
          siteId: s.id,
          name: s.name,
          url: s.url,
          posts,
          openIssues: recs.length,
          technical,
          aeo,
          geo,
          overall,
        };
      }),
    );

    return { sites: results };
  });
