// Server-only WordPress helpers shared between technical scanner and content sync.
// Do NOT import from client code.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SB = SupabaseClient<Database>;

export type WpConnection = { url: string; username: string; appPassword: string };

type EncryptedSecret = {
  v: 1;
  alg: "AES-GCM";
  iv: string;
  ciphertext: string;
};

function getEncryptionMaterial() {
  const m = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.LOVABLE_API_KEY;
  if (!m) throw new Error("Server credential encryption key is not configured");
  return m;
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
  const m = value as Partial<EncryptedSecret>;
  return (
    m.v === 1 && m.alg === "AES-GCM" && typeof m.iv === "string" && typeof m.ciphertext === "string"
  );
}

async function decryptSecret(secret: EncryptedSecret): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(secret.iv) },
    await encryptionKey(),
    fromB64(secret.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export function wpAuthHeader(c: WpConnection): string {
  return "Basic " + Buffer.from(`${c.username}:${c.appPassword}`).toString("base64");
}

export async function getWpConnection(
  supabase: SB,
  organizationId: string,
  siteId: string,
): Promise<WpConnection | null> {
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
  const url = typeof cfg.url === "string" ? cfg.url.replace(/\/+$/, "") : null;
  const username = typeof cfg.username === "string" ? cfg.username : null;
  const appPassword = isEncryptedSecret(cfg.encrypted_app_password)
    ? await decryptSecret(cfg.encrypted_app_password)
    : null;
  if (!url || !username || !appPassword) return null;
  return { url, username, appPassword };
}

export type WpPostResource = {
  id: number;
  link: string;
  title: { rendered: string; raw?: string };
  excerpt: { rendered: string; raw?: string };
  content: { rendered: string; raw?: string };
  meta?: Record<string, unknown>;
};

export async function fetchWpPost(
  conn: WpConnection,
  postType: string,
  id: number,
): Promise<WpPostResource> {
  const res = await fetch(
    `${conn.url}/wp-json/wp/v2/${postType === "page" ? "pages" : "posts"}/${id}?context=edit`,
    { headers: { Authorization: wpAuthHeader(conn) } },
  );
  if (!res.ok) throw new Error(`WordPress fetch failed: HTTP ${res.status}`);
  return (await res.json()) as WpPostResource;
}

export type WpPostChange = {
  title?: string;
  excerpt?: string;
  content?: string;
  meta?: Record<string, string>;
};

export async function updateWpPost(
  conn: WpConnection,
  postType: string,
  id: number,
  changes: WpPostChange,
): Promise<WpPostResource> {
  const body: Record<string, unknown> = {};
  if (changes.title !== undefined) body.title = changes.title;
  if (changes.excerpt !== undefined) body.excerpt = changes.excerpt;
  if (changes.content !== undefined) body.content = changes.content;
  if (changes.meta) body.meta = changes.meta;
  const res = await fetch(
    `${conn.url}/wp-json/wp/v2/${postType === "page" ? "pages" : "posts"}/${id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: wpAuthHeader(conn),
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`WordPress update failed: HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as WpPostResource;
}