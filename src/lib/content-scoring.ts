// Deterministic heuristic SEO / AEO / GEO scoring for synced WordPress posts.
// All scores are 0-100 ints. No network, no LLM — fast and explainable.

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ScoreInput = {
  title: string | null;
  excerpt: string | null;
  contentHtml: string | null;
  contentText: string | null;
  wordCount: number | null;
  url: string;
};

export type ScoreOutput = {
  seo_score: number;
  aeo_score: number;
  geo_score: number;
};

const QUESTION_WORDS = /\b(what|how|why|when|where|which|who|is|are|can|should|does|do)\b/i;

export function scoreContent(input: ScoreInput): ScoreOutput {
  const html = input.contentHtml ?? "";
  const text = input.contentText ?? stripTags(html);
  const title = (input.title ?? "").trim();
  const excerpt = (input.excerpt ?? "").trim();
  const wc = input.wordCount ?? text.split(/\s+/).filter(Boolean).length;

  const h1 = (html.match(/<h1\b/gi) ?? []).length;
  const h2 = (html.match(/<h2\b/gi) ?? []).length;
  const h3 = (html.match(/<h3\b/gi) ?? []).length;
  const headings = h2 + h3;
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const imgsWithAlt = imgs.filter((t) => /\balt\s*=\s*"[^"]+"/i.test(t)).length;
  const links = html.match(/<a\b[^>]*href=/gi) ?? [];

  let host = "";
  try {
    host = new URL(input.url).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  const internalLinks = host
    ? (html.match(new RegExp(`<a\\b[^>]*href=["'][^"']*${host.replace(/\./g, "\\.")}`, "gi")) ?? [])
        .length
    : 0;
  const externalLinks = Math.max(0, links.length - internalLinks);

  const lists = (html.match(/<(ul|ol)\b/gi) ?? []).length;
  const tables = (html.match(/<table\b/gi) ?? []).length;
  const blockquotes = (html.match(/<blockquote\b/gi) ?? []).length;

  // ---- SEO ----
  // Title (0-25), meta/excerpt (0-10), word count (0-25),
  // headings (0-15), images+alt (0-10), internal links (0-10), external refs (0-5).
  let seo = 0;
  if (title) {
    const len = title.length;
    if (len >= 30 && len <= 65) seo += 25;
    else if (len >= 20 && len <= 80) seo += 18;
    else if (len > 0) seo += 10;
  }
  if (excerpt) {
    const len = excerpt.length;
    if (len >= 110 && len <= 170) seo += 10;
    else if (len >= 60) seo += 6;
    else seo += 3;
  }
  if (wc >= 1500) seo += 25;
  else if (wc >= 800) seo += 20;
  else if (wc >= 500) seo += 14;
  else if (wc >= 300) seo += 8;
  if (h1 <= 1) seo += 5; // single H1 (or none, since title acts as H1)
  if (headings >= 6) seo += 10;
  else if (headings >= 3) seo += 7;
  else if (headings >= 1) seo += 3;
  if (imgs.length === 0) seo += 2;
  else seo += Math.min(10, Math.round((imgsWithAlt / imgs.length) * 10));
  if (internalLinks >= 5) seo += 10;
  else if (internalLinks >= 2) seo += 6;
  else if (internalLinks >= 1) seo += 3;
  if (externalLinks >= 2) seo += 5;
  else if (externalLinks >= 1) seo += 3;

  // ---- AEO (Answer Engine Optimization) ----
  // Question headings, FAQ markup, lists, definitions, short answer-ready paragraphs.
  let aeo = 0;
  const headingMatches = html.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi) ?? [];
  const questionHeadings = headingMatches.filter((h) =>
    QUESTION_WORDS.test(stripTags(h)) || /\?/.test(h),
  ).length;
  if (questionHeadings >= 5) aeo += 30;
  else if (questionHeadings >= 3) aeo += 22;
  else if (questionHeadings >= 1) aeo += 12;
  if (lists >= 3) aeo += 20;
  else if (lists >= 1) aeo += 10;
  if (/faq|frequently asked/i.test(html)) aeo += 10;
  if (/<dl\b|<dt\b|<dfn\b/i.test(html)) aeo += 5;
  if (tables >= 1) aeo += 8;
  // Reward concise paragraphs (40-60 words ~ snippet-ready)
  const paras = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) ?? [];
  const conciseParas = paras.filter((p) => {
    const words = stripTags(p).split(/\s+/).filter(Boolean).length;
    return words >= 30 && words <= 80;
  }).length;
  if (conciseParas >= 5) aeo += 17;
  else if (conciseParas >= 2) aeo += 10;
  else if (conciseParas >= 1) aeo += 5;
  if (/schema\.org|application\/ld\+json/i.test(html)) aeo += 10;

  // ---- GEO (Generative Engine Optimization) ----
  // Citations, structured data, freshness markers, named entities, depth.
  let geo = 0;
  if (externalLinks >= 5) geo += 20;
  else if (externalLinks >= 2) geo += 12;
  else if (externalLinks >= 1) geo += 6;
  if (/<cite\b|sources?:|references?:/i.test(html)) geo += 8;
  if (tables >= 1) geo += 10;
  if (lists >= 2) geo += 8;
  if (blockquotes >= 1) geo += 5;
  if (/\b(20\d{2})\b/.test(text)) geo += 5; // year mention = recency signal
  if (/\b\d+(\.\d+)?\s*(%|percent|million|billion|users|customers)\b/i.test(text)) geo += 8; // stats
  if (wc >= 2000) geo += 22;
  else if (wc >= 1200) geo += 16;
  else if (wc >= 700) geo += 10;
  else if (wc >= 400) geo += 5;
  if (/author|by\s+[A-Z][a-z]+/i.test(html)) geo += 6; // byline / E-E-A-T
  if (/schema\.org|application\/ld\+json/i.test(html)) geo += 8;

  return {
    seo_score: clamp(seo),
    aeo_score: clamp(aeo),
    geo_score: clamp(geo),
  };
}
