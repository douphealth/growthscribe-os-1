import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileSearch } from "lucide-react";

export const Route = createFileRoute("/_authenticated/audits")({
  component: AuditsPage,
});

function AuditsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["audits"],
    queryFn: async () => {
      const { data } = await supabase.from("content_audits").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <>
      <PageHeader
        title="Content Audits"
        description="AI-driven URL-level audits scoring quality, E-E-A-T, and AEO readiness."
      />
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="No audits yet"
          description="Connect a site, then queue your first batch of AI content audits."
        />
      ) : (
        <div className="space-y-3">
          {data.map((a: any) => (
            <Card key={a.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-medium truncate">{a.title || a.url}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.url}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-xs">
                    <p className="text-muted-foreground">Quality</p>
                    <p className="font-semibold">{a.quality_score ?? "—"}</p>
                  </div>
                  <Badge variant={a.status === "completed" ? "default" : "secondary"}>{a.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}