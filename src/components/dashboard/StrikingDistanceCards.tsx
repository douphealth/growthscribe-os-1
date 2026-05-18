import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getStrikingDistanceKeywords } from "@/lib/recommendations.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target, TrendingUp, ExternalLink } from "lucide-react";

export function StrikingDistanceCards({ orgId }: { orgId: string | null }) {
  const fetchKeywords = useServerFn(getStrikingDistanceKeywords);
  const { data, isLoading } = useQuery({
    queryKey: ["striking-distance", orgId],
    enabled: !!orgId,
    queryFn: () => fetchKeywords({ data: { organizationId: orgId!, limit: 6 } }),
  });

  const keywords = data?.keywords ?? [];

  return (
    <Card className="border-border/60 shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          Striking distance keywords
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Calculating uplift potential…</p>
        ) : keywords.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Connect Search Console and sync data to surface page-1 push opportunities.
          </p>
        ) : (
          <ul className="space-y-2">
            {keywords.map((k, i) => (
              <li
                key={`${k.site_id}-${k.query}-${i}`}
                className="group flex items-start gap-3 rounded-lg border border-border/60 p-3 hover:border-primary/40 hover:bg-accent/30 transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-primary/10 text-primary border-primary/30">
                      Pos {k.position}
                    </Badge>
                    {k.site_name && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                        {k.site_name}
                      </span>
                    )}
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <TrendingUp className="h-3 w-3" />
                      +{k.uplift_clicks.toLocaleString()} clicks/mo
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium leading-snug truncate">{k.query}</p>
                  <a
                    href={k.page}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary truncate max-w-full"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{k.page}</span>
                  </a>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground tabular-nums">
                    <span>{k.impressions.toLocaleString()} impr</span>
                    <span>· {k.clicks.toLocaleString()} clicks</span>
                    <span>· CTR {k.current_ctr}%</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
