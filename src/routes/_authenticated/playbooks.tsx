import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, PlayCircle, History, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import {
  listPlaybooks,
  seedSystemPlaybooks,
  listPlaybookRuns,
  listChangesets,
  listLiftSummary,
} from "@/lib/playbooks.functions";
import { ASSET_BLOCKS, type AssetBlockKind } from "@/lib/playbook-presets";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/playbooks")({
  component: PlaybooksPage,
  head: () => ({
    meta: [
      { title: "Playbooks — GrowthScribe" },
      { name: "description", content: "Encode your editorial pass as reusable playbooks. Apply across many posts. Measure lift." },
    ],
  }),
});

type Playbook = {
  id: string;
  name: string;
  description: string | null;
  target_intent: string | null;
  asset_blocks: Array<{ kind: AssetBlockKind; weight: number }>;
  is_system: boolean;
};

type Run = {
  id: string;
  playbook_id: string;
  post_id: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

type Changeset = {
  id: string;
  post_id: string | null;
  source: string;
  asset_blocks_added: Array<{ kind: string }>;
  applied_at: string;
};

type Lift = {
  changeset_id: string;
  window_days: number;
  clicks_delta: number | null;
  impressions_delta: number | null;
  position_delta: number | null;
};

function PlaybooksPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  const fetchPlaybooks = useServerFn(listPlaybooks);
  const fetchRuns = useServerFn(listPlaybookRuns);
  const fetchChangesets = useServerFn(listChangesets);
  const fetchLift = useServerFn(listLiftSummary);
  const seedFn = useServerFn(seedSystemPlaybooks);

  const playbooks = useQuery({
    queryKey: ["playbooks", orgId],
    enabled: !!orgId,
    queryFn: () => fetchPlaybooks({ data: { organizationId: orgId! } }),
  });
  const runs = useQuery({
    queryKey: ["playbook-runs", orgId],
    enabled: !!orgId,
    queryFn: () => fetchRuns({ data: { organizationId: orgId!, limit: 50 } }),
  });
  const changesets = useQuery({
    queryKey: ["changesets", orgId],
    enabled: !!orgId,
    queryFn: () => fetchChangesets({ data: { organizationId: orgId!, limit: 50 } }),
  });
  const lift = useQuery({
    queryKey: ["lift-summary", orgId],
    enabled: !!orgId,
    queryFn: () => fetchLift({ data: { organizationId: orgId! } }),
  });

  const seedMut = useMutation({
    mutationFn: () => seedFn({ data: { organizationId: orgId! } }),
    onSuccess: (r) => {
      toast.success(`Seeded ${r.inserted} system playbook${r.inserted === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["playbooks", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = (playbooks.data?.playbooks ?? []) as Playbook[];

  return (
    <>
      <PageHeader
        title="Playbooks"
        description="Encode your editorial pass once. Apply it across many posts. Measure the lift."
        actions={
          <Button onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
            <Sparkles className="h-4 w-4 mr-2" />
            {seedMut.isPending ? "Seeding…" : "Seed system playbooks"}
          </Button>
        }
      />

      <Tabs defaultValue="library" className="mt-4">
        <TabsList>
          <TabsTrigger value="library">Library ({list.length})</TabsTrigger>
          <TabsTrigger value="runs">Runs ({(runs.data?.runs ?? []).length})</TabsTrigger>
          <TabsTrigger value="changesets">
            Changesets ({(changesets.data?.changesets ?? []).length})
          </TabsTrigger>
          <TabsTrigger value="lift">Lift</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="mt-4">
          {list.length === 0 ? (
            <EmptyState onSeed={() => seedMut.mutate()} pending={seedMut.isPending} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {list.map((p) => (
                <PlaybookCard key={p.id} pb={p} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <RunsTable runs={(runs.data?.runs ?? []) as Run[]} />
        </TabsContent>

        <TabsContent value="changesets" className="mt-4">
          <ChangesetsTable rows={(changesets.data?.changesets ?? []) as Changeset[]} />
        </TabsContent>

        <TabsContent value="lift" className="mt-4">
          <LiftPanel rows={(lift.data?.measurements ?? []) as Lift[]} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function EmptyState({ onSeed, pending }: { onSeed: () => void; pending: boolean }) {
  return (
    <Card>
      <CardContent className="py-12 text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        <div>
          <p className="font-semibold">No playbooks yet</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1">
            Seed the 4 built-in playbooks (Review, Comparison, Informational AEO, Commercial CRO)
            that encode the 12 asset blocks from your manual editorial pass.
          </p>
        </div>
        <Button onClick={onSeed} disabled={pending}>
          {pending ? "Seeding…" : "Seed system playbooks"}
        </Button>
      </CardContent>
    </Card>
  );
}

function PlaybookCard({ pb }: { pb: Playbook }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="border-border/60 hover:shadow-[var(--shadow-elegant)] transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{pb.name}</CardTitle>
          {pb.is_system && <Badge variant="secondary" className="text-[10px]">System</Badge>}
        </div>
        {pb.target_intent && (
          <Badge variant="outline" className="w-fit text-[10px] uppercase tracking-wider">
            {pb.target_intent}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {pb.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{pb.description}</p>
        )}
        <div className="flex flex-wrap gap-1">
          {(expanded ? pb.asset_blocks : pb.asset_blocks.slice(0, 4)).map((b) => (
            <Badge key={b.kind} variant="outline" className="text-[10px]">
              {ASSET_BLOCKS[b.kind]?.label ?? b.kind}
            </Badge>
          ))}
          {pb.asset_blocks.length > 4 && !expanded && (
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded(true)}
            >
              +{pb.asset_blocks.length - 4} more
            </button>
          )}
        </div>
        <Button size="sm" variant="outline" className="w-full" disabled>
          <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
          Apply to posts (select inventory)
        </Button>
      </CardContent>
    </Card>
  );
}

function RunsTable({ runs }: { runs: Run[] }) {
  if (runs.length === 0)
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No playbook runs yet. Apply a playbook to one or more posts to populate this view.
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b">
            <tr>
              <th className="text-left p-3">Run</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">When</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="p-3 font-mono text-xs">{r.id.slice(0, 8)}</td>
                <td className="p-3">
                  <Badge
                    variant={
                      r.status === "applied"
                        ? "default"
                        : r.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {r.status}
                  </Badge>
                </td>
                <td className="p-3 text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ChangesetsTable({ rows }: { rows: Changeset[] }) {
  if (rows.length === 0)
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No changesets recorded yet. Every applied WP fix or playbook run lands here as an
          immutable before/after record that drives lift attribution.
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b">
            <tr>
              <th className="text-left p-3">Source</th>
              <th className="text-left p-3">Asset blocks added</th>
              <th className="text-left p-3">Applied</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="p-3">
                  <Badge variant="outline">{c.source}</Badge>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {(c.asset_blocks_added ?? []).slice(0, 5).map((b, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">
                        {b.kind}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="p-3 text-muted-foreground text-xs">
                  {new Date(c.applied_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function LiftPanel({ rows }: { rows: Lift[] }) {
  if (rows.length === 0)
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground space-y-2">
          <TrendingUp className="h-6 w-6 mx-auto text-muted-foreground/60" />
          <p>No lift measurements yet.</p>
          <p className="text-xs max-w-md mx-auto">
            Once changesets are applied and 7/14/28 days of GSC data accumulate, this panel will
            attribute clicks, impressions, and position deltas to each edit.
          </p>
        </CardContent>
      </Card>
    );
  // Aggregate by window
  const byWindow = new Map<number, { clicks: number; impressions: number; positions: number[]; n: number }>();
  for (const r of rows) {
    const e = byWindow.get(r.window_days) ?? { clicks: 0, impressions: 0, positions: [], n: 0 };
    e.clicks += Number(r.clicks_delta ?? 0);
    e.impressions += Number(r.impressions_delta ?? 0);
    if (r.position_delta != null) e.positions.push(Number(r.position_delta));
    e.n++;
    byWindow.set(r.window_days, e);
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[7, 14, 28].map((win) => {
        const e = byWindow.get(win);
        if (!e) return (
          <Card key={win}>
            <CardHeader><CardTitle className="text-sm">{win}-day window</CardTitle></CardHeader>
            <CardContent className="text-xs text-muted-foreground">No data yet</CardContent>
          </Card>
        );
        const avgPos = e.positions.length
          ? e.positions.reduce((s, x) => s + x, 0) / e.positions.length
          : 0;
        return (
          <Card key={win}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <History className="h-4 w-4" /> {win}-day lift
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <LiftRow label="Clicks Δ" value={e.clicks} />
              <LiftRow label="Impressions Δ" value={e.impressions} />
              <LiftRow label="Avg position Δ" value={avgPos} invert decimals={2} />
              <p className="text-[10px] text-muted-foreground pt-2 border-t">
                Across {e.n} changeset{e.n === 1 ? "" : "s"}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function LiftRow({
  label,
  value,
  invert,
  decimals = 0,
}: {
  label: string;
  value: number;
  invert?: boolean;
  decimals?: number;
}) {
  const positive = invert ? value > 0 : value > 0;
  const negative = invert ? value < 0 : value < 0;
  const Icon = positive ? TrendingUp : negative ? TrendingDown : Minus;
  const tone = positive ? "text-emerald-600" : negative ? "text-rose-600" : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`flex items-center gap-1 tabular-nums font-medium ${tone}`}>
        <Icon className="h-3.5 w-3.5" />
        {value > 0 ? "+" : ""}
        {value.toFixed(decimals)}
      </span>
    </div>
  );
}