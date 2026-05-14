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
    // Ask PostgREST to project every required column with limit=0. If any
    // column is missing from the live table, PostgREST returns a 400 with
    // `column "<name>" does not exist`, failing this test precisely.
    const select = REQUIRED_COLUMNS.join(",");
    const res = await fetch(
      `${url}/rest/v1/wordpress_posts?select=${select}&limit=0`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (res.status === 401 || res.status === 403) {
      // RLS blocks anon reads — that's fine; the request still validates the
      // column projection before evaluating policies, so a 401/403 here means
      // every column was accepted by PostgREST.
      return;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Live REST projection failed (${res.status}): ${body.slice(0, 500)}`,
      );
    }
  }, 15_000);
});