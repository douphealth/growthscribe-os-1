import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type SB = SupabaseClient<Database>;

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

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function callLovableAIStructured<T>(
  systemPrompt: string,
  userPrompt: string,
  toolName: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [{ type: "function", function: { name: toolName, description: "Return structured result", parameters } }],
      tool_choice: { type: "function", function: { name: toolName } },
    }),
  });
  if (res.status === 429) throw new Error("AI rate limit exceeded. Try again shortly.");
  if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const args = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("AI did not return structured output");
  return JSON.parse(args) as T;
}

const auditInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  url: z.string().url().max(1000),
});

type AuditResult = {
  title: string;
  quality_score: number;
  eeat_score: number;
  aeo_score: number;
  ai_summary: string;
  recommendations: { area: string; priority: "high" | "medium" | "low"; recommendation: string }[];
};

export const runContentAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => auditInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: audit, error: insErr } = await supabase
      .from("content_audits")
      .insert({
        organization_id: data.organizationId,
        site_id: data.siteId,
        owner_id: userId,
        url: data.url,
        status: "running",
      })
      .select("id")
      .single();
    if (insErr) throw insErr;
    const auditId = audit.id;

    try {
      const res = await fetch(data.url, {
        headers: { "User-Agent": "GrowthScribeBot/1.0" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`Failed to fetch URL: HTTP ${res.status}`);
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const pageTitle = titleMatch?.[1]?.trim() ?? data.url;
      const text = stripHtml(html).slice(0, 18000);

      const result = await callLovableAIStructured<AuditResult>(
        "You are a senior SEO auditor scoring content for quality, E-E-A-T (experience, expertise, authoritativeness, trust), and AEO (answer-engine optimization) readiness. Be rigorous and specific.",
        `URL: ${data.url}\nPage title: ${pageTitle}\n\nPage text (truncated):\n${text}`,
        "report_audit",
        {
          type: "object",
          properties: {
            title: { type: "string", description: "Best page title" },
            quality_score: { type: "integer", minimum: 0, maximum: 100 },
            eeat_score: { type: "integer", minimum: 0, maximum: 100 },
            aeo_score: { type: "integer", minimum: 0, maximum: 100 },
            ai_summary: { type: "string", description: "2-3 sentence diagnostic summary" },
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

      await supabase
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
        .eq("id", auditId);

      await supabase.from("activities").insert({
        organization_id: data.organizationId,
        owner_id: userId,
        type: "audit.completed",
        title: `Audit completed: ${result.title}`,
        description: `Quality ${result.quality_score} · E-E-A-T ${result.eeat_score} · AEO ${result.aeo_score}`,
        link: `/audits`,
      });

      return { auditId, ...result };
    } catch (err) {
      const msg = (err as Error).message;
      await supabase
        .from("content_audits")
        .update({ status: "failed", ai_summary: msg })
        .eq("id", auditId);
      throw err;
    }
  });
