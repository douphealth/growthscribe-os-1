import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertCircle, TrendingUp } from "lucide-react";

const SCORE_LABELS: Record<string, string> = {
  technical_seo: "Technical SEO",
  content_quality: "Content Quality",
  eeat: "E-E-A-T",
  aeo: "AEO (Answer Engines)",
  geo: "GEO (Generative Engines)",
  topical_authority: "Topical Authority",
  internal_link: "Internal Links",
  revenue_opportunity: "Revenue Opportunity",
  content_decay: "Content Decay",
  growth_opportunity: "Growth Opportunity",
};

export type ScoreBreakdownRow = {
  id: string;
  score_type: string;
  score: number;
  explanation: string | null;
  evidence: unknown;
  recommended_actions: unknown;
  estimated_impact: string | null;
  confidence: string;
  computed_at: string;
};

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-500";
  if (score >= 60) return "text-amber-500";
  return "text-red-500";
}

export function ScoreBreakdownCard({ row }: { row: ScoreBreakdownRow }) {
  const actions = Array.isArray(row.recommended_actions)
    ? (row.recommended_actions as string[])
    : [];
  const label = SCORE_LABELS[row.score_type] ?? row.score_type;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold">{label}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {row.confidence} confidence
            </Badge>
            {row.estimated_impact && (
              <Badge variant="secondary" className="text-xs flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                {row.estimated_impact} impact
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <span className={`text-3xl font-bold ${scoreColor(row.score)}`}>{row.score}</span>
          <Progress value={row.score} className="flex-1" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {row.explanation && (
          <p className="text-sm text-muted-foreground">{row.explanation}</p>
        )}
        {actions.length > 0 ? (
          <ul className="space-y-1.5">
            {actions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> No actions recommended
          </p>
        )}
      </CardContent>
    </Card>
  );
}