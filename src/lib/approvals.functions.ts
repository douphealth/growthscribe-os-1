import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWpConnection, fetchWpPost, updateWpPost, type WpPostChange } from "./wordpress.server";

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

export type DraftPayload = {
  postType: string;
  wpPostId: number;
  field: "title" | "excerpt" | "content";
  before: string;
  after: string;
  category: string;
  recommendationId?: string;
};

const orgInput = z.object({ organizationId: z.string().uuid() });

export const listApprovalRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    orgInput
      .extend({
        status: z.enum(["pending", "approved", "rejected", "all"]).default("pending"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    let q = supabase
      .from("approval_requests")
      .select(
        "id, status, draft_payload, decision_note, created_at, decided_at, requested_by, reviewer_id, site_id, brief_id",
      )
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

const createInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  draftPayload: z.record(z.unknown()),
  briefId: z.string().uuid().optional(),
});

export const createApprovalRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => createInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const { data: row, error } = await supabase
      .from("approval_requests")
      .insert({
        organization_id: data.organizationId,
        site_id: data.siteId,
        requested_by: userId,
        brief_id: data.briefId ?? null,
        draft_payload: data.draftPayload as Json,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id };
  });

const decisionInput = z.object({
  organizationId: z.string().uuid(),
  approvalId: z.string().uuid(),
  note: z.string().max(500).optional(),
});

export const rejectApprovalRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => decisionInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const { error } = await supabase
      .from("approval_requests")
      .update({
        status: "rejected",
        reviewer_id: userId,
        decided_at: new Date().toISOString(),
        decision_note: data.note ?? null,
      })
      .eq("id", data.approvalId)
      .eq("organization_id", data.organizationId);
    if (error) throw error;
    await supabase.from("audit_logs").insert({
      actor_id: userId,
      organization_id: data.organizationId,
      action: "approval.reject",
      resource_type: "approval_request",
      resource_id: data.approvalId,
      metadata: { note: data.note ?? null } as Json,
    });
    return { ok: true };
  });

export const approveApprovalRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => decisionInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    const { data: ar, error: arErr } = await supabase
      .from("approval_requests")
      .select("id, site_id, draft_payload, status, organization_id")
      .eq("id", data.approvalId)
      .eq("organization_id", data.organizationId)
      .single();
    if (arErr || !ar) throw new Error("Approval request not found");
    if (ar.status !== "pending") throw new Error(`Already ${ar.status}`);

    const draft = ar.draft_payload as unknown as Partial<DraftPayload>;
    if (!draft || !draft.field || draft.wpPostId == null || draft.after == null) {
      throw new Error("Draft payload missing required fields");
    }

    const conn = await getWpConnection(supabase, ar.organization_id, ar.site_id);
    if (!conn) throw new Error("WordPress is not connected for this site");
    const live = await fetchWpPost(conn, draft.postType ?? "post", draft.wpPostId);

    const changes: WpPostChange = {};
    if (draft.field === "title") changes.title = String(draft.after);
    if (draft.field === "excerpt") changes.excerpt = String(draft.after);
    if (draft.field === "content") changes.content = String(draft.after);
    await updateWpPost(conn, draft.postType ?? "post", draft.wpPostId, changes);

    await supabase
      .from("approval_requests")
      .update({
        status: "approved",
        reviewer_id: userId,
        decided_at: new Date().toISOString(),
        decision_note: data.note ?? null,
      })
      .eq("id", data.approvalId);

    if (draft.recommendationId) {
      await supabase
        .from("content_recommendations")
        .update({ status: "done" })
        .eq("id", draft.recommendationId);
    }

    await supabase.from("audit_logs").insert({
      actor_id: userId,
      organization_id: data.organizationId,
      action: "approval.approve",
      resource_type: "approval_request",
      resource_id: data.approvalId,
      metadata: {
        wpPostId: draft.wpPostId,
        field: draft.field,
        category: draft.category ?? null,
      } as Json,
    });
    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "approval.approved",
      title: `Approved ${draft.field} change`,
      description: `WP post ${draft.wpPostId} updated`,
      link: "/approvals",
    });

    return { ok: true, link: live.link };
  });
