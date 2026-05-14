import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import type { Database } from "@/integrations/supabase/types";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Lightbulb,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Link2,
  Trash2,
  Maximize2,
  Check,
  ExternalLink,
} from "lucide-react";
import {
  generateRecommendations,
  updateRecommendationStatus,
} from "@/lib/recommendations.functions";

type Rec = Database["public"]["Tables"]["content_recommendations"]["Row"];
type Site = Database["public"]["Tables"]["sites"]["Row"];

export const Route = createFileRoute("/_authenticated/recommendations")({
  component: Page,
});

const CATEGORY_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  refresh: { label: "Refresh", icon: RefreshCw },
  expand: { label: "Expand", icon: Maximize2 },
  "striking-distance": { label: "Page-1 push", icon: TrendingUp },
  "internal-link": { label: "Internal link", icon: Link2 },
  "merge-or-prune": { label: "Merge / prune", icon: Trash2 },
};

function Page() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  const generate = useServerFn(generateRecommendations);
  const update = useServerFn(updateRecommendationStatus);
  const [siteId, setSiteId] = useState<string>("");
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);

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

  const sites = sitesQ.data ?? [];
  const activeSiteId = siteId || sites[0]?.id || "";

  const recsQ = useQuery({
    queryKey: ["recs", orgId, activeSiteId],
    enabled: !!orgId && !!activeSiteId,
    queryFn: async (): Promise<Rec[]> => {
      const { data, error } = await supabase
        .from("content_recommendations")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("site_id", activeSiteId)
        .order("severity", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const recs = recsQ.data ?? [];
  const filtered = useMemo(
    () =>
      filter === "all"
        ? recs
        : recs.filter((r) => (filter === "open" ? r.status === "open" : r.category === filter)),
    [recs, filter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { open: 0, high: 0 };
    for (const r of recs) {
      if (r.status === "open") c.open++;
      if (r.severity === "high") c.high++;
      c[r.category] = (c[r.category] ?? 0) + 1;
    }
    return c;
  }, [recs]);

  const handleGenerate = async () => {
    if (!orgId || !activeSiteId) return;
    setBusy(true);
    const t = toast.loading("Analyzing posts and generating recommendations…");
    try {
      const res = await generate({
        data: { organizationId: orgId, siteId: activeSiteId },
      });
      toast.success(
        res.generated > 0
          ? `Generated ${res.generated} recommendations`
          : (res.message ?? "Nothing actionable yet"),
        { id: t },
      );
      qc.invalidateQueries({ queryKey: ["recs", orgId, activeSiteId] });
      qc.invalidateQueries({ queryKey: ["activities", orgId] });
    } catch (err) {
      toast.error((err as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (rec: Rec, status: "done" | "dismissed") => {
    if (!orgId) return;
    try {
      await update({
        data: { organizationId: orgId, recommendationId: rec.id, status },
      });
      qc.invalidateQueries({ queryKey: ["recs", orgId, activeSiteId] });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!currentOrg) {
    return (
      <EmptyState
        icon={Lightbulb}
        title="No workspace selected"
        description="Create a workspace to see recommendations."
        action={
          <Button asChild>
            <Link to="/onboarding">Start onboarding</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Recommendations"
        description="Prioritized improvements: refresh stale posts, expand thin content, push page-1 strikers, fix internal links, prune zombies."
        actions={
          <div className="flex items-center gap-2">
            <Select value={activeSiteId} onValueChange={setSiteId}>
              <SelectTrigger className="w-[220px]">
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
            <Button onClick={handleGenerate} disabled={busy || !activeSiteId}>
              <Sparkles className="h-4 w-4 mr-2" />
              {busy ? "Analyzing…" : "Generate"}
            </Button>
          </div>
        }
      />

      {sites.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No sites yet"
          description="Add a site, sync WordPress and link Search Console, then generate recommendations."
          action={
            <Button asChild>
              <Link to="/sites">Add a site</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <FilterChip
              label={`All · ${recs.length}`}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <FilterChip
              label={`Open · ${counts.open ?? 0}`}
              active={filter === "open"}
              onClick={() => setFilter("open")}
            />
            {Object.entries(CATEGORY_META).map(([key, meta]) => (
              <FilterChip
                key={key}
                label={`${meta.label} · ${counts[key] ?? 0}`}
                active={filter === key}
                onClick={() => setFilter(key)}
              />
            ))}
          </div>

          {recsQ.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-lg bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="Nothing here yet"
              description="Click Generate to analyze synced posts and Search Console data."
            />
          ) : (
            <div className="space-y-3">
              {filtered.map((r) => {
                const Meta = CATEGORY_META[r.category] ?? {
                  label: r.category,
                  icon: Lightbulb,
                };
                const Icon = Meta.icon;
                return (
                  <Card key={r.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                r.severity === "high"
                                  ? "destructive"
                                  : r.severity === "medium"
                                    ? "default"
                                    : "secondary"
                              }
                            >
                              {r.severity}
                            </Badge>
                            <Badge variant="outline">{Meta.label}</Badge>
                            {r.status !== "open" && <Badge variant="secondary">{r.status}</Badge>}
                          </div>
                          <p className="font-medium mt-1">{r.title}</p>
                          {r.detail && (
                            <p className="text-sm text-muted-foreground mt-0.5">{r.detail}</p>
                          )}
                          {r.suggested_action && (
                            <p className="text-sm mt-1">
                              <span className="text-muted-foreground">Action: </span>
                              {r.suggested_action}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {r.status === "open" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setStatus(r, "done")}
                              >
                                <Check className="h-3 w-3 mr-1" /> Done
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setStatus(r, "dismissed")}
                              >
                                Dismiss
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant="ghost" asChild>
                            <Link to="/briefs">
                              <ExternalLink className="h-3 w-3 mr-1" /> Brief
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
