import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import type { Database, Json } from "@/integrations/supabase/types";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileSearch, Sparkles } from "lucide-react";
import { runContentAudit } from "@/lib/audit.functions";

type Audit = Database["public"]["Tables"]["content_audits"]["Row"];
type Site = Database["public"]["Tables"]["sites"]["Row"];

export const Route = createFileRoute("/_authenticated/audits")({
  component: AuditsPage,
});

const formSchema = z.object({
  siteId: z.string().uuid("Pick a site"),
  url: z.string().trim().url("Enter a valid URL").max(1000),
});

function AuditsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  const audit = useServerFn(runContentAudit);

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

  const auditsQ = useQuery({
    queryKey: ["audits", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Audit[]> => {
      const { data, error } = await supabase
        .from("content_audits")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [siteId, setSiteId] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const sites = sitesQ.data ?? [];
  const audits = auditsQ.data ?? [];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    const parsed = formSchema.safeParse({ siteId, url });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const t = toast.loading("Running AI audit…");
    try {
      const res = await audit({ data: { organizationId: orgId, ...parsed.data } });
      toast.success(`Audit complete · Quality ${res.quality_score}/100`, { id: t });
      setUrl("");
      qc.invalidateQueries({ queryKey: ["audits", orgId] });
      qc.invalidateQueries({ queryKey: ["activities", orgId] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats", orgId] });
    } catch (err) {
      toast.error((err as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  };

  if (!currentOrg) {
    return (
      <EmptyState
        icon={FileSearch}
        title="No workspace selected"
        description="Create a workspace to run content audits."
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
        title="Content Audits"
        description="AI-driven URL-level audits scoring quality, E-E-A-T, and AEO readiness."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Run audit
            </CardTitle>
            <CardDescription>Fetches the page and scores it with Lovable AI.</CardDescription>
          </CardHeader>
          <CardContent>
            {sites.length === 0 ? (
              <EmptyState
                icon={FileSearch}
                title="Add a site first"
                description="Audits attach to a site."
                action={
                  <Button asChild>
                    <Link to="/sites">Go to Sites</Link>
                  </Button>
                }
              />
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
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
                <div className="space-y-1.5">
                  <Label htmlFor="url">URL to audit</Label>
                  <Input
                    id="url"
                    type="url"
                    required
                    placeholder="https://example.com/blog/post"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Auditing…" : "Run audit"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-3">
          {auditsQ.isLoading ? (
            [1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-md bg-muted/30 animate-pulse" />
            ))
          ) : audits.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="No audits yet"
              description="Run your first AI audit on the left."
            />
          ) : (
            audits.map((a) => {
              const recs = Array.isArray(a.recommendations)
                ? (a.recommendations as Json[])
                : [];
              return (
                <Card key={a.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{a.title || a.url}</p>
                        <p className="text-xs text-muted-foreground truncate">{a.url}</p>
                      </div>
                      <Badge
                        variant={
                          a.status === "completed"
                            ? "default"
                            : a.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {a.status}
                      </Badge>
                    </div>
                    {a.status === "completed" && (
                      <>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <ScorePill label="Quality" value={a.quality_score} />
                          <ScorePill label="E-E-A-T" value={a.eeat_score} />
                          <ScorePill label="AEO" value={a.aeo_score} />
                        </div>
                        {a.ai_summary && (
                          <p className="text-sm text-muted-foreground">{a.ai_summary}</p>
                        )}
                        {recs.length > 0 && (
                          <ul className="text-sm space-y-1 mt-2">
                            {recs.slice(0, 4).map((r, i) => {
                              const rec = r as {
                                area?: string;
                                priority?: string;
                                recommendation?: string;
                              };
                              return (
                                <li key={i} className="flex gap-2">
                                  <Badge variant="outline" className="shrink-0">
                                    {rec.priority}
                                  </Badge>
                                  <span>
                                    <strong>{rec.area}:</strong> {rec.recommendation}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </>
                    )}
                    {a.status === "failed" && a.ai_summary && (
                      <p className="text-xs text-destructive">{a.ai_summary}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

function ScorePill({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const color =
    v >= 80 ? "text-emerald-500" : v >= 60 ? "text-amber-500" : "text-destructive";
  return (
    <div className="rounded-md border p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value ?? "—"}</p>
    </div>
  );
}
