import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type SB = SupabaseClient<Database>;
type EncryptedSecret = {
  v: 1;
  alg: "AES-GCM";
  iv: string;
  ciphertext: string;
};

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
  const appPassword = isEncryptedSecret(cfg.encrypted_app_password)
    ? await decryptSecret(cfg.encrypted_app_password)
    : null;
  if (!url || !username || !appPassword) return null;
  return { url, username, appPassword };
}

function getEncryptionMaterial() {
  const material = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.LOVABLE_API_KEY;
  if (!material) throw new Error("Server credential encryption key is not configured");
  return material;
}

function b64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function fromB64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function encryptionKey() {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(getEncryptionMaterial()),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function isEncryptedSecret(value: unknown): value is EncryptedSecret {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<EncryptedSecret>;
  return (
    maybe.v === 1 &&
    maybe.alg === "AES-GCM" &&
    typeof maybe.iv === "string" &&
    typeof maybe.ciphertext === "string"
  );
}

async function encryptSecret(secret: string): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(secret),
  );
  return { v: 1, alg: "AES-GCM", iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
}

async function decryptSecret(secret: EncryptedSecret): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(secret.iv) },
    await encryptionKey(),
    fromB64(secret.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
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
    orgSite
      .extend({
        url: z.string().url().max(500),
        username: z.string().min(1).max(120),
        appPassword: z.string().min(8).max(200),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const base = normalizeUrl(data.url);
    await supabase
      .from("sites")
      .update({ status: "verifying" })
      .eq("id", data.siteId)
      .eq("organization_id", data.organizationId);
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

    await supabase
      .from("integration_connections")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("provider", "wordpress");
    const encryptedAppPassword = await encryptSecret(data.appPassword);
    const { error: insErr } = await supabase.from("integration_connections").insert({
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
        encrypted_app_password: encryptedAppPassword,
      } as Json,
    });
    if (insErr) throw insErr;

    await supabase
      .from("sites")
      .update({
        status: ok ? "connected" : "disconnected",
        wp_username: data.username,
      })
      .eq("id", data.siteId)
      .eq("organization_id", data.organizationId);

    await audit(supabase, userId, data.organizationId, "wp.credential.update", data.siteId, {
      url: base,
      username: data.username,
      ok,
    } as Json);

    await audit(supabase, userId, data.organizationId, "wp.verify", data.siteId, {
      ok,
      detail,
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
    "wp:featuredmedia"?: Array<{
      source_url?: string;
      media_details?: { sizes?: Record<string, { source_url?: string }> };
    }>;
  };
};

async function* paginate(
  base: string,
  headers: Record<string, string>,
  type: "posts" | "pages",
): AsyncGenerator<{ batch: WpItem[]; total: number | null; page: number; capped: boolean }> {
  let page = 1;
  const perPage = 50;
  const PAGE_CAP = 40; // safety cap: 40 pages = 2000 items per type
  while (page <= PAGE_CAP) {
    const url = `${base}/wp-json/wp/v2/${type}?per_page=${perPage}&page=${page}&status=publish,draft,future,private,pending&_embed=1&context=edit`;
    const res = await fetch(url, { headers });
    if (res.status === 400 || res.status === 404) return;
    if (!res.ok) throw new Error(`WordPress ${type} fetch failed: HTTP ${res.status}`);
    const totalHeader = res.headers.get("x-wp-total");
    const total = totalHeader ? Number(totalHeader) : null;
    const batch = (await res.json()) as WpItem[];
    if (!Array.isArray(batch) || batch.length === 0) return;
    const capped = page === PAGE_CAP && batch.length === perPage;
    yield { batch, total, page, capped };
    if (batch.length < perPage) return;
    page += 1;
  }
}

function mapItem(item: WpItem, organizationId: string, siteId: string) {
  const html = item.content?.rendered ?? "";
  const text = stripHtml(html);
  const wc = wordCount(text);
  const modified = item.modified_gmt ? new Date(item.modified_gmt + "Z").toISOString() : null;
  const fresh = freshnessScore(modified);
  const cats =
    item._embedded?.["wp:term"]
      ?.flat()
      ?.filter((t) => t.taxonomy === "category")
      .map((t) => t.name)
      .filter(Boolean) ?? [];
  const tags =
    item._embedded?.["wp:term"]
      ?.flat()
      ?.filter((t) => t.taxonomy === "post_tag")
      .map((t) => t.name)
      .filter(Boolean) ?? [];
  const featuredMedia = item._embedded?.["wp:featuredmedia"]?.[0];
  const featuredImageUrl =
    featuredMedia?.source_url ??
    featuredMedia?.media_details?.sizes?.large?.source_url ??
    featuredMedia?.media_details?.sizes?.medium?.source_url ??
    null;
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
    reading_time: wc > 0 ? Math.max(1, Math.round(wc / 220)) : null,
    published_at: item.date_gmt ? new Date(item.date_gmt + "Z").toISOString() : null,
    modified_at: modified,
    author: item._embedded?.author?.[0]?.name ?? null,
    categories: cats as unknown as Json,
    tags: tags as unknown as Json,
    featured_image_url: featuredImageUrl,
    freshness_score: fresh,
    recommended_action: recommendedAction({
      status: item.status ?? null,
      wordCount: wc,
      freshness: fresh,
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
    const warnings: string[] = [];
    let jobId: string | null = null;
    try {
      const { data: job, error: jobErr } = await supabase
        .from("background_jobs")
        .insert({
          organization_id: data.organizationId,
          site_id: data.siteId,
          created_by: userId,
          job_type: "wordpress.sync",
          status: "running",
          started_at: new Date().toISOString(),
          payload: { siteId: data.siteId } as Json,
          items_processed: 0,
        })
        .select("id")
        .single();
      if (jobErr) throw jobErr;
      jobId = job?.id ?? null;
    } catch (e) {
      warnings.push(`background_jobs.create: ${(e as Error).message}`);
    }

    await supabase
      .from("sites")
      .update({ status: "sync_running" })
      .eq("id", data.siteId)
      .eq("organization_id", data.organizationId);

    const totalsByType: Record<"posts" | "pages", number | null> = { posts: null, pages: null };
    const computeTotal = (): number | null => {
      const p = totalsByType.posts;
      const g = totalsByType.pages;
      if (p == null && g == null) return null;
      return (p ?? 0) + (g ?? 0);
    };
    const updateProgress = async () => {
      if (!jobId) return;
      try {
        await supabase
          .from("background_jobs")
          .update({ items_processed: synced, total_items: computeTotal() })
          .eq("id", jobId);
      } catch (e) {
        warnings.push(`background_jobs.progress: ${(e as Error).message}`);
      }
    };

    try {
      for (const type of ["posts", "pages"] as const) {
        try {
          for await (const { batch, total, capped } of paginate(conn.url, headers, type)) {
            if (total != null) totalsByType[type] = total;
            const rows = batch.map((it) => mapItem(it, data.organizationId, data.siteId));
            const { error } = await supabase
              .from("wordpress_posts")
              .upsert(rows, { onConflict: "site_id,wp_post_id,post_type" });
            if (error) throw error;
            synced += rows.length;
            await updateProgress();
            if (capped) {
              warnings.push(`Reached pagination cap for ${type}; sync may be incomplete`);
            }
          }
        } catch (e) {
          errors.push(`${type}: ${(e as Error).message}`);
        }
      }
      await supabase
        .from("sites")
        .update({
          total_posts: synced,
          last_synced_at: new Date().toISOString(),
          status: errors.length ? "sync_failed" : "connected",
        })
        .eq("id", data.siteId)
        .eq("organization_id", data.organizationId);
      await supabase
        .from("integration_connections")
        .update({ last_synced_at: new Date().toISOString(), last_error: errors[0] ?? null })
        .eq("organization_id", data.organizationId)
        .eq("site_id", data.siteId)
        .eq("provider", "wordpress");
    } catch (err) {
      const msg = (err as Error).message;
      if (jobId) {
        try {
          await supabase
            .from("background_jobs")
            .update({
              status: "failed",
              finished_at: new Date().toISOString(),
              error: msg,
              error_message: msg,
              items_processed: synced,
              result: { synced, errors, warnings } as Json,
            })
            .eq("id", jobId);
        } catch (e) {
          warnings.push(`background_jobs.finalize: ${(e as Error).message}`);
        }
      }
      await supabase
        .from("sites")
        .update({ status: "sync_failed" })
        .eq("id", data.siteId)
        .eq("organization_id", data.organizationId);
      await audit(supabase, userId, data.organizationId, "wp.sync.error", data.siteId, {
        message: msg,
        synced,
        warnings,
      } as Json);
      throw err;
    }

    if (jobId) {
      try {
        await supabase
          .from("background_jobs")
          .update({
            status: errors.length ? "failed" : "completed",
            finished_at: new Date().toISOString(),
            items_processed: synced,
            total_items: computeTotal(),
            error_message: errors[0] ?? null,
            result: { synced, errors, warnings } as Json,
          })
          .eq("id", jobId);
      } catch (e) {
        warnings.push(`background_jobs.finalize: ${(e as Error).message}`);
      }
    }
    await audit(supabase, userId, data.organizationId, "wp.sync", data.siteId, {
      synced,
      errors,
      warnings,
      job_id: jobId,
    } as Json);
    return { synced, errors, warnings, jobId };
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
    try {
      body = (await res.json()) as WpItem;
    } catch {
      /* ignore */
    }
    await audit(supabase, userId, data.organizationId, "wp.draft.create", data.siteId, {
      ok,
      status: res.status,
      wp_id: body?.id ?? null,
      title: data.title,
    } as Json);
    if (!ok) throw new Error(`Create draft failed: HTTP ${res.status}`);
    return { wpPostId: body?.id ?? null, link: body?.link ?? null };
  });

export const updateWordpressDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgSite
      .extend({
        wpPostId: z.number().int().positive(),
      })
      .merge(draftFields.partial())
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const conn = await getConnection(supabase, data.organizationId, data.siteId);
    if (!conn) {
      await audit(supabase, userId, data.organizationId, "wp.draft.update.denied", data.siteId, {
        reason: "not_connected",
        wp_id: data.wpPostId,
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
      ok,
      status: res.status,
      wp_id: data.wpPostId,
    } as Json);
    if (!ok) throw new Error(`Update draft failed: HTTP ${res.status}`);
    return { wpPostId: data.wpPostId };
  });
