import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOrg } from "@/lib/org-context";
import { supabase } from "@/integrations/supabase/client";
import {
  enqueueFullOptimization,
  getOptimizationStatus,
  toggleAutoApply,
} from "@/lib/optimization.functions";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/optimization")({
  component: OptimizationPage,
  head: () => ({
    meta: [
      { title: "Optimization — GrowthScribe" },
      { name: "description", content: "Auto-apply SEO, AEO, and GEO fixes across all your published posts with one click." },
    ],
  }),
});

function OptimizationPage() {
  const { currentOrg } = useOrg();
  const [siteId, setSiteId] = useState<string>("");
  const qc = useQueryClient();

  const sites = useQuery({
    queryKey: ["sites-for-opt", currentOrg?.id],
    enabled: !!currentOrg?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites")
        .select("id, name, url")
        .eq("organization_id", currentOrg!.id);
      if (error) throw error;
      if (data && data.length > 0 && !siteId) setSiteId(data[0].id);
      return data ?? [];
    },
  });

  const getStatus = useServerFn(getOptimizationStatus);
  const status = useQuery({
    queryKey: ["opt-status", currentOrg?.id, siteId],
    enabled: !!currentOrg?.id && !!siteId,
    refetchInterval: 5000,
    queryFn: () => getStatus({ data: { organizationId: currentOrg!.id, siteId } }),
  });

  const aas = useQuery({
    queryKey: ["aas", currentOrg?.id],
    enabled: !!currentOrg?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("auto_apply_settings")
        .select("mode, paused")
        .eq("organization_id", currentOrg!.id)
        .maybeSingle();
      return data ?? { mode: "full", paused: false };
    },
  });

  const enqueue = useServerFn(enqueueFullOptimization);
  const enqueueMut = useMutation({
    mutationFn: () => enqueue({ data: { organizationId: currentOrg!.id, siteId } }),
    onSuccess: (res) => {
      toast.success(`Queued ${res.enqueued} posts for optimization`);
      qc.invalidateQueries({ queryKey: ["opt-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setMode = useServerFn(toggleAutoApply);
  const modeMut = useMutation({
    mutationFn: (mode: "full" | "draft_only" | "paused") =>
      setMode({ data: { organizationId: currentOrg!.id, mode } }),
    onSuccess: () => {
      toast.success("Auto-apply mode updated");
      qc.invalidateQueries({ queryKey: ["aas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = (status.data ?? {}) as Record<string, number | string | null>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Optimization"
        description="Auto-apply SEO, GEO, and AEO fixes across all your posts with one click. Every change is rollback-safe."
      />
      <Card>
        <CardHeader>
          <CardTitle>Run full optimization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Choose a site" /></SelectTrigger>
              <SelectContent>
                {(sites.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => enqueueMut.mutate()} disabled={!siteId || enqueueMut.isPending}>
              {enqueueMut.isPending ? "Queueing…" : "Optimize all published posts"}
            </Button>
            <Select
              value={aas.data?.mode ?? "full"}
              onValueChange={(v) => modeMut.mutate(v as "full" | "draft_only" | "paused")}
            >
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full auto-publish</SelectItem>
                <SelectItem value="draft_only">Draft-only (no publish)</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total posts" value={s.total_posts} />
        <StatCard label="Optimized (14d)" value={s.optimized_recent} />
        <StatCard label="Never optimized" value={s.never_optimized} />
        <StatCard label="In progress" value={Number(s.queued_apply ?? 0) + Number(s.running_apply ?? 0)} />
        <StatCard label="Changes (7d)" value={s.changesets_7d} />
        <StatCard label="Avg SERP pos (28d)" value={s.avg_position_28d ?? "—"} />
        <StatCard label="AI citation share (4w)" value={s.citation_share_4w != null ? `${s.citation_share_4w}%` : "—"} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string | null }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value ?? "—"}</p>
      </CardContent>
    </Card>
  );
}