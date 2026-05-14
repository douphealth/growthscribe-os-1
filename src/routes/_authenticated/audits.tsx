import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import type { Database } from "@/integrations/supabase/types";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileSearch } from "lucide-react";

type Audit = Database["public"]["Tables"]["content_audits"]["Row"];

export const Route = createFileRoute("/_authenticated/audits")({
  component: AuditsPage,
});

function AuditsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["audits", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Audit[]> => {
      const { data, error } = await supabase
        .from("content_audits")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
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
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-md bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={FileSearch}
          title="Couldn't load audits"
          description="There was a problem reaching the database."
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="No audits yet"
          description="Connect a site, then queue your first batch of AI content audits."
        />
      ) : (
        <div className="space-y-3">
          {data.map((a) => (
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