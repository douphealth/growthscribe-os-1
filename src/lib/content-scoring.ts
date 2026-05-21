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

export type ScoreDimension =
  | "technical_seo"
  | "content_quality"
  | "eeat"
  | "aeo"
  | "geo"
  | "topical_authority"
  | "internal_link"
  | "revenue_opportunity"
  | "content_decay"
  | "growth_opportunity";

export type ScoreBreakdown = {
  score_type: ScoreDimension;
  score: number;
  explanation: string;
  evidence: Record<string, unknown>;
  recommended_actions: string[];
  estimated_impact: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
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

/**
 * Produce an array of explainable score breakdowns suitable for persisting to
 * `score_breakdowns`. Built on the same signals as `scoreContent` but each
 * dimension carries its own evidence + recommended actions + confidence.
 */
export function scoreBreakdowns(input: ScoreInput): ScoreBreakdown[] {
  const html = input.contentHtml ?? "";
  const text = input.contentText ?? stripTags(html);
  const title = (input.title ?? "").trim();
  const excerpt = (input.excerpt ?? "").trim();
  const wc = input.wordCount ?? text.split(/\s+/).filter(Boolean).length;
  const titleLen = title.length;
  const excerptLen = excerpt.length;

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
    ? (html.match(
        new RegExp(`<a\\b[^>]*href=["'][^"']*${host.replace(/\./g, "\\.")}`, "gi"),
      ) ?? []).length
    : 0;
  const externalLinks = Math.max(0, links.length - internalLinks);
  const lists = (html.match(/<(ul|ol)\b/gi) ?? []).length;
  const tables = (html.match(/<table\b/gi) ?? []).length;
  const hasSchema = /schema\.org|application\/ld\+json/i.test(html);
  const hasByline = /author|by\s+[A-Z][a-z]+/i.test(html);
  const hasStats = /\b\d+(\.\d+)?\s*(%|percent|million|billion|users|customers)\b/i.test(text);
  const headingMatches = html.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi) ?? [];
  const questionHeadings = headingMatches.filter(
    (h) => QUESTION_WORDS.test(stripTags(h)) || /\?/.test(h),
  ).length;

  const base = scoreContent(input);

  const breakdowns: ScoreBreakdown[] = [];

  // 1. Technical SEO
  {
    const actions: string[] = [];
    if (titleLen === 0) actions.push("Add a 50-60 character SEO title");
    else if (titleLen < 30 || titleLen > 65) actions.push(`Tune title length (currently ${titleLen} chars; target 30-65)`);
    if (excerptLen === 0) actions.push("Write a 110-160 character meta description");
    if (h1 > 1) actions.push(`Reduce to one H1 (found ${h1})`);
    if (headings < 3) actions.push("Add more H2/H3 subheadings for structure");
    if (imgs.length > 0 && imgsWithAlt / imgs.length < 0.8)
      actions.push(`Add alt text to images (${imgsWithAlt}/${imgs.length} have alt)`);
    const score = Math.round((base.seo_score * 0.7) + (titleLen >= 30 && titleLen <= 65 ? 15 : 0) + (excerptLen >= 110 ? 15 : 0));
    breakdowns.push({
      score_type: "technical_seo",
      score: clamp(score),
      explanation: "Composite of title/meta length, heading hierarchy, image alt coverage, and link density.",
      evidence: { titleLen, excerptLen, h1, h2, h3, imgs: imgs.length, imgsWithAlt, internalLinks, externalLinks },
      recommended_actions: actions,
      estimated_impact: actions.length >= 3 ? "high" : actions.length >= 1 ? "medium" : "low",
      confidence: "high",
    });
  }

  // 2. Content quality
  {
    const actions: string[] = [];
    if (wc < 300) actions.push("Expand content — under 300 words is thin");
    else if (wc < 800) actions.push("Deepen coverage to 1000+ words for competitive topics");
    if (headings < 3) actions.push("Break content into more sections");
    const score =
      (wc >= 1500 ? 60 : wc >= 800 ? 45 : wc >= 300 ? 25 : 10) +
      (headings >= 6 ? 25 : headings >= 3 ? 15 : 5) +
      (lists + tables >= 2 ? 15 : 5);
    breakdowns.push({
      score_type: "content_quality",
      score: clamp(score),
      explanation: "Word count, structural depth, and use of lists/tables.",
      evidence: { wordCount: wc, headings, lists, tables },
      recommended_actions: actions,
      estimated_impact: wc < 500 ? "high" : "medium",
      confidence: "high",
    });
  }

  // 3. E-E-A-T
  {
    const actions: string[] = [];
    if (!hasByline) actions.push("Add a visible author byline with credentials");
    if (externalLinks < 2) actions.push("Cite 2+ authoritative external sources");
    if (!hasStats) actions.push("Include concrete stats or data points");
    const score =
      (hasByline ? 30 : 0) +
      (externalLinks >= 3 ? 30 : externalLinks >= 1 ? 15 : 0) +
      (hasStats ? 20 : 0) +
      (hasSchema ? 20 : 0);
    breakdowns.push({
      score_type: "eeat",
      score: clamp(score),
      explanation: "Author signals, external citations, concrete data, and schema markup.",
      evidence: { hasByline, externalLinks, hasStats, hasSchema },
      recommended_actions: actions,
      estimated_impact: actions.length >= 2 ? "high" : "medium",
      confidence: "medium",
    });
  }

  // 4. AEO
  {
    const actions: string[] = [];
    if (questionHeadings < 3) actions.push("Add 3-5 question-style H2/H3 headings");
    if (!/faq|frequently asked/i.test(html)) actions.push("Add an FAQ section with FAQPage schema");
    if (!hasSchema) actions.push("Embed structured data (FAQPage / HowTo / Article)");
    breakdowns.push({
      score_type: "aeo",
      score: base.aeo_score,
      explanation: "Question headings, FAQ markup, list/table formatting, and snippet-ready paragraphs.",
      evidence: { questionHeadings, hasFaq: /faq|frequently asked/i.test(html), lists, tables, hasSchema },
      recommended_actions: actions,
      estimated_impact: questionHeadings < 1 ? "high" : "medium",
      confidence: "high",
    });
  }

  // 5. GEO (generative engine optimization)
  {
    const actions: string[] = [];
    if (externalLinks < 3) actions.push("Cite more primary sources (3+ external links)");
    if (!hasStats) actions.push("Add quantitative claims AI engines can quote");
    if (!/\b(20\d{2})\b/.test(text)) actions.push("Include a recent year marker (freshness)");
    breakdowns.push({
      score_type: "geo",
      score: base.geo_score,
      explanation: "Citations, freshness markers, statistics, and depth that make pages quotable by LLMs.",
      evidence: { externalLinks, hasStats, hasSchema, wordCount: wc },
      recommended_actions: actions,
      estimated_impact: "medium",
      confidence: "medium",
    });
  }

  // 6. Internal link
  {
    const actions: string[] = [];
    if (internalLinks < 3) actions.push(`Add internal links (currently ${internalLinks}; target 3-8)`);
    if (internalLinks > 25) actions.push("Trim excessive internal links — may dilute authority");
    const score =
      internalLinks >= 5 && internalLinks <= 20
        ? 90
        : internalLinks >= 3
          ? 70
          : internalLinks >= 1
            ? 40
            : 10;
    breakdowns.push({
      score_type: "internal_link",
      score: clamp(score),
      explanation: "Number of contextual internal links to other pages on this site.",
      evidence: { internalLinks, externalLinks },
      recommended_actions: actions,
      estimated_impact: internalLinks < 2 ? "high" : "low",
      confidence: "high",
    });
  }

  // 7-10. Topical / Revenue / Decay / Growth — v0 signals only, low confidence
  breakdowns.push({
    score_type: "topical_authority",
    score: clamp(Math.min(100, headings * 8 + (wc / 30))),
    explanation: "Heuristic based on coverage depth — full topical scoring lands in Pass 3.",
    evidence: { wordCount: wc, headings },
    recommended_actions: ["Cluster this page under a pillar topic", "Cover adjacent subtopics"],
    estimated_impact: "medium",
    confidence: "low",
  });
  breakdowns.push({
    score_type: "revenue_opportunity",
    score: clamp(50),
    explanation: "Placeholder — requires GA4 revenue data (Pass 2).",
    evidence: {},
    recommended_actions: ["Connect GA4 to unlock revenue-weighted prioritization"],
    estimated_impact: "medium",
    confidence: "low",
  });
  breakdowns.push({
    score_type: "content_decay",
    score: clamp(50),
    explanation: "Placeholder — requires GSC trend history (Pass 2).",
    evidence: {},
    recommended_actions: ["Connect Google Search Console to detect decaying pages"],
    estimated_impact: "medium",
    confidence: "low",
  });
  breakdowns.push({
    score_type: "growth_opportunity",
    score: clamp(Math.round((base.seo_score + base.aeo_score + base.geo_score) / 3)),
    explanation: "Composite of SEO + AEO + GEO. Refined with GSC striking-distance data in Pass 2.",
    evidence: { seo: base.seo_score, aeo: base.aeo_score, geo: base.geo_score },
    recommended_actions: ["Prioritize pages with mid-range scores and rising impressions"],
    estimated_impact: "high",
    confidence: "medium",
  });

  return breakdowns;
}
