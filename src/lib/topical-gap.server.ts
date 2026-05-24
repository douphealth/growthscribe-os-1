// Server-only topical cluster gap filler. Looks at clusters with low coverage,
// asks an LLM for high-impact missing-page suggestions, and writes them as
// `cluster_gap_briefs` rows + corresponding `tasks` for the org owner.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { callLovableAIStructured } from "./ai-gateway";

type Admin = SupabaseClient<Database>;
type JobLike = {
  id: string;
  organization_id: string;
  site_id: string | null;
  created_by: string;
};

type GapSuggestion = {
  suggestions: Array<{
    title: string;
    target_keyword: string;
    intent: "informational" | "commercial" | "transactional" | "navigational";
    rationale: string;
  }>;
};

export async function runTopicalGapFill(admin: Admin, job: JobLike) {
  if (!job.site_id) throw new Error("topical.gap_fill requires site_id");

  const { data: clusters } = await admin
    .from("topical_clusters")
    .select("id, name, pillar_topic, description, coverage_percent")
    .eq("organization_id", job.organization_id)
    .eq("site_id", job.site_id)
    .order("coverage_percent", { ascending: true, nullsFirst: true })
    .limit(10);
  if (!clusters || clusters.length === 0) return { proposed: 0 };

  const gaps = clusters.filter((c) => (c.coverage_percent ?? 0) < 80);
  if (gaps.length === 0) return { proposed: 0 };

  let totalProposed = 0;
  for (const cluster of gaps.slice(0, 3)) {
    const { data: pages } = await admin
      .from("topical_cluster_pages")
      .select("title, target_keyword, page_role, coverage_status")
      .eq("cluster_id", cluster.id)
      .limit(50);
    const covered = (pages ?? [])
      .filter((p) => p.coverage_status === "covered")
      .map((p) => `${p.title ?? p.target_keyword ?? ""} [${p.page_role ?? "?"}]`)
      .join("\n");
    const missing = (pages ?? [])
      .filter((p) => p.coverage_status !== "covered")
      .map((p) => `${p.title ?? p.target_keyword ?? ""} [${p.page_role ?? "?"}]`)
      .join("\n");

    const result = await callLovableAIStructured<GapSuggestion>(
      "You are a topical authority strategist. Given a content cluster, propose 3-5 missing pages that would most increase topical authority and capture striking-distance traffic. Be specific, non-duplicative, and align with the cluster's pillar topic.",
      `Cluster: ${cluster.name}
Pillar topic: ${cluster.pillar_topic ?? "(none)"}
Description: ${cluster.description ?? "(none)"}
Coverage: ${cluster.coverage_percent ?? 0}%

Covered pages:
${covered || "(none)"}

Known gaps:
${missing || "(none)"}`,
      "topical_gaps",
      {
        type: "object",
        properties: {
          suggestions: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                target_keyword: { type: "string" },
                intent: { type: "string", enum: ["informational", "commercial", "transactional", "navigational"] },
                rationale: { type: "string" },
              },
              required: ["title", "target_keyword", "intent", "rationale"],
            },
          },
        },
        required: ["suggestions"],
      },
      "google/gemini-2.5-flash-lite",
    );

    const inserts = result.suggestions.map((s) => ({
      organization_id: job.organization_id,
      site_id: job.site_id!,
      cluster_id: cluster.id,
      suggested_title: s.title,
      target_keyword: s.target_keyword,
      intent: s.intent,
      rationale: s.rationale,
      status: "suggested",
    }));
    const { data: inserted } = await admin
      .from("cluster_gap_briefs")
      .insert(inserts)
      .select("id, suggested_title, target_keyword");

    if (inserted && inserted.length > 0) {
      await admin.from("tasks").insert(
        inserted.map((row) => ({
          organization_id: job.organization_id,
          owner_id: job.created_by,
          site_id: job.site_id!,
          title: `Write: ${row.suggested_title}`,
          description: `Cluster gap — target keyword: ${row.target_keyword}`,
          priority: "medium" as const,
          status: "todo" as const,
        })),
      );
    }

    totalProposed += inserts.length;
  }

  await admin.from("activities").insert({
    organization_id: job.organization_id,
    owner_id: job.created_by,
    type: "topical.gap_fill",
    title: `${totalProposed} cluster gap suggestions`,
    description: `Across ${gaps.length} clusters with <80% coverage`,
    link: "/topical-maps",
    metadata: {} as Json,
  });
  return { proposed: totalProposed, clusters: gaps.length };
}