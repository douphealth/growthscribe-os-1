import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getPrioritizedActions } from "@/lib/recommendations.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Flame, ArrowRight, Zap } from "lucide-react";

const SEVERITY_TONE: Record<string, string> = {
  high: "bg-destructive/10 text-destructive border-destructive/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

const CATEGORY_LABEL: Record<string, string> = {
  "striking-distance": "Page-1 push",
  refresh: "Refresh",
  expand: "Expand",
  "internal-link": "Internal link",
  "merge-or-prune": "Merge/Prune",
  technical: "Technical",
  performance: "Performance",
  aeo: "AEO",
  geo: "GEO",
};

export function PrioritizedActionQueue({ orgId }: { orgId: string | null }) {
  const fetchActions = useServerFn(getPrioritizedActions);
  const { data, isLoading } = useQuery({
    queryKey: ["prioritized-actions", orgId],
    enabled: !!orgId,
    queryFn: () => fetchActions({ data: { organizationId: orgId!, limit: 8 } }),
  });

  const actions = data?.actions ?? [];

  return (
    <Card className="border-border/60 shadow-[var(--shadow-card)]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Flame className="h-4 w-4 text-primary" />
          Prioritized action queue
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/recommendations">
            View all <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Scoring opportunities…</p>
        ) : actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open recommendations yet. Run a content scan or sync a site to populate the queue.
          </p>
        ) : (
          <ol className="space-y-2">
            {actions.map((a, idx) => (
              <li
                key={a.id}
                className="group relative flex items-start gap-3 rounded-lg border border-border/60 p-3 hover:border-primary/40 hover:bg-accent/30 transition"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary/20 to-primary/5 text-xs font-semibold tabular-nums text-primary ring-1 ring-primary/20">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase tracking-wider ${SEVERITY_TONE[a.severity] ?? ""}`}
                    >
                      {CATEGORY_LABEL[a.category] ?? a.category}
                    </Badge>
                    {a.site_name && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                        {a.site_name}
                      </span>
                    )}
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                      <Zap className="h-3 w-3" />
                      {a.priority}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium leading-snug truncate">{a.title}</p>
                  {a.suggested_action && (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {a.suggested_action}
                    </p>
                  )}
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground tabular-nums">
                    <span>Impact {a.impact}</span>
                    <span>· Confidence {a.confidence}</span>
                    <span>· Effort {a.effort}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}