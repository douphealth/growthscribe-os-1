import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useOrg } from "@/lib/org-context";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Rocket, Undo2, FastForward, ShieldCheck } from "lucide-react";
import {
  createRollout,
  listRollouts,
  advanceRolloutStage,
  rollbackRollout,
  listOpenRecommendations,
} from "@/lib/rollouts.functions";

export const Route = createFileRoute("/_authenticated/rollouts")({
  component: RolloutsPage,
  head: () => ({
    meta: [
      { title: "Bulk Rollouts — GrowthScribe" },
      {
        name: "description",
        content:
          "Staged 10→50→100% safe-apply orchestrator with regression detection, dry-run, and one-click rollback.",
      },
    ],
  }),
});

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  dry_run: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  rolling_out: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
  rolled_back: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
};

function RolloutsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? "";
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState<string>("");

  const sitesQ = useQuery({
    enabled: !!orgId,
    queryKey: ["sites", orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from("sites")
        .select("id, name, url")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const sites = sitesQ.data ?? [];
  const effectiveSite = siteId || sites[0]?.id || "";

  const listFn = useServerFn(listRollouts);
  const rolloutsQ = useQuery({
    enabled: !!orgId && !!effectiveSite,
    queryKey: ["rollouts", orgId, effectiveSite],
    queryFn: () => listFn({ data: { organizationId: orgId, siteId: effectiveSite } }),
    refetchInterval: 5000,
  });

  const rollouts = rolloutsQ.data?.rollouts ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk Rollouts"
        description="Staged 10→50→100% safe-apply with regression detection and instant rollback."
        actions={
          <div className="flex items-center gap-2">
            <Select value={effectiveSite} onValueChange={setSiteId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Pick a site" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CreateRolloutDialog
              orgId={orgId}
              siteId={effectiveSite}
              onCreated={() => qc.invalidateQueries({ queryKey: ["rollouts"] })}
            />
          </div>
        }
      />

      {!effectiveSite ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Pick a site to view its rollouts.
          </CardContent>
        </Card>
      ) : rollouts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Rocket className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm text-muted-foreground">
              No rollouts yet. Create one to safely apply many recommendations in stages.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rollouts.map((r) => (
            <RolloutCard key={r.id} rollout={r} orgId={orgId} />
          ))}
        </div>
      )}
    </div>
  );
}

function RolloutCard({ rollout, orgId }: { rollout: any; orgId: string }) {
  const qc = useQueryClient();
  const advanceFn = useServerFn(advanceRolloutStage);
  const rollbackFn = useServerFn(rollbackRollout);

  const advance = useMutation({
    mutationFn: () => advanceFn({ data: { organizationId: orgId, rolloutId: rollout.id } }),
    onSuccess: (r) => {
      toast.success(`Advanced to ${r.advancedTo} — ${r.enqueued} queued`);
      qc.invalidateQueries({ queryKey: ["rollouts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rollback = useMutation({
    mutationFn: () => rollbackFn({ data: { organizationId: orgId, rolloutId: rollout.id } }),
    onSuccess: (r) => {
      toast.success(`Rolled back ${r.rolledBack} items`);
      qc.invalidateQueries({ queryKey: ["rollouts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pct = rollout.total_count
    ? Math.round((rollout.applied_count / rollout.total_count) * 100)
    : 0;
  const terminal = ["completed", "failed", "rolled_back"].includes(rollout.status);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{rollout.name}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {rollout.applied_count}/{rollout.total_count} applied · stage{" "}
              <span className="font-mono">{rollout.current_stage}</span> · threshold{" "}
              {rollout.regression_threshold_pct}% · baseline{" "}
              {rollout.baseline_clicks?.toLocaleString() ?? "—"} clicks
            </p>
          </div>
          <Badge className={STATUS_TONE[rollout.status] ?? ""}>{rollout.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={pct} className="h-2" />
        {rollout.notes ? (
          <p className="text-xs text-destructive">{rollout.notes}</p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => advance.mutate()}
            disabled={terminal || advance.isPending}
          >
            <FastForward className="mr-1 h-3.5 w-3.5" />
            {advance.isPending ? "Advancing…" : "Advance stage"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => rollback.mutate()}
            disabled={rollout.applied_count === 0 || rollback.isPending}
          >
            <Undo2 className="mr-1 h-3.5 w-3.5" />
            Rollback
          </Button>
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Regression-guarded
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateRolloutDialog({
  orgId,
  siteId,
  onCreated,
}: {
  orgId: string;
  siteId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState(15);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const listRecsFn = useServerFn(listOpenRecommendations);
  const recsQ = useQuery({
    enabled: open && !!orgId && !!siteId,
    queryKey: ["rollout-recs", orgId, siteId],
    queryFn: () => listRecsFn({ data: { organizationId: orgId, siteId } }),
  });

  const createFn = useServerFn(createRollout);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          organizationId: orgId,
          siteId,
          name: name || `Rollout ${new Date().toLocaleString()}`,
          recommendationIds: Array.from(selected),
          regressionThresholdPct: threshold,
        },
      }),
    onSuccess: (r) => {
      toast.success(`Created rollout (${r.total} items, baseline ${r.baseline} clicks)`);
      setOpen(false);
      setSelected(new Set());
      setName("");
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recs = recsQ.data?.recommendations ?? [];
  const allSelected = recs.length > 0 && selected.size === recs.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!siteId}>
          <Rocket className="mr-1 h-3.5 w-3.5" /> New rollout
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create staged rollout</DialogTitle>
          <DialogDescription>
            Pick open recommendations, set a regression threshold, then advance 10→50→100%.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q4 schema cleanup"
              />
            </div>
            <div>
              <Label htmlFor="th">Regression threshold (%)</Label>
              <Input
                id="th"
                type="number"
                min={0}
                max={100}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {selected.size} of {recs.length} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(recs.map((r) => r.id)))
              }
            >
              {allSelected ? "Clear" : "Select all"}
            </Button>
          </div>

          <div className="max-h-[320px] overflow-auto rounded-md border">
            {recsQ.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : recs.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No open recommendations with linked posts. Run a Technical scan first.
              </p>
            ) : (
              <ul className="divide-y">
                {recs.map((r) => (
                  <li key={r.id} className="flex items-start gap-2 p-2 text-sm">
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={(c) => {
                        const next = new Set(selected);
                        if (c) next.add(r.id);
                        else next.delete(r.id);
                        setSelected(next);
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{r.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.category} · {r.severity}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={selected.size === 0 || create.isPending}
          >
            {create.isPending ? "Creating…" : `Create with ${selected.size} items`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}