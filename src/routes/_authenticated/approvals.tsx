import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Check, X, Inbox } from "lucide-react";
import {
  listApprovalRequests,
  approveApprovalRequest,
  rejectApprovalRequest,
} from "@/lib/approvals.functions";

export const Route = createFileRoute("/_authenticated/approvals")({
  component: Page,
});

type Draft = {
  field?: string;
  category?: string;
  before?: string;
  after?: string;
  wpPostId?: number;
};

function diffLines(before: string, after: string) {
  const b = (before ?? "").split(/\r?\n/);
  const a = (after ?? "").split(/\r?\n/);
  return { before: b, after: a };
}

function Page() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const qc = useQueryClient();
  const list = useServerFn(listApprovalRequests);
  const approve = useServerFn(approveApprovalRequest);
  const reject = useServerFn(rejectApprovalRequest);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["approvals", orgId, tab],
    enabled: !!orgId,
    queryFn: () => list({ data: { organizationId: orgId!, status: tab } }),
  });

  const counts = useMemo(() => ({ items: q.data ?? [] }), [q.data]);

  async function onApprove(id: string) {
    try {
      await approve({ data: { organizationId: orgId!, approvalId: id, note: notes[id] } });
      toast.success("Change applied to WordPress");
      qc.invalidateQueries({ queryKey: ["approvals", orgId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Apply failed");
    }
  }
  async function onReject(id: string) {
    try {
      await reject({ data: { organizationId: orgId!, approvalId: id, note: notes[id] } });
      toast.success("Rejected");
      qc.invalidateQueries({ queryKey: ["approvals", orgId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reject failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Review proposed WordPress changes with full diff before they go live."
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="space-y-4 mt-4">
          {q.isLoading ? (
            <Card><CardContent className="p-8 text-sm text-muted-foreground">Loading…</CardContent></Card>
          ) : counts.items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={`No ${tab} requests`}
              description="When SOTA fixes are queued for human review, they'll show up here."
            />
          ) : (
            counts.items.map((row) => {
              const draft = (row.draft_payload ?? {}) as Draft;
              const d = diffLines(String(draft.before ?? ""), String(draft.after ?? ""));
              return (
                <Card key={row.id}>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <CardTitle className="text-sm font-medium">
                        {draft.category ?? "change"} · {draft.field ?? "field"} · WP #{draft.wpPostId ?? "?"}
                      </CardTitle>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date(row.created_at).toLocaleString()}
                      </span>
                    </div>
                    <Badge variant={row.status === "pending" ? "secondary" : row.status === "approved" ? "default" : "destructive"}>
                      {row.status}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Before</p>
                        <pre className="rounded-md border bg-muted/30 p-2 text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto">
{d.before.join("\n") || "(empty)"}
                        </pre>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">After</p>
                        <pre className="rounded-md border bg-primary/5 p-2 text-xs whitespace-pre-wrap break-words max-h-64 overflow-auto">
{d.after.join("\n") || "(empty)"}
                        </pre>
                      </div>
                    </div>
                    {row.status === "pending" && (
                      <div className="space-y-2">
                        <Textarea
                          placeholder="Optional reviewer note…"
                          value={notes[row.id] ?? ""}
                          onChange={(e) => setNotes((s) => ({ ...s, [row.id]: e.target.value }))}
                          className="text-xs"
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => onApprove(row.id)}>
                            <Check className="h-3.5 w-3.5 mr-1" /> Approve & apply
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => onReject(row.id)}>
                            <X className="h-3.5 w-3.5 mr-1" /> Reject
                          </Button>
                        </div>
                      </div>
                    )}
                    {row.decision_note && (
                      <p className="text-xs text-muted-foreground">Note: {row.decision_note}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}