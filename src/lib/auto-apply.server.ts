// Server-only auto-apply pipeline. Pulls open recommendations + post snapshot,
// asks the LLM for a structured patch (title, meta, alt text, internal links),
// generates JSON-LD, snapshots `before` to wp_revisions, PUSHes to WordPress,
// records changeset, and closes the addressed recommendations. Single entry
// point: `runAuditApply(admin, job)`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  getWpConnection,
  fetchWpPost,
  updateWpPost,
  type WpConnection,
} from "./wordpress.server";
import { callLovableAIStructured } from "./ai-gateway";
import {
  ensureGeoAeoAssets,
  renderInlineSchemaBlock,
  stripExistingSchemaBlock,
  sha1,
} from "./geo-aeo.server";

type Admin = SupabaseClient<Database>;
type JobLike = {
  id: string;
  organization_id: string;
  site_id: string | null;
  payload: unknown;
  created_by: string;
};

type Patch = {
  title?: string;
  meta_description?: string;
  internal_links: Array<{ anchor: string; href: string; insert_after_paragraph?: number }>;
  image_alt_fixes: Array<{ image_src: string; alt: string }>;
  body_html_patch?: string;
  rationale: string;
  optimization_score: number;
};

const PATCH_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 70 },
    meta_description: { type: "string", maxLength: 165 },
    internal_links: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          anchor: { type: "string" },
          href: { type: "string" },
          insert_after_paragraph: { type: "integer" },
        },
        required: ["anchor", "href"],
      },
    },
    image_alt_fixes: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          image_src: { type: "string" },
          alt: { type: "string" },
        },
        required: ["image_src", "alt"],
      },
    },
    body_html_patch: { type: "string" },
    rationale: { type: "string" },
    optimization_score: { type: "integer", minimum: 0, maximum: 100 },
  },
  required: ["internal_links", "image_alt_fixes", "rationale", "optimization_score"],
};

function applyAltFixes(html: string, fixes: Patch["image_alt_fixes"]): string {
  let out = html;
  for (const f of fixes) {
    if (!f.image_src || !f.alt) continue;
    const esc = f.image_src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Add alt attribute if missing on this src.
    const re = new RegExp(`(<img\\b[^>]*\\bsrc=["']${esc}["'][^>]*)(/?>)`, "gi");
    out = out.replace(re, (full, head, tail) => {
      if (/\balt\s*=/.test(head)) return full;
      return `${head} alt="${f.alt.replace(/"/g, "&quot;")}"${tail}`;
    });
  }
  return out;
}

function appendInternalLinks(html: string, links: Patch["internal_links"]): string {
  if (links.length === 0) return html;
  const list = links
    .filter((l) => l.anchor && l.href)
    .map(
      (l) =>
        `<li><a href="${l.href.replace(/"/g, "&quot;")}">${l.anchor.replace(/</g, "&lt;")}</a></li>`,
    )
    .join("");
  if (!list) return html;
  const block = `<!-- gs-internal-links:start --><div class="gs-internal-links"><strong>Related reading:</strong><ul>${list}</ul></div><!-- gs-internal-links:end -->`;
  const cleaned = html.replace(
    /<!-- gs-internal-links:start -->[\s\S]*?<!-- gs-internal-links:end -->/g,
    "",
  );
  return cleaned + "\n" + block;
}

async function buildPatch(post: {
  title: string | null;
  url: string | null;
  content_text: string | null;
  excerpt: string | null;
  recommendations: Array<{ category: string; title: string; detail: string | null; suggested_action: string | null }>;
  siteUrl: string | null;
  internalLinkCandidates: Array<{ title: string | null; url: string }>;
}): Promise<Patch> {
  const sys =
    "You are a senior SEO/AEO/GEO editor. Produce a minimal, safe patch for the page below that maximizes search and answer-engine visibility. Title <= 60 chars, meta_description <= 160. Internal_links must point only to provided candidate URLs. Image_alt_fixes only for images present in the page. Body_html_patch is OPTIONAL — leave empty unless a small inline addition (FAQ block, summary, schema headings) clearly helps. Be conservative.";
  const user = `URL: ${post.url ?? ""}
Current title: ${post.title ?? ""}
Current excerpt: ${post.excerpt ?? ""}
Site: ${post.siteUrl ?? ""}

Open recommendations (${post.recommendations.length}):
${post.recommendations
  .slice(0, 30)
  .map((r) => `- [${r.category}] ${r.title}${r.detail ? ` :: ${r.detail.slice(0, 240)}` : ""}${r.suggested_action ? ` >> ${r.suggested_action.slice(0, 160)}` : ""}`)
  .join("\n")}

Internal link candidates (only use these href values):
${post.internalLinkCandidates
  .slice(0, 40)
  .map((c) => `- ${c.title ?? "(untitled)"} :: ${c.url}`)
  .join("\n")}

Page text (truncated):
${(post.content_text ?? "").slice(0, 8000)}`;

  return await callLovableAIStructured<Patch>(
    sys,
    user,
    "auto_apply_patch",
    PATCH_SCHEMA,
    "google/gemini-3-flash-preview",
  );
}

export async function runAuditApply(admin: Admin, job: JobLike) {
  if (!job.site_id) throw new Error("audit_apply requires site_id");
  const payload = (job.payload ?? {}) as { post_id?: string };
  if (!payload.post_id) throw new Error("audit_apply requires payload.post_id");

  // 0. Check auto-apply mode
  const { data: aas } = await admin
    .from("auto_apply_settings")
    .select("mode, paused")
    .eq("organization_id", job.organization_id)
    .maybeSingle();
  const mode = aas?.mode ?? "full";
  if (aas?.paused || mode === "paused") return { skipped: "paused" };

  // 1. Load post + connection + recs
  const [{ data: post }, conn, { data: site }] = await Promise.all([
    admin
      .from("wordpress_posts")
      .select(
        "id, organization_id, site_id, wp_post_id, post_type, url, title, excerpt, content_html, content_text, published_at, modified_at, author, featured_image_url, content_hash",
      )
      .eq("id", payload.post_id)
      .eq("organization_id", job.organization_id)
      .maybeSingle(),
    getWpConnection(admin, job.organization_id, job.site_id),
    admin.from("sites").select("url, detected_seo_plugin").eq("id", job.site_id).maybeSingle(),
  ]);
  if (!post) throw new Error("Post not found");
  if (!conn) throw new Error("WordPress connection not available");

  const { data: recs } = await admin
    .from("content_recommendations")
    .select("id, category, title, detail, suggested_action")
    .eq("organization_id", job.organization_id)
    .eq("site_id", job.site_id)
    .eq("post_id", post.id)
    .eq("status", "open")
    .limit(40);

  // 2. Internal link candidates: top recently modified sibling posts
  const { data: siblings } = await admin
    .from("wordpress_posts")
    .select("title, url")
    .eq("organization_id", job.organization_id)
    .eq("site_id", job.site_id)
    .eq("status", "publish")
    .neq("id", post.id)
    .order("modified_at", { ascending: false, nullsFirst: false })
    .limit(40);

  // 3. Compute patch
  const patch = await buildPatch({
    title: post.title,
    url: post.url,
    content_text: post.content_text,
    excerpt: post.excerpt,
    recommendations: (recs ?? []).map((r) => ({
      category: r.category,
      title: r.title,
      detail: r.detail,
      suggested_action: r.suggested_action,
    })),
    siteUrl: site?.url ?? null,
    internalLinkCandidates: (siblings ?? []).filter((s): s is { title: string | null; url: string } => !!s.url),
  });

  // 4. Build JSON-LD
  const { schemas } = await ensureGeoAeoAssets(admin, {
    id: post.id,
    site_id: post.site_id,
    organization_id: post.organization_id,
    url: post.url,
    title: patch.title ?? post.title,
    excerpt: patch.meta_description ?? post.excerpt,
    content_html: post.content_html,
    content_text: post.content_text,
    published_at: post.published_at,
    modified_at: post.modified_at,
    author: post.author,
    featured_image_url: post.featured_image_url,
    content_hash: post.content_hash,
  });

  // 5. Stitch new content_html
  const baseHtml = stripExistingSchemaBlock(post.content_html ?? "");
  let nextHtml = applyAltFixes(baseHtml, patch.image_alt_fixes);
  nextHtml = appendInternalLinks(nextHtml, patch.internal_links);
  if (patch.body_html_patch && patch.body_html_patch.trim().length > 0) {
    nextHtml += `\n<!-- gs-body-patch:start -->${patch.body_html_patch}<!-- gs-body-patch:end -->`;
  }
  // Schema block goes at the very end so subsequent runs replace cleanly.
  nextHtml += "\n" + renderInlineSchemaBlock(schemas);

  // 6. Snapshot before
  const wpBefore = await fetchWpPost(conn as WpConnection, post.post_type ?? "post", post.wp_post_id);
  const { data: revision } = await admin
    .from("wp_revisions")
    .insert({
      organization_id: job.organization_id,
      site_id: job.site_id,
      post_id: post.id,
      wp_post_id: post.wp_post_id,
      post_type: post.post_type ?? "post",
      applied_by: job.created_by,
      job_id: job.id,
      before: {
        title: wpBefore.title?.raw ?? wpBefore.title?.rendered ?? null,
        excerpt: wpBefore.excerpt?.raw ?? wpBefore.excerpt?.rendered ?? null,
        content: wpBefore.content?.raw ?? wpBefore.content?.rendered ?? null,
      } as Json,
      after: {
        title: patch.title ?? null,
        excerpt: patch.meta_description ?? null,
        content: nextHtml,
      } as Json,
    })
    .select("id")
    .single();

  // 7. Push to WordPress (mode-dependent)
  // - full: publish in place
  // - draft_only: send the same payload but as a draft revision (status=draft)
  // We currently push live; "draft_only" should NOT touch live content, so we
  // skip the WP write and only record the diff for human review.
  if (mode === "full") {
    await updateWpPost(conn as WpConnection, post.post_type ?? "post", post.wp_post_id, {
      title: patch.title,
      excerpt: patch.meta_description,
      content: nextHtml,
    });
  }

  // 8. Record changeset + close recommendations + update post tracking
  const beforeHash = await sha1(wpBefore.content?.raw ?? wpBefore.content?.rendered ?? "");
  const afterHash = await sha1(nextHtml);
  const changesetIns = await admin
    .from("content_changesets")
    .insert({
      organization_id: job.organization_id,
      site_id: job.site_id,
      post_id: post.id,
      wp_post_id: post.wp_post_id,
      source: "audit_apply",
      applied_by: job.created_by,
      before_hash: beforeHash,
      after_hash: afterHash,
      before_snapshot: {
        title: wpBefore.title?.raw ?? null,
        excerpt: wpBefore.excerpt?.raw ?? null,
      } as Json,
      after_snapshot: {
        title: patch.title ?? null,
        excerpt: patch.meta_description ?? null,
        internal_links: patch.internal_links as unknown as Json,
        image_alt_fixes: patch.image_alt_fixes as unknown as Json,
        mode,
      } as Json,
      asset_blocks_added: [
        "article-jsonld",
        ...(schemas.faq ? ["faq-jsonld"] : []),
        ...(schemas.howto ? ["howto-jsonld"] : []),
        "breadcrumb-jsonld",
      ] as unknown as Json,
    })
    .select("id")
    .single();

  if ((recs?.length ?? 0) > 0) {
    await admin
      .from("content_recommendations")
      .update({ status: "fixed" })
      .in("id", (recs ?? []).map((r) => r.id));
  }

  await admin
    .from("wordpress_posts")
    .update({
      last_optimized_at: new Date().toISOString(),
      optimization_score: patch.optimization_score,
      content_hash: afterHash,
      ...(mode === "full" ? { title: patch.title ?? post.title, excerpt: patch.meta_description ?? post.excerpt, content_html: nextHtml } : {}),
    })
    .eq("id", post.id);

  // 9. Tie geo_aeo_assets to this changeset
  await admin
    .from("geo_aeo_assets")
    .update({ applied_at: new Date().toISOString(), applied_changeset_id: changesetIns.data?.id })
    .eq("post_id", post.id);

  await admin.from("activities").insert({
    organization_id: job.organization_id,
    owner_id: job.created_by,
    type: "audit_apply",
    title: `Optimized: ${patch.title ?? post.title ?? post.url ?? "post"}`,
    description: `${patch.rationale.slice(0, 200)} (score ${patch.optimization_score})`,
    link: "/optimization",
    metadata: { post_id: post.id, revision_id: revision?.id, changeset_id: changesetIns.data?.id, mode } as Json,
  });

  return {
    post_id: post.id,
    score: patch.optimization_score,
    revision_id: revision?.id,
    changeset_id: changesetIns.data?.id,
    mode,
  };
}

/** Restore a previous WordPress revision. */
export async function rollbackWpRevision(admin: Admin, revisionId: string, userId: string) {
  const { data: rev, error } = await admin
    .from("wp_revisions")
    .select("id, organization_id, site_id, wp_post_id, post_id, post_type, before, rolled_back_at")
    .eq("id", revisionId)
    .maybeSingle();
  if (error) throw error;
  if (!rev) throw new Error("Revision not found");
  if (rev.rolled_back_at) throw new Error("Already rolled back");

  const conn = await getWpConnection(admin, rev.organization_id, rev.site_id);
  if (!conn) throw new Error("WordPress connection not available");
  const before = (rev.before ?? {}) as { title?: string; excerpt?: string; content?: string };
  await updateWpPost(conn, rev.post_type, rev.wp_post_id, {
    title: before.title,
    excerpt: before.excerpt,
    content: before.content,
  });
  await admin
    .from("wp_revisions")
    .update({ rolled_back_at: new Date().toISOString(), rolled_back_by: userId })
    .eq("id", revisionId);
  if (rev.post_id) {
    await admin
      .from("wordpress_posts")
      .update({
        title: before.title ?? null,
        excerpt: before.excerpt ?? null,
        content_html: before.content ?? null,
      })
      .eq("id", rev.post_id);
  }
  return { ok: true };
}