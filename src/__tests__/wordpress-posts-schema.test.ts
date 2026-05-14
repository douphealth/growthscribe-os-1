import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";

// Required columns the WordPress sync engine + content inventory rely on.
const REQUIRED_COLUMNS = [
  "id",
  "organization_id",
  "site_id",
  "wp_post_id",
  "post_type",
  "status",
  "slug",
  "url",
  "title",
  "excerpt",
  "content_html",
  "content_text",
  "word_count",
  "reading_time",
  "published_at",
  "modified_at",
  "author",
  "categories",
  "tags",
  "featured_image_url",
  "freshness_score",
  "recommended_action",
  "seo_score",
  "aeo_score",
  "geo_score",
  "synced_at",
] as const;

type Row = Database["public"]["Tables"]["wordpress_posts"]["Row"];

describe("wordpress_posts generated types", () => {
  it("has every required column on the Row type", () => {
    // Compile-time assertion: every required column key must exist on Row.
    // If a column is missing from the generated types, this object literal
    // fails to typecheck, breaking `bun run typecheck` / `bun run check`.
    const _shape: { [K in (typeof REQUIRED_COLUMNS)[number]]: keyof Row } = {
      id: "id",
      organization_id: "organization_id",
      site_id: "site_id",
      wp_post_id: "wp_post_id",
      post_type: "post_type",
      status: "status",
      slug: "slug",
      url: "url",
      title: "title",
      excerpt: "excerpt",
      content_html: "content_html",
      content_text: "content_text",
      word_count: "word_count",
      reading_time: "reading_time",
      published_at: "published_at",
      modified_at: "modified_at",
      author: "author",
      categories: "categories",
      tags: "tags",
      featured_image_url: "featured_image_url",
      freshness_score: "freshness_score",
      recommended_action: "recommended_action",
      seo_score: "seo_score",
      aeo_score: "aeo_score",
      geo_score: "geo_score",
      synced_at: "synced_at",
    };
    expect(Object.keys(_shape).sort()).toEqual([...REQUIRED_COLUMNS].sort());
  });

  it("matches the live REST payload shape (when SUPABASE creds are set)", async () => {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      // Skip silently in environments without Supabase credentials (local dev,
      // forks). CI sets these from secrets.
      return;
    }
    // Ask PostgREST for the column list of wordpress_posts via OpenAPI.
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    expect(res.ok).toBe(true);
    const spec = (await res.json()) as {
      definitions?: Record<string, { properties?: Record<string, unknown> }>;
    };
    const def = spec.definitions?.wordpress_posts;
    expect(def, "wordpress_posts not exposed by REST").toBeDefined();
    const liveColumns = Object.keys(def?.properties ?? {});
    const missing = REQUIRED_COLUMNS.filter((c) => !liveColumns.includes(c));
    expect(
      missing,
      `Missing live REST columns: ${missing.join(", ")}`,
    ).toEqual([]);
  }, 15_000);
});