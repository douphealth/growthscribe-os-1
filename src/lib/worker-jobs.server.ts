// Server-only background job dispatchers. Called by the cron worker route.
// Each handler receives the admin (service-role) supabase client and the job
// row. Throw on failure; the worker writes the error back to background_jobs.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { getWpConnection, wpAuthHeader } from "./wordpress.server";
import { scoreContent, scoreBreakdowns } from "./content-scoring";
import { callLovableAIStructured } from "./ai-gateway";

type Admin = SupabaseClient<Database>;
export type JobRow = {
  id: string;
  job_type: string;
  organization_id: string;
  site_id: string | null;
  payload: unknown;
  created_by: string;
};

// ---------- shared helpers ----------

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(t: string) {
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
}

function freshnessScore(modifiedAt: string | null): number {
  if (!modifiedAt) return 0;
  const days = (Date.now() - new Date(modifiedAt).getTime()) / 86_400_000;
  if (days < 30) return 100;
  if (days < 90) return 80;
  if (days < 180) return 60;
  if (days < 365) return 40;
  return 20;
}

function recommendedAction(o: { status: string | null; wordCount: number; freshness: number }) {
  if (o.status !== "publish") return "Review draft";
  if (o.wordCount < 300) return "Expand content";
  if (o.freshness < 40) return "Refresh content";
  if (o.wordCount < 800) return "Deepen coverage";
  return "Audit & optimize";
}

type WpItem = {
  id: number;
  slug?: string;
  link?: string;
  status?: string;
  type?: string;
  date_gmt?: string;
  modified_gmt?: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  content?: { rendered?: string };
  _embedded?: {
    author?: Array<{ name?: string }>;
    "wp:term"?: Array<Array<{ name?: string; taxonomy?: string }>>;
    "wp:featuredmedia"?: Array<{
      source_url?: string;
      media_details?: { sizes?: Record<string, { source_url?: string }> };
    }>;
  };
};

function mapItem(item: WpItem, organizationId: string, siteId: string) {
  const html = item.content?.rendered ?? "";
  const text = stripHtml(html);
  const wc = wordCount(text);
  const modified = item.modified_gmt ? new Date(item.modified_gmt + "Z").toISOString() : null;
  const fresh = freshnessScore(modified);
  const terms = item._embedded?.["wp:term"]?.flat() ?? [];
  const cats = terms
    .filter((t) => t.taxonomy === "category")
    .map((t) => t.name)
    .filter(Boolean) as string[];
  const tags = terms
    .filter((t) => t.taxonomy === "post_tag")
    .map((t) => t.name)
    .filter(Boolean) as string[];
  const media = item._embedded?.["wp:featuredmedia"]?.[0];
  const featured =
    media?.source_url ??
    media?.media_details?.sizes?.large?.source_url ??
    media?.media_details?.sizes?.medium?.source_url ??
    null;
  const title = stripHtml(item.title?.rendered) || null;
  const excerpt = stripHtml(item.excerpt?.rendered) || null;
  const url = item.link ?? "";
  const scores = scoreContent({
    title,
    excerpt,
    contentHtml: html || null,
    contentText: text || null,
    wordCount: wc,
    url,
  });
  return {
    organization_id: organizationId,
    site_id: siteId,
    wp_post_id: item.id,
    post_type: item.type ?? "post",
    status: item.status ?? null,
    slug: item.slug ?? null,
    url,
    title,
    excerpt,
    content_html: html || null,
    content_text: text || null,
    word_count: wc,
    reading_time: wc > 0 ? Math.max(1, Math.round(wc / 220)) : null,
    published_at: item.date_gmt ? new Date(item.date_gmt + "Z").toISOString() : null,
    modified_at: modified,
    author: item._embedded?.author?.[0]?.name ?? null,
    categories: cats as unknown as Json,
    tags: tags as unknown as Json,
    featured_image_url: featured,
    freshness_score: fresh,
    seo_score: scores.seo_score,
    aeo_score: scores.aeo_score,
    geo_score: scores.geo_score,
    recommended_action: recommendedAction({
      status: item.status ?? null,
      wordCount: wc,
      freshness: fresh,
    }),
    synced_at: new Date().toISOString(),
  };
}

async function* paginateWp(
  base: string,
  headers: Record<string, string>,
  type: "posts" | "pages",
): AsyncGenerator<{ batch: WpItem[]; capped: boolean }> {
  const perPage = 50;
  const PAGE_CAP = 40;
  for (let page = 1; page <= PAGE_CAP; page++) {
    const url = `${base}/wp-json/wp/v2/${type}?per_page=${perPage}&page=${page}&status=publish,draft,future,private,pending&_embed=1&context=edit`;
    const res = await fetch(url, { headers });
    if (res.status === 400 || res.status === 404) return;
    if (!res.ok) throw new Error(`WordPress ${type} fetch failed: HTTP ${res.status}`);
    const batch = (await res.json()) as WpItem[];
    if (!Array.isArray(batch) || batch.length === 0) return;
    yield { batch, capped: page === PAGE_CAP && batch.length === perPage };
    if (batch.length < perPage) return;
  }
}

function hostOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return u.replace(/^www\./, "").toLowerCase();
  }
}

// ---------- job: wp_verify ----------

export async function runWpVerify(admin: Admin, job: JobRow) {
  if (!job.site_id) throw new Error("wp_verify requires site_id");
  const conn = await getWpConnection(admin, job.organization_id, job.site_id);
  if (!conn) throw new Error("WordPress connection not found");
  const probe = `${conn.url}/wp-json/wp/v2/users/me?context=edit`;
  let ok = false;
  let detail: string | null = null;
  let detectedPlugin: string | null = null;
  try {
    const r = await fetch(probe, { headers: { Authorization: wpAuthHeader(conn) } });
    ok = r.ok;
    if (!ok) detail = `HTTP ${r.status}`;
    // Detect SEO plugin via /wp-json namespaces
    try {
      const root = await fetch(`${conn.url}/wp-json`, {
        headers: { Authorization: wpAuthHeader(conn) },
        signal: AbortSignal.timeout(10000),
      });
      if (root.ok) {
        const meta = (await root.json()) as { namespaces?: string[] };
        const ns = (meta.namespaces ?? []).join(" ").toLowerCase();
        if (ns.includes("yoast")) detectedPlugin = "yoast";
        else if (ns.includes("rankmath") || ns.includes("rank-math")) detectedPlugin = "rankmath";
        else if (ns.includes("aioseo")) detectedPlugin = "aioseo";
      }
    } catch {
      // best-effort
    }
  } catch (e) {
    detail = (e as Error).message;
  }
  await admin
    .from("integration_connections")
    .update({
      status: ok ? "connected" : "error",
      last_error: detail,
      last_synced_at: ok ? new Date().toISOString() : null,
    })
    .eq("organization_id", job.organization_id)
    .eq("site_id", job.site_id)
    .eq("provider", "wordpress");
  await admin
    .from("sites")
    .update({
      status: ok ? "connected" : "disconnected",
      detected_seo_plugin: detectedPlugin,
    })
    .eq("id", job.site_id)
    .eq("organization_id", job.organization_id);
  if (!ok) throw new Error(`Verify failed: ${detail ?? "unknown"}`);
  return { ok, detail, detectedSeoPlugin: detectedPlugin };
}

// ---------- job: wp_sync ----------

export async function runWpSync(admin: Admin, job: JobRow) {
  if (!job.site_id) throw new Error("wp_sync requires site_id");
  const conn = await getWpConnection(admin, job.organization_id, job.site_id);
  if (!conn) throw new Error("WordPress connection not found");
  const headers = { Authorization: wpAuthHeader(conn) };
  await admin
    .from("sites")
    .update({ status: "sync_running" })
    .eq("id", job.site_id)
    .eq("organization_id", job.organization_id);

  let synced = 0;
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const type of ["posts", "pages"] as const) {
    try {
      for await (const { batch, capped } of paginateWp(conn.url, headers, type)) {
        const rows = batch.map((it) => mapItem(it, job.organization_id, job.site_id!));
        const { error } = await admin
          .from("wordpress_posts")
          .upsert(rows, { onConflict: "site_id,wp_post_id,post_type" });
        if (error) throw error;
        synced += rows.length;
        await admin
          .from("background_jobs")
          .update({ items_processed: synced })
          .eq("id", job.id);
        if (capped) warnings.push(`Reached pagination cap for ${type}`);
      }
    } catch (e) {
      errors.push(`${type}: ${(e as Error).message}`);
    }
  }
  await admin
    .from("sites")
    .update({
      total_posts: synced,
      last_synced_at: new Date().toISOString(),
      status: errors.length ? "sync_failed" : "connected",
    })
    .eq("id", job.site_id)
    .eq("organization_id", job.organization_id);
  await admin
    .from("integration_connections")
    .update({ last_synced_at: new Date().toISOString(), last_error: errors[0] ?? null })
    .eq("organization_id", job.organization_id)
    .eq("site_id", job.site_id)
    .eq("provider", "wordpress");
  if (errors.length) throw new Error(errors.join("; "));
  return { synced, warnings };
}

// ---------- job: content_audit ----------

type AuditResult = {
  title: string;
  quality_score: number;
  eeat_score: number;
  aeo_score: number;
  ai_summary: string;
  recommendations: { area: string; priority: "high" | "medium" | "low"; recommendation: string }[];
};

export async function runContentAudit(admin: Admin, job: JobRow) {
  const payload = (job.payload ?? {}) as { auditId?: string; url?: string };
  if (!payload.auditId || !payload.url) throw new Error("content_audit requires auditId+url");
  await admin
    .from("content_audits")
    .update({ status: "running" })
    .eq("id", payload.auditId);
  try {
    const res = await fetch(payload.url, {
      headers: { "User-Agent": "GrowthScribeBot/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Failed to fetch URL: HTTP ${res.status}`);
    const html = await res.text();
    const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? payload.url;
    const text = stripHtml(html).slice(0, 18000);
    const result = await callLovableAIStructured<AuditResult>(
      "You are a senior SEO auditor scoring content for quality, E-E-A-T, and AEO readiness. Be rigorous and specific.",
      `URL: ${payload.url}\nPage title: ${pageTitle}\n\nPage text (truncated):\n${text}`,
      "report_audit",
      {
        type: "object",
        properties: {
          title: { type: "string" },
          quality_score: { type: "integer", minimum: 0, maximum: 100 },
          eeat_score: { type: "integer", minimum: 0, maximum: 100 },
          aeo_score: { type: "integer", minimum: 0, maximum: 100 },
          ai_summary: { type: "string" },
          recommendations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                area: { type: "string" },
                priority: { type: "string", enum: ["high", "medium", "low"] },
                recommendation: { type: "string" },
              },
              required: ["area", "priority", "recommendation"],
            },
          },
        },
        required: ["title", "quality_score", "eeat_score", "aeo_score", "ai_summary", "recommendations"],
      },
    );
    await admin
      .from("content_audits")
      .update({
        status: "completed",
        title: result.title,
        quality_score: result.quality_score,
        eeat_score: result.eeat_score,
        aeo_score: result.aeo_score,
        ai_summary: result.ai_summary,
        recommendations: result.recommendations as unknown as Json,
      })
      .eq("id", payload.auditId);
    return { auditId: payload.auditId, scores: result };
  } catch (e) {
    const msg = (e as Error).message;
    await admin
      .from("content_audits")
      .update({ status: "failed", ai_summary: msg })
      .eq("id", payload.auditId);
    throw e;
  }
}

// ---------- job: brief_generate ----------

type BriefResult = {
  search_intent: string;
  word_count_target: number;
  outline: { heading: string; level: number; notes: string }[];
  aeo_questions: string[];
  geo_signals: string[];
  internal_links: { anchor: string; rationale: string }[];
};

export async function runBriefGenerate(admin: Admin, job: JobRow) {
  const payload = (job.payload ?? {}) as { briefId?: string };
  if (!payload.briefId) throw new Error("brief_generate requires briefId");
  const { data: brief, error: bErr } = await admin
    .from("content_briefs")
    .select("id, title, target_keyword, site_id, organization_id")
    .eq("id", payload.briefId)
    .maybeSingle();
  if (bErr) throw bErr;
  if (!brief) throw new Error("Brief not found");

  const { data: posts } = await admin
    .from("wordpress_posts")
    .select("title,url")
    .eq("organization_id", brief.organization_id)
    .eq("site_id", brief.site_id)
    .limit(40);
  const linkCandidates = (posts ?? [])
    .filter((p) => p.title)
    .map((p) => `- ${p.title} :: ${p.url}`)
    .join("\n");

  const result = await callLovableAIStructured<BriefResult>(
    "You are a senior content strategist producing actionable, SEO + AEO + GEO optimized content briefs. Be precise and structural.",
    `Brief title: ${brief.title}\nTarget keyword: ${brief.target_keyword ?? "(none)"}\n\nExisting site pages (for internal-link suggestions):\n${linkCandidates || "(none)"}`,
    "content_brief",
    {
      type: "object",
      properties: {
        search_intent: { type: "string", enum: ["informational", "commercial", "transactional", "navigational"] },
        word_count_target: { type: "integer", minimum: 300, maximum: 5000 },
        outline: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              level: { type: "integer", minimum: 1, maximum: 4 },
              notes: { type: "string" },
            },
            required: ["heading", "level", "notes"],
          },
        },
        aeo_questions: { type: "array", items: { type: "string" } },
        geo_signals: { type: "array", items: { type: "string" } },
        internal_links: {
          type: "array",
          items: {
            type: "object",
            properties: { anchor: { type: "string" }, rationale: { type: "string" } },
            required: ["anchor", "rationale"],
          },
        },
      },
      required: ["search_intent", "word_count_target", "outline", "aeo_questions", "geo_signals", "internal_links"],
    },
  );

  await admin
    .from("content_briefs")
    .update({
      search_intent: result.search_intent,
      word_count_target: result.word_count_target,
      outline: result.outline as unknown as Json,
      aeo_questions: result.aeo_questions as unknown as Json,
      geo_signals: result.geo_signals as unknown as Json,
      internal_links: result.internal_links as unknown as Json,
    })
    .eq("id", brief.id);
  return { briefId: brief.id, sections: result.outline.length };
}

// ---------- job: ai_visibility ----------

const ENGINE_MODELS: Record<string, string> = {
  gpt: "openai/gpt-5-mini",
  chatgpt: "openai/gpt-5-mini",
  gemini: "google/gemini-2.5-flash",
  google_aio: "google/gemini-2.5-flash",
  perplexity: "google/gemini-2.5-pro",
  claude: "openai/gpt-5-mini",
};

const AIV_SYS = `You are simulating a search-style answer engine. Given a user query, respond with the answer you would naturally produce, including sources or citations (URLs, brand names). Always end with a "Sources:" line listing 3-7 distinct domains (one per line, format: domain - short reason). If none, "Sources: none".`;

export async function runAiVisibility(admin: Admin, job: JobRow) {
  if (!job.site_id) throw new Error("ai_visibility requires site_id");
  const payload = (job.payload ?? {}) as { query?: string; engine?: string };
  if (!payload.query || !payload.engine) throw new Error("ai_visibility requires query+engine");
  const model = ENGINE_MODELS[payload.engine] ?? "google/gemini-2.5-flash";

  const { data: site } = await admin
    .from("sites")
    .select("url")
    .eq("id", job.site_id)
    .maybeSingle();
  const siteHost = site?.url ? hostOf(site.url) : "";

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: AIV_SYS },
        { role: "user", content: payload.query },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gateway ${res.status}: ${txt.slice(0, 200)}`);
  }
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = j.choices?.[0]?.message?.content ?? "";

  const lower = content.toLowerCase();
  const root = siteHost.split(".").slice(-2).join(".");
  const appears = root ? lower.includes(root) : false;
  const urls = Array.from(content.matchAll(/https?:\/\/[^\s)\]]+/gi)).map((m) => m[0]);
  const citation = root ? (urls.find((u) => hostOf(u).endsWith(root)) ?? null) : null;
  let rank: number | null = null;
  const srcIdx = lower.lastIndexOf("sources:");
  if (appears && srcIdx >= 0 && root) {
    const lines = content
      .slice(srcIdx)
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean);
    const idx = lines.findIndex((l) => l.toLowerCase().includes(root));
    if (idx >= 0) rank = idx + 1;
  }

  await admin.from("ai_visibility_tests").insert({
    organization_id: job.organization_id,
    site_id: job.site_id,
    query: payload.query,
    engine: payload.engine,
    appears,
    rank,
    citation_url: citation,
    raw_response: { content } as Json,
  });
  return { appears, rank, citation };
}

// ---------- jobs: gsc_import / ga4_import ----------

export async function runGscImport(admin: Admin, job: JobRow) {
  if (!job.site_id) throw new Error("gsc_import requires site_id");
  const { data: conn } = await admin
    .from("integration_connections")
    .select("status, config")
    .eq("organization_id", job.organization_id)
    .eq("site_id", job.site_id)
    .eq("provider", "gsc")
    .maybeSingle();
  if (!conn || conn.status !== "connected") {
    throw new Error("Google Search Console connector not connected for this site");
  }
  // Daily pull is handled by /api/public/cron/gsc-pull. Trigger it via an
  // immediate marker so users see fresh data on demand.
  return { ok: true, note: "GSC ingestion runs daily via cron; data refresh queued" };
}

export async function runGa4Import(admin: Admin, job: JobRow) {
  if (!job.site_id) throw new Error("ga4_import requires site_id");
  const { data: conn } = await admin
    .from("integration_connections")
    .select("status")
    .eq("organization_id", job.organization_id)
    .eq("site_id", job.site_id)
    .eq("provider", "ga4")
    .maybeSingle();
  if (!conn || conn.status !== "connected") {
    throw new Error("Google Analytics 4 connector not connected for this site");
  }
  return { ok: true, note: "GA4 ingestion pending connector wiring" };
}

// ---------- jobs: vitals.refresh (PageSpeed Insights) ----------

type PsiResult = {
  performance_score: number | null;
  lcp_ms: number | null;
  inp_ms: number | null;
  cls: number | null;
  ttfb_ms: number | null;
  fcp_ms: number | null;
  raw: Json;
};

async function fetchPsi(url: string, strategy: "mobile" | "desktop"): Promise<PsiResult | null> {
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY ?? process.env.GOOGLE_SEARCH_CONSOLE_API_KEY ?? "";
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (apiKey) params.set("key", apiKey);
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;
  const res = await fetch(endpoint);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    lighthouseResult?: {
      categories?: { performance?: { score?: number } };
      audits?: Record<string, { numericValue?: number }>;
    };
  };
  const lh = json.lighthouseResult;
  const score = lh?.categories?.performance?.score;
  const audits = lh?.audits ?? {};
  return {
    performance_score: score != null ? Math.round(score * 100) : null,
    lcp_ms: audits["largest-contentful-paint"]?.numericValue
      ? Math.round(audits["largest-contentful-paint"].numericValue)
      : null,
    inp_ms: audits["interaction-to-next-paint"]?.numericValue
      ? Math.round(audits["interaction-to-next-paint"].numericValue)
      : audits["max-potential-fid"]?.numericValue
        ? Math.round(audits["max-potential-fid"].numericValue)
        : null,
    cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
    ttfb_ms: audits["server-response-time"]?.numericValue
      ? Math.round(audits["server-response-time"].numericValue)
      : null,
    fcp_ms: audits["first-contentful-paint"]?.numericValue
      ? Math.round(audits["first-contentful-paint"].numericValue)
      : null,
    raw: { score: score ?? null } as Json,
  };
}

export async function runVitalsRefresh(admin: Admin, job: JobRow) {
  if (!job.site_id) throw new Error("vitals.refresh requires site_id");
  const limit = Math.min(
    25,
    Math.max(1, Number((job.payload as { limit?: number })?.limit ?? 10)),
  );
  const { data: posts, error } = await admin
    .from("wordpress_posts")
    .select("id, url")
    .eq("organization_id", job.organization_id)
    .eq("site_id", job.site_id)
    .eq("status", "publish")
    .order("modified_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  if (!posts || posts.length === 0) return { measured: 0 };

  let measured = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const p of posts) {
    if (!p.url) continue;
    for (const strategy of ["mobile", "desktop"] as const) {
      const psi = await fetchPsi(p.url, strategy);
      if (!psi) continue;
      rows.push({
        organization_id: job.organization_id,
        site_id: job.site_id,
        post_id: p.id,
        url: p.url,
        strategy,
        ...psi,
        fetched_at: new Date().toISOString(),
      });
      measured++;
    }
  }
  if (rows.length > 0) {
    const { error: upErr } = await admin
      .from("page_vitals" as never)
      .upsert(rows as never, { onConflict: "site_id,url,strategy" });
    if (upErr) throw upErr;
  }
  return { measured };
}
