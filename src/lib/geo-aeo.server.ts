// Server-only JSON-LD generator used by audit_apply + geo_aeo.refresh.
// Generates Article + (FAQ if Q&A detected) + (HowTo if steps detected) +
// BreadcrumbList for a single post. One LLM call per post via the cheap
// model; deterministic structural pieces are templated locally.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

export type GeneratedSchema = {
  article: Record<string, unknown>;
  faq: Record<string, unknown> | null;
  howto: Record<string, unknown> | null;
  breadcrumb: Record<string, unknown>;
};

type PostLite = {
  id: string;
  site_id: string;
  organization_id: string;
  url: string | null;
  title: string | null;
  excerpt: string | null;
  content_html: string | null;
  content_text: string | null;
  published_at: string | null;
  modified_at: string | null;
  author: string | null;
  featured_image_url: string | null;
  content_hash: string | null;
};

export async function sha1(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function detectFaq(html: string | null): Array<{ q: string; a: string }> {
  if (!html) return [];
  const out: Array<{ q: string; a: string }> = [];
  // Heading-style Q&A: heading containing "?" followed by paragraph
  const re = /<(h[2-4])[^>]*>([^<]*\?[^<]*)<\/\1>\s*<(p|div)[^>]*>([\s\S]*?)<\/\3>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 12) {
    const q = m[2].replace(/\s+/g, " ").trim();
    const a = m[4].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (q && a) out.push({ q, a });
  }
  return out;
}

function detectHowto(html: string | null): { steps: Array<{ name: string; text: string }> } | null {
  if (!html) return null;
  // Look for an <ol> or numbered "Step N:" headings
  const olMatch = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/i);
  if (olMatch) {
    const items = Array.from(olMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)).map((x) =>
      x[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );
    if (items.length >= 3) {
      return {
        steps: items.slice(0, 20).map((t, i) => ({ name: `Step ${i + 1}`, text: t })),
      };
    }
  }
  return null;
}

function breadcrumb(url: string, title: string | null) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const items = [{ name: u.hostname.replace(/^www\./, ""), url: u.origin }];
    let acc = u.origin;
    for (const p of parts) {
      acc += "/" + p;
      items.push({ name: p.replace(/[-_]/g, " "), url: acc });
    }
    if (title) items[items.length - 1] = { name: title, url };
    return {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: items.map((it, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        name: it.name,
        item: it.url,
      })),
    };
  } catch {
    return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] };
  }
}

function articleSchema(post: PostLite) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title ?? "",
    description: post.excerpt ?? "",
    image: post.featured_image_url ? [post.featured_image_url] : undefined,
    datePublished: post.published_at,
    dateModified: post.modified_at ?? post.published_at,
    author: post.author ? { "@type": "Person", name: post.author } : undefined,
    mainEntityOfPage: post.url ? { "@type": "WebPage", "@id": post.url } : undefined,
  };
}

function faqSchema(items: Array<{ q: string; a: string }>) {
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}

function howtoSchema(title: string | null, h: ReturnType<typeof detectHowto>) {
  if (!h) return null;
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: title ?? "",
    step: h.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

export function buildSchemas(post: PostLite): GeneratedSchema {
  const faqItems = detectFaq(post.content_html);
  const howto = detectHowto(post.content_html);
  return {
    article: articleSchema(post),
    faq: faqSchema(faqItems),
    howto: howtoSchema(post.title, howto),
    breadcrumb: breadcrumb(post.url ?? "", post.title),
  };
}

/**
 * Generate, cache, and return JSON-LD assets for a post. Skips regeneration
 * if `content_hash` matches the latest cached row (one row per post×kind).
 */
export async function ensureGeoAeoAssets(
  admin: Admin,
  post: PostLite,
): Promise<{ schemas: GeneratedSchema; cached: boolean; hash: string }> {
  const text = post.content_text ?? post.content_html ?? "";
  const hash = await sha1(text);

  const { data: existing } = await admin
    .from("geo_aeo_assets")
    .select("kind, jsonld, content_hash")
    .eq("post_id", post.id);

  const allFresh =
    (existing?.length ?? 0) >= 1 &&
    (existing ?? []).every((r) => r.content_hash === hash);

  if (allFresh && existing) {
    const byKind = Object.fromEntries(
      existing.map((r) => [r.kind, r.jsonld as Record<string, unknown>]),
    );
    return {
      schemas: {
        article: (byKind.article as Record<string, unknown>) ?? articleSchema(post),
        faq: (byKind.faq as Record<string, unknown>) ?? null,
        howto: (byKind.howto as Record<string, unknown>) ?? null,
        breadcrumb: (byKind.breadcrumb as Record<string, unknown>) ?? breadcrumb(post.url ?? "", post.title),
      },
      cached: true,
      hash,
    };
  }

  const schemas = buildSchemas(post);
  const rows: Array<{
    organization_id: string;
    site_id: string;
    post_id: string;
    kind: string;
    jsonld: Json;
    content_hash: string;
    updated_at: string;
  }> = [];
  const base = {
    organization_id: post.organization_id,
    site_id: post.site_id,
    post_id: post.id,
    content_hash: hash,
    updated_at: new Date().toISOString(),
  };
  rows.push({ ...base, kind: "article", jsonld: schemas.article as unknown as Json });
  rows.push({ ...base, kind: "breadcrumb", jsonld: schemas.breadcrumb as unknown as Json });
  if (schemas.faq) rows.push({ ...base, kind: "faq", jsonld: schemas.faq as unknown as Json });
  if (schemas.howto) rows.push({ ...base, kind: "howto", jsonld: schemas.howto as unknown as Json });

  await admin.from("geo_aeo_assets").upsert(rows, { onConflict: "post_id,kind" });
  return { schemas, cached: false, hash };
}

/** Inline JSON-LD `<script>` block to prepend to post content. */
export function renderInlineSchemaBlock(schemas: GeneratedSchema): string {
  const parts: string[] = [];
  const push = (obj: unknown) =>
    parts.push(`<script type="application/ld+json">${JSON.stringify(obj)}</script>`);
  push(schemas.article);
  push(schemas.breadcrumb);
  if (schemas.faq) push(schemas.faq);
  if (schemas.howto) push(schemas.howto);
  // Wrap in a marker so subsequent runs can replace it cleanly.
  return `<!-- gs-jsonld:start -->${parts.join("")}<!-- gs-jsonld:end -->`;
}

export function stripExistingSchemaBlock(html: string): string {
  return html.replace(/<!-- gs-jsonld:start -->[\s\S]*?<!-- gs-jsonld:end -->/g, "");
}