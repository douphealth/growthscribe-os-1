import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["background_jobs"]["Row"];

/**
 * Live banner that subscribes to `background_jobs` for the current org/site and
 * renders the most recent in-flight + last completed job. Powered by the
 * pg_cron-scheduled worker that drains the queue every minute.
 */
export function ActiveJobsBanner({
  organizationId,
  siteId,
  jobTypes,
  invalidateOnSuccess,
}: {
  organizationId: string | null;
  siteId?: string | null;
  jobTypes?: string[];
  invalidateOnSuccess?: readonly unknown[][];
}) {
  const qc = useQueryClient();
  const [tick, setTick] = useState(0);

  const jobsQ = useQuery({
    queryKey: ["jobs-banner", organizationId, siteId, tick],
    enabled: !!organizationId,
    queryFn: async (): Promise<Job[]> => {
      let q = supabase
        .from("background_jobs")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: false })
        .limit(5);
      if (siteId) q = q.eq("site_id", siteId);
      if (jobTypes && jobTypes.length > 0) q = q.in("job_type", jobTypes);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!organizationId) return;
    const channel = supabase
      .channel(`jobs-${organizationId}-${siteId ?? "all"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "background_jobs",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          setTick((t) => t + 1);
          const newRow = payload.new as Job | undefined;
          if (newRow?.status === "succeeded" && invalidateOnSuccess) {
            for (const key of invalidateOnSuccess) {
              qc.invalidateQueries({ queryKey: key });
            }
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId, siteId, qc, invalidateOnSuccess]);

  const jobs = jobsQ.data ?? [];
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const lastDone = jobs.find((j) => j.status === "succeeded" || j.status === "failed");

  if (active.length === 0 && !lastDone) return null;

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
        {active.length > 0 ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="font-medium">
              {active.length} job{active.length === 1 ? "" : "s"} in progress
            </span>
            <div className="flex flex-wrap gap-1.5">
              {active.slice(0, 4).map((j) => (
                <Badge key={j.id} variant="secondary" className="font-mono text-[10px]">
                  {j.job_type} · {j.status}
                  {j.total_items
                    ? ` (${j.items_processed}/${j.total_items})`
                    : j.items_processed
                      ? ` (${j.items_processed})`
                      : ""}
                </Badge>
              ))}
            </div>
            <span className="text-muted-foreground ml-auto text-xs">
              Worker drains queue every minute
            </span>
          </>
        ) : lastDone ? (
          <>
            {lastDone.status === "succeeded" ? (
              <CheckCircle2 className="text-success h-4 w-4" />
            ) : (
              <AlertCircle className="text-destructive h-4 w-4" />
            )}
            <span className="text-muted-foreground">
              Last job:{" "}
              <span className="text-foreground font-medium">{lastDone.job_type}</span> ·{" "}
              {lastDone.status}
              {lastDone.finished_at
                ? ` · ${new Date(lastDone.finished_at).toLocaleTimeString()}`
                : ""}
            </span>
            {lastDone.error ? (
              <span className="text-destructive text-xs">{lastDone.error.slice(0, 140)}</span>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}