import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

const orgScoped = z.object({ organizationId: z.string().uuid() });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

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

async function enqueue(
  supabase: SB,
  organizationId: string,
  userId: string,
  jobType: string,
  payload: Json,
  siteId?: string,
) {
  const { data, error } = await supabase
    .from("background_jobs")
    .insert({
      organization_id: organizationId,
      created_by: userId,
      job_type: jobType,
      payload,
      site_id: siteId ?? null,
      status: "queued",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export const verifyWordpressConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgScoped
      .extend({
        siteId: z.string().uuid(),
        url: z.string().url(),
        username: z.string().min(1).max(120),
        appPassword: z.string().min(8).max(200),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const job = await enqueue(
      supabase,
      data.organizationId,
      userId,
      "wp_verify",
      {
        url: data.url,
        username: data.username,
      },
      data.siteId,
    );
    return { jobId: job.id, status: "queued" as const };
  });

export const syncWordpressContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => orgScoped.extend({ siteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const job = await enqueue(supabase, data.organizationId, userId, "wp_sync", {}, data.siteId);
    return { jobId: job.id };
  });

export const runContentAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgScoped
      .extend({
        siteId: z.string().uuid(),
        url: z.string().url(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const { data: audit, error } = await supabase
      .from("content_audits")
      .insert({
        organization_id: data.organizationId,
        site_id: data.siteId,
        owner_id: userId,
        url: data.url,
        status: "queued",
      })
      .select()
      .single();
    if (error) throw error;
    await enqueue(
      supabase,
      data.organizationId,
      userId,
      "content_audit",
      {
        auditId: audit.id,
        url: data.url,
      },
      data.siteId,
    );
    return { auditId: audit.id };
  });

export const generateContentBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgScoped
      .extend({
        siteId: z.string().uuid(),
        title: z.string().min(3).max(200),
        targetKeyword: z.string().min(2).max(120).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const { data: brief, error } = await supabase
      .from("content_briefs")
      .insert({
        organization_id: data.organizationId,
        site_id: data.siteId,
        owner_id: userId,
        title: data.title,
        target_keyword: data.targetKeyword ?? null,
        ai_generated: true,
      })
      .select()
      .single();
    if (error) throw error;
    await enqueue(
      supabase,
      data.organizationId,
      userId,
      "brief_generate",
      {
        briefId: brief.id,
      },
      data.siteId,
    );
    return { briefId: brief.id };
  });

export const requestPublishApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgScoped
      .extend({
        siteId: z.string().uuid(),
        briefId: z.string().uuid().optional(),
        draftPayload: z.record(z.string(), z.any()),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const { data: req, error } = await supabase
      .from("approval_requests")
      .insert({
        organization_id: data.organizationId,
        site_id: data.siteId,
        brief_id: data.briefId ?? null,
        requested_by: userId,
        draft_payload: data.draftPayload as Json,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw error;
    return { approvalId: req.id };
  });

export const importGscData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => orgScoped.extend({ siteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const job = await enqueue(supabase, data.organizationId, userId, "gsc_import", {}, data.siteId);
    return { jobId: job.id };
  });

export const importGa4Data = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => orgScoped.extend({ siteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const job = await enqueue(supabase, data.organizationId, userId, "ga4_import", {}, data.siteId);
    return { jobId: job.id };
  });

export const runAiVisibilityTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgScoped
      .extend({
        siteId: z.string().uuid(),
        query: z.string().min(2).max(500),
        engine: z.enum(["google_aio", "perplexity", "chatgpt", "claude"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const job = await enqueue(
      supabase,
      data.organizationId,
      userId,
      "ai_visibility",
      {
        query: data.query,
        engine: data.engine,
      },
      data.siteId,
    );
    return { jobId: job.id };
  });
