import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

const orgSite = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
});

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

async function audit(
  supabase: SB,
  userId: string,
  organizationId: string,
  action: string,
  resourceId: string | null,
  metadata: Json,
) {
  await supabase.from("audit_logs").insert({
    actor_id: userId,
    organization_id: organizationId,
    action,
    resource_type: "wordpress",
    resource_id: resourceId,
    metadata,
  });
}

async function getConnection(
  supabase: SB,
  organizationId: string,
  siteId: string,
): Promise<{ url: string; username: string; appPassword: string } | null> {
  const { data, error } = await supabase
    .from("integration_connections")
    .select("config")
    .eq("organization_id", organizationId)
    .eq("site_id", siteId)
    .eq("provider", "wordpress")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const cfg = (data.config ?? {}) as Record<string, unknown>;
  const url = typeof cfg.url === "string" ? cfg.url : null;
  const username = typeof cfg.username === "string" ? cfg.username : null;
  const appPassword = typeof cfg.app_password === "string" ? cfg.app_password : null;
  if (!url || !username || !appPassword) return null;
  return { url, username, appPassword };
}

function authHeader(username: string, appPassword: string) {
  const token = Buffer.from(`${username}:${appPassword}`).toString("base64");
  return `Basic ${token}`;
}

function normalizeUrl(raw: string) {
  return raw.replace(/\/+$/, "");
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
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

function recommendedAction(opts: {
  status: string | null;
  wordCount: number;
  freshness: number;
}): string {
  if (opts.status !== "publish") return "Review draft";
  if (opts.wordCount < 300) return "Expand content";
  if (opts.freshness < 40) return "Refresh content";
  if (opts.wordCount < 800) return "Deepen coverage";
  return "Audit & optimize";
}

// ---------------------------------------------------------------------------

export const verifyWordpressConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgSite.extend({
      url: z.string().url().max(500),
      username: z.string().min(1).max(120),
      appPassword: z.string().min(8).max(200),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const base = normalizeUrl(data.url);
    const probe = `${base}/wp-json/wp/v2/users/me?context=edit`;
    let ok = false;
    let detail: string | null = null;
    try {
      const res = await fetch(probe, {
        headers: { Authorization: authHeader(data.username, data.appPassword) },
      });
      ok = res.ok;
      if (!res.ok) detail = `HTTP ${res.status}`;
    } catch (err) {
      detail = (err as Error).message;
    }

    const { error: upErr } = await supabase
      .from("integration_connections")
      .upsert(
        {
          organization_id: data.organizationId,
          site_id: data.siteId,
          provider: "wordpress",
          status: ok ? "connected" : "error",
          created_by: userId,
          last_error: ok ? null : detail,
          last_synced_at: ok ? new Date().toISOString() : null,
          config: {
            url: base,
            username: data.username,
            app_password: data.appPassword,
          } as Json,
        },
        { onConflict: "organization_id,site_id,provider" },
      );
    if (upErr) {
      // Fallback when no unique constraint exists: delete + insert
      await supabase
        .from("integration_connections")
        .delete()
        .eq("organization_id", data.organizationId)
        .eq("site_id", data.siteId)
        .eq("provider", "wordpress");
      await supabase.from("integration_connections").insert({
        organization_id: data.organizationId,
        site_id: data.siteId,
        provider: "wordpress",
        status: ok ? "connected" : "error",
        created_by: userId,
        last_error: ok ? null : detail,
        last_synced_at: ok ? new Date().toISOString() : null,
        config: {
          url: base,
          username: data.username,
          app_password: data.appPassword,
        } as Json,
      });
    }

    if (ok) {
      await supabase
        .from("sites")
        .update({ status: "connected", wp_username: data.username })
        .eq("id", data.siteId)
        .eq("organization_id", data.organizationId);
    }

    await audit(supabase, userId, data.organizationId, "wp.verify", data.siteId, {
      ok, detail,
    } as Json);

    return { ok, detail };
  });

// ---------------------------------------------------------------------------

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
  author?: number;
  categories?: number[];
  tags?: number[];
  _embedded?: {
    author?: Array<{ name?: string }>;
    "wp:term"?: Array<Array<{ name?: string; taxonomy?: string }>>;
  };
};

async function fetchAll(base: string, headers: Record<string, string>, type: "posts" | "pages") {
  const out: WpItem[] = [];
  let page = 1;
  const perPage = 50;
  // safety cap: 20 pages = 1000 items per type
  while (page <= 20) {
    const url = `${base}/wp-json/wp/v2/${type}?per_page=${perPage}&page=${page}&status=publish,draft,future,private,pending&_embed=1&context=edit`;
    const res = await fetch(url, { headers });
    if (res.status === 400 || res.status === 404) break;
    if (!res.ok) throw new Error(`WordPress ${type} fetch failed: HTTP ${res.status}`);
    const batch = (await res.json()) as WpItem[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return out;
}

function mapItem(item: WpItem, organizationId: string, siteId: string) {
  const html = item.content?.rendered ?? "";
  const text = stripHtml(html);
  const wc = wordCount(text);
  const modified = item.modified_gmt ? new Date(item.modified_gmt + "Z").toISOString() : null;
  const fresh = freshnessScore(modified);
  const cats = item._embedded?.["wp:term"]?.flat()?.filter((t) => t.taxonomy === "category").map((t) => t.name).filter(Boolean) ?? [];
  const tags = item._embedded?.["wp:term"]?.flat()?.filter((t) => t.taxonomy === "post_tag").map((t) => t.name).filter(Boolean) ?? [];
  return {
    organization_id: organizationId,
    site_id: siteId,
    wp_post_id: item.id,
    post_type: item.type ?? "post",
    status: item.status ?? null,
    slug: item.slug ?? null,
    url: item.link ?? "",
    title: stripHtml(item.title?.rendered) || null,
    excerpt: stripHtml(item.excerpt?.rendered) || null,
    content_html: html || null,
    content_text: text || null,
    word_count: wc,
    published_at: item.date_gmt ? new Date(item.date_gmt + "Z").toISOString() : null,
    modified_at: modified,
    author: item._embedded?.author?.[0]?.name ?? null,
    categories: cats as unknown as Json,
    tags: tags as unknown as Json,
    freshness_score: fresh,
    recommended_action: recommendedAction({
      status: item.status ?? null, wordCount: wc, freshness: fresh,
    }),
    synced_at: new Date().toISOString(),
  };
}

export const syncWordpressContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => orgSite.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const conn = await getConnection(supabase, data.organizationId, data.siteId);
    if (!conn) throw new Error("WordPress is not connected for this site");
    const headers = { Authorization: authHeader(conn.username, conn.appPassword) };

    let synced = 0;
    const errors: string[] = [];
    try {
      const [posts, pages] = await Promise.all([
        fetchAll(conn.url, headers, "posts").catch((e) => { errors.push(`posts: ${e.message}`); return [] as WpItem[]; }),
        fetchAll(conn.url, headers, "pages").catch((e) => { errors.push(`pages: ${e.message}`); return [] as WpItem[]; }),
      ]);
      const rows = [...posts, ...pages].map((it) => mapItem(it, data.organizationId, data.siteId));
      // Upsert in chunks
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { error } = await supabase
          .from("wordpress_posts")
          .upsert(chunk, { onConflict: "site_id,wp_post_id" });
        if (error) throw error;
        synced += chunk.length;
      }
      await supabase
        .from("sites")
        .update({ total_posts: synced, last_synced_at: new Date().toISOString() })
        .eq("id", data.siteId)
        .eq("organization_id", data.organizationId);
    } catch (err) {
      const msg = (err as Error).message;
      await audit(supabase, userId, data.organizationId, "wp.sync.error", data.siteId, {
        message: msg, synced,
      } as Json);
      throw err;
    }

    await audit(supabase, userId, data.organizationId, "wp.sync", data.siteId, {
      synced, errors,
    } as Json);
    return { synced, errors };
  });

// ---------------------------------------------------------------------------

export const fetchWordpressPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => orgSite.extend({ wpPostId: z.number().int().positive() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const conn = await getConnection(supabase, data.organizationId, data.siteId);
    if (!conn) throw new Error("WordPress is not connected for this site");
    const res = await fetch(
      `${conn.url}/wp-json/wp/v2/posts/${data.wpPostId}?_embed=1&context=edit`,
      { headers: { Authorization: authHeader(conn.username, conn.appPassword) } },
    );
    if (!res.ok) throw new Error(`WordPress fetch failed: HTTP ${res.status}`);
    const item = (await res.json()) as WpItem;
    return mapItem(item, data.organizationId, data.siteId);
  });

// ---------------------------------------------------------------------------

const draftFields = z.object({
  title: z.string().min(1).max(300),
  content: z.string().min(1),
  excerpt: z.string().max(2000).optional(),
  slug: z.string().max(200).optional(),
});

export const createWordpressDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => orgSite.merge(draftFields).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const conn = await getConnection(supabase, data.organizationId, data.siteId);
    if (!conn) {
      await audit(supabase, userId, data.organizationId, "wp.draft.create.denied", data.siteId, {
        reason: "not_connected",
      } as Json);
      throw new Error("WordPress is not connected for this site");
    }
    // Always force status=draft. No auto-publish.
    const res = await fetch(`${conn.url}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(conn.username, conn.appPassword),
      },
      body: JSON.stringify({
        status: "draft",
        title: data.title,
        content: data.content,
        excerpt: data.excerpt ?? "",
        slug: data.slug,
      }),
    });
    const ok = res.ok;
    let body: WpItem | null = null;
    try { body = (await res.json()) as WpItem; } catch { /* ignore */ }
    await audit(supabase, userId, data.organizationId, "wp.draft.create", data.siteId, {
      ok, status: res.status, wp_id: body?.id ?? null, title: data.title,
    } as Json);
    if (!ok) throw new Error(`Create draft failed: HTTP ${res.status}`);
    return { wpPostId: body?.id ?? null, link: body?.link ?? null };
  });

export const updateWordpressDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgSite.extend({
      wpPostId: z.number().int().positive(),
    }).merge(draftFields.partial()).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const conn = await getConnection(supabase, data.organizationId, data.siteId);
    if (!conn) {
      await audit(supabase, userId, data.organizationId, "wp.draft.update.denied", data.siteId, {
        reason: "not_connected", wp_id: data.wpPostId,
      } as Json);
      throw new Error("WordPress is not connected for this site");
    }
    // Force status=draft. Approval workflow gates publishing.
    const res = await fetch(`${conn.url}/wp-json/wp/v2/posts/${data.wpPostId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(conn.username, conn.appPassword),
      },
      body: JSON.stringify({
        status: "draft",
        title: data.title,
        content: data.content,
        excerpt: data.excerpt,
        slug: data.slug,
      }),
    });
    const ok = res.ok;
    await audit(supabase, userId, data.organizationId, "wp.draft.update", data.siteId, {
      ok, status: res.status, wp_id: data.wpPostId,
    } as Json);
    if (!ok) throw new Error(`Update draft failed: HTTP ${res.status}`);
    return { wpPostId: data.wpPostId };
  });