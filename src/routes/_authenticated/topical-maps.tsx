import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import type { Database } from "@/integrations/supabase/types";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Network, Sparkles, Search } from "lucide-react";
import { generateTopicalMap } from "@/lib/topical.functions";
import { analyzeCompetitor, listCompetitorPages } from "@/lib/competitor.functions";
import { Input } from "@/components/ui/input";

type Site = Database["public"]["Tables"]["sites"]["Row"];
type MapNode = Database["public"]["Tables"]["topical_maps"]["Row"];

export const Route = createFileRoute("/_authenticated/topical-maps")({
  component: TopicalMapsPage,
});

const coverageColor = (s: string | null) =>
  s === "covered" ? "default" : s === "partial" ? "secondary" : "destructive";

function TopicalMapsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  const generate = useServerFn(generateTopicalMap);
  const analyzeFn = useServerFn(analyzeCompetitor);
  const listCompFn = useServerFn(listCompetitorPages);

  const sitesQ = useQuery({
    queryKey: ["sites", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Site[]> => {
      const { data, error } = await supabase
        .from("sites")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [siteId, setSiteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [competitorUrl, setCompetitorUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const competitorsQ = useQuery({
    queryKey: ["competitor-pages", orgId, siteId],
    enabled: !!orgId && !!siteId,
    queryFn: async () => {
      const res = await listCompFn({ data: { organizationId: orgId!, siteId, limit: 25 } });
      return res.rows;
    },
  });

  const onAnalyze = async () => {
    if (!orgId || !siteId) {
      toast.error("Pick a site first");
      return;
    }
    if (!competitorUrl.trim()) {
      toast.error("Enter a competitor URL");
      return;
    }
    setAnalyzing(true);
    const t = toast.loading("Analyzing competitor page…");
    try {
      const res = await analyzeFn({
        data: { organizationId: orgId, siteId, url: competitorUrl.trim() },
      });
      toast.success(`Analyzed · ${res.wordCount} words · ${res.schemaTypes.length} schemas`, {
        id: t,
      });
      setCompetitorUrl("");
      qc.invalidateQueries({ queryKey: ["competitor-pages", orgId, siteId] });
    } catch (err) {
      toast.error((err as Error).message, { id: t });
    } finally {
      setAnalyzing(false);
    }
  };

  const mapQ = useQuery({
    queryKey: ["topical-maps", orgId, siteId],
    enabled: !!orgId && !!siteId,
    queryFn: async (): Promise<MapNode[]> => {
      const { data, error } = await supabase
        .from("topical_maps")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("site_id", siteId)
        .order("priority", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const grouped = useMemo(() => {
    const nodes = mapQ.data ?? [];
    const pillars = nodes.filter((n) => !n.parent_id);
    return pillars.map((p) => ({
      pillar: p,
      clusters: nodes.filter((n) => n.parent_id === p.id),
    }));
  }, [mapQ.data]);

  const onGenerate = async () => {
    if (!orgId || !siteId) {
      toast.error("Pick a site");
      return;
    }
    setBusy(true);
    const t = toast.loading("Building topical map with AI…");
    try {
      const res = await generate({ data: { organizationId: orgId, siteId } });
      toast.success(`${res.pillars} pillars · ${res.nodes} nodes`, { id: t });
      qc.invalidateQueries({ queryKey: ["topical-maps", orgId, siteId] });
      qc.invalidateQueries({ queryKey: ["activities", orgId] });
    } catch (err) {
      toast.error((err as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  };

  if (!currentOrg) {
    return (
      <EmptyState
        icon={Network}
        title="No workspace selected"
        description="Create a workspace to generate topical maps."
        action={
          <Button asChild>
            <Link to="/onboarding">Start onboarding</Link>
          </Button>
        }
      />
    );
  }

  const sites = sitesQ.data ?? [];

  return (
    <>
      <PageHeader title="Topical Maps" description="Pillar/cluster coverage and gap analysis." />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Generate map
          </CardTitle>
          <CardDescription>
            Uses your synced WordPress posts as the corpus. Sync content first.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="space-y-1.5 flex-1">
            <Label>Site</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a site" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={onGenerate} disabled={busy || !siteId}>
            {busy ? "Generating…" : "Generate topical map"}
          </Button>
        </CardContent>
      </Card>

      {!siteId ? (
        <EmptyState
          icon={Network}
          title="Pick a site"
          description="Select a site above to view or generate its map."
        />
      ) : mapQ.isLoading ? (
        <div className="h-40 rounded-md bg-muted/30 animate-pulse" />
      ) : grouped.length === 0 ? (
        <EmptyState icon={Network} title="No map yet" description="Generate one for this site." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {grouped.map(({ pillar, clusters }) => (
            <Card key={pillar.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">{pillar.pillar}</CardTitle>
                  <Badge variant={coverageColor(pillar.coverage_status)}>
                    {pillar.coverage_status}
                  </Badge>
                </div>
                {pillar.intent && <CardDescription>{pillar.intent}</CardDescription>}
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {clusters.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm">{c.cluster}</span>
                      <Badge variant={coverageColor(c.coverage_status)}>{c.coverage_status}</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {siteId && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" /> Competitor analysis
            </CardTitle>
            <CardDescription>
              Paste a competitor URL to extract headings, schema markup, word count, and SEO
              signals. Use insights to inform briefs and topical map gaps.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="https://competitor.com/article"
                value={competitorUrl}
                onChange={(e) => setCompetitorUrl(e.target.value)}
                disabled={analyzing}
              />
              <Button onClick={onAnalyze} disabled={analyzing || !competitorUrl.trim()}>
                {analyzing ? "Analyzing…" : "Analyze"}
              </Button>
            </div>
            {competitorsQ.data && competitorsQ.data.length > 0 && (
              <div className="space-y-2">
                {competitorsQ.data.map((c) => {
                  const schemas = Array.isArray(c.schema_types) ? (c.schema_types as string[]) : [];
                  return (
                    <div
                      key={c.id}
                      className="rounded-md border p-3 text-sm flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium truncate hover:underline"
                        >
                          {c.title ?? c.url}
                        </a>
                        <Badge variant="outline">{c.competitor_domain}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{c.word_count ?? 0} words</span>
                        {schemas.length > 0 && <span>· schemas: {schemas.join(", ")}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
