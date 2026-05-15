import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bot, Play, ExternalLink, Sparkles } from "lucide-react";
import { runAiVisibilityTests, listAiVisibility } from "@/lib/ai-visibility.functions";

export const Route = createFileRoute("/_authenticated/ai-visibility")({
  component: Page,
});

const ENGINE_LABEL: Record<string, string> = {
  gpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

function Page() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const [siteId, setSiteId] = useState<string>("");
  const [queries, setQueries] = useState<string>("");
  const [running, setRunning] = useState(false);

  const sitesQ = useQuery({
    queryKey: ["sites", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites")
        .select("id, name, url")
        .eq("organization_id", orgId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const effectiveSite = siteId || sitesQ.data?.[0]?.id || "";

  const runFn = useServerFn(runAiVisibilityTests);
  const listFn = useServerFn(listAiVisibility);

  const listQ = useQuery({
    queryKey: ["aivt", orgId, effectiveSite],
    enabled: !!orgId && !!effectiveSite,
    queryFn: () => listFn({ data: { organizationId: orgId!, siteId: effectiveSite, limit: 100 } }),
  });

  const coverage = useMemo(() => {
    const by = listQ.data?.byEngine ?? {};
    const total = Object.values(by).reduce((s, v) => s + v.total, 0);
    const hits = Object.values(by).reduce((s, v) => s + v.hits, 0);
    return { total, hits, pct: total ? Math.round((hits / total) * 100) : 0 };
  }, [listQ.data]);

  async function onRun() {
    if (!orgId || !effectiveSite) return;
    const list = queries
      .split("\n")
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (list.length === 0) {
      toast.error("Add at least one query (one per line)");
      return;
    }
    setRunning(true);
    try {
      const res = await runFn({
        data: {
          organizationId: orgId,
          siteId: effectiveSite,
          queries: list,
          engines: ["gpt", "gemini", "perplexity"],
        },
      });
      toast.success(`Tested ${res.total} prompts • ${res.hits} mentions`);
      await listQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  if (!orgId) return null;

  return (
    <>
      <PageHeader
        title="AI Visibility"
        description="Test how often your site appears across ChatGPT, Gemini, and Perplexity for your target prompts."
        actions={
          <Select value={effectiveSite} onValueChange={setSiteId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select a site" />
            </SelectTrigger>
            <SelectContent>
              {(sitesQ.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="grid gap-4 md:grid-cols-3 mb-4">
        <StatCard
          label="Coverage"
          value={`${coverage.pct}%`}
          sub={`${coverage.hits}/${coverage.total} mentions`}
        />
        {(["gpt", "gemini", "perplexity"] as const)
          .map((e) => {
            const v = listQ.data?.byEngine?.[e] ?? { total: 0, hits: 0 };
            const pct = v.total ? Math.round((v.hits / v.total) * 100) : 0;
            return (
              <StatCard
                key={e}
                label={ENGINE_LABEL[e]}
                value={`${pct}%`}
                sub={`${v.hits}/${v.total}`}
              />
            );
          })
          .slice(0, 2)}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> Run a visibility test
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={queries}
            onChange={(e) => setQueries(e.target.value)}
            placeholder={"best running shoes for marathon\nhow to fix a leaky faucet\n..."}
            rows={5}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              One prompt per line. Up to 10 prompts × 3 engines per run.
            </p>
            <Button onClick={onRun} disabled={running || !effectiveSite}>
              <Play className="h-4 w-4 mr-2" />
              {running ? "Running..." : "Run test"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" /> Recent results
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(listQ.data?.rows ?? []).length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No tests yet"
              description="Add prompts above and run your first AI visibility test."
            />
          ) : (
            <div className="divide-y">
              {(listQ.data?.rows ?? []).map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-3 text-sm">
                  <Badge variant="outline" className="capitalize w-24 justify-center">
                    {ENGINE_LABEL[r.engine] ?? r.engine}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{r.query}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.tested_at).toLocaleString()}
                    </p>
                  </div>
                  {r.appears ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
                      Mentioned{r.rank ? ` · #${r.rank}` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Not mentioned
                    </Badge>
                  )}
                  {r.citation_url && (
                    <a
                      href={r.citation_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Source
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
