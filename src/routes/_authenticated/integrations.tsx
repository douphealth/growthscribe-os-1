import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plug, Globe, RefreshCw, Search, BarChart3 } from "lucide-react";
import { verifyWordpressConnection, syncWordpressContent } from "@/lib/wordpress.functions";
import { saveGscProperty, saveGa4Property } from "@/lib/integrations.functions";
import type { Database } from "@/integrations/supabase/types";

type Site = Database["public"]["Tables"]["sites"]["Row"];
type Connection = Database["public"]["Tables"]["integration_connections"]["Row"];
type Job = Database["public"]["Tables"]["background_jobs"]["Row"];

const formSchema = z.object({
  url: z.string().trim().url().max(500),
  username: z.string().trim().min(1).max(120),
  appPassword: z.string().trim().min(8, "App password must be at least 8 chars").max(200),
});

export const Route = createFileRoute("/_authenticated/integrations")({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  const verify = useServerFn(verifyWordpressConnection);
  const sync = useServerFn(syncWordpressContent);

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

  const connectionsQ = useQuery({
    queryKey: ["wp-connections", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Connection[]> => {
      const { data, error } = await supabase
        .from("integration_connections")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("provider", "wordpress");
      if (error) throw error;
      return data ?? [];
    },
  });

  const jobsQ = useQuery({
    queryKey: ["wp-sync-jobs", orgId],
    enabled: !!orgId,
    refetchInterval: 4000,
    queryFn: async (): Promise<Job[]> => {
      const { data, error } = await supabase
        .from("background_jobs")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("job_type", "wordpress.sync")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const latestJobBySite = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobsQ.data ?? []) {
      if (!j.site_id) continue;
      if (!m.has(j.site_id)) m.set(j.site_id, j);
    }
    return m;
  }, [jobsQ.data]);

  const [siteId, setSiteId] = useState<string>("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const sites = sitesQ.data ?? [];
  const connections = connectionsQ.data ?? [];
  const connBySite = useMemo(() => {
    const m = new Map<string, Connection>();
    for (const c of connections) if (c.site_id) m.set(c.site_id, c);
    return m;
  }, [connections]);

  if (!currentOrg) {
    return (
      <EmptyState
        icon={Plug}
        title="No workspace selected"
        description="Create or join a workspace to manage integrations."
        action={
          <Button asChild>
            <Link to="/onboarding">Start onboarding</Link>
          </Button>
        }
      />
    );
  }

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !siteId) {
      toast.error("Pick a site");
      return;
    }
    const parsed = formSchema.safeParse({ url, username, appPassword });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    try {
      const res = await verify({ data: { organizationId: orgId, siteId, ...parsed.data } });
      if (res.ok) {
        toast.success("WordPress connected");
        setUrl("");
        setUsername("");
        setAppPassword("");
      } else {
        toast.error(`Verification failed: ${res.detail ?? "unknown error"}`);
      }
      qc.invalidateQueries({ queryKey: ["wp-connections", orgId] });
      qc.invalidateQueries({ queryKey: ["sites", orgId] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async (sId: string) => {
    if (!orgId) return;
    const t = toast.loading("Syncing WordPress…");
    try {
      const res = await sync({ data: { organizationId: orgId, siteId: sId } });
      toast.success(`Synced ${res.synced} items`, { id: t });
      qc.invalidateQueries({ queryKey: ["wp-content", orgId] });
      qc.invalidateQueries({ queryKey: ["wp-sync-jobs", orgId] });
      qc.invalidateQueries({ queryKey: ["sites", orgId] });
    } catch (err) {
      toast.error((err as Error).message, { id: t });
    }
  };

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect your WordPress site using an Application Password. Credentials are stored server-side and never exposed to the browser."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-4 w-4" /> Connect WordPress
            </CardTitle>
            <CardDescription>
              In WordPress: Users → Profile → Application Passwords. Generate a password and paste
              it below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sites.length === 0 ? (
              <EmptyState
                icon={Globe}
                title="Add a site first"
                description="Create a site, then connect WordPress to it."
                action={
                  <Button asChild>
                    <Link to="/sites">Go to Sites</Link>
                  </Button>
                }
              />
            ) : (
              <form onSubmit={handleConnect} className="space-y-4">
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
                  <Label htmlFor="wp-url">WordPress URL</Label>
                  <Input
                    id="wp-url"
                    type="url"
                    required
                    placeholder="https://example.com"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wp-user">Username</Label>
                  <Input
                    id="wp-user"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wp-pass">Application Password</Label>
                  <Input
                    id="wp-pass"
                    required
                    type="password"
                    placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                    value={appPassword}
                    onChange={(e) => setAppPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={busy}>
                  {busy ? "Verifying…" : "Verify & connect"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connected sites</CardTitle>
            <CardDescription>Trigger a content sync to pull posts and pages.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {connectionsQ.isLoading ? (
              <div className="h-24 animate-pulse rounded-md bg-muted/30" />
            ) : sites.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sites yet.</p>
            ) : (
              sites.map((s) => {
                const c = connBySite.get(s.id);
                const job = latestJobBySite.get(s.id);
                const running = job?.status === "running";
                const pct =
                  job && job.total_items
                    ? Math.min(
                        100,
                        Math.round((job.items_processed / Math.max(1, job.total_items)) * 100),
                      )
                    : null;
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{s.name}</span>
                        <Badge
                          variant={
                            s.status === "connected"
                              ? "default"
                              : s.status === "sync_failed" || s.status === "error"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {s.status ?? "disconnected"}
                        </Badge>
                        {running && (
                          <Badge variant="outline">
                            syncing {job?.items_processed ?? 0}
                            {job?.total_items ? ` / ${job.total_items}` : ""}
                            {pct != null ? ` · ${pct}%` : ""}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {c?.last_synced_at
                          ? `Last synced ${new Date(c.last_synced_at).toLocaleString()}`
                          : "Never synced"}
                        {job?.error_message
                          ? ` · ${job.error_message}`
                          : c?.last_error
                            ? ` · ${c.last_error}`
                            : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!c || c.status !== "connected" || running}
                      onClick={() => handleSync(s.id)}
                    >
                      <RefreshCw className={`h-3 w-3 mr-1 ${running ? "animate-spin" : ""}`} />
                      {running ? "Syncing…" : "Sync now"}
                    </Button>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
