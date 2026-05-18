import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useOrg } from "@/lib/org-context";
import type { Database } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/dashboard/PageHeader";
import {
  Globe,
  FileSearch,
  ListTodo,
  TrendingUp,
  ArrowRight,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { getSiteHealthScores } from "@/lib/technical.functions";
import { PrioritizedActionQueue } from "@/components/dashboard/PrioritizedActionQueue";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="group relative overflow-hidden border-border/60 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-elegant)] hover:-translate-y-0.5 transition-all">
      <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight font-display">{value}</p>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>
          <div className="rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 p-2.5 text-primary ring-1 ring-primary/10 group-hover:ring-primary/30 transition">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const { profile, user } = useAuth();
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats", orgId, user?.id],
    enabled: !!user && !!orgId,
    queryFn: async () => {
      const [sites, audits, tasks, briefs] = await Promise.all([
        supabase
          .from("sites")
          .select("id, monthly_clicks", { count: "exact" })
          .eq("organization_id", orgId!),
        supabase
          .from("content_audits")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId!),
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId!)
          .neq("status", "published")
          .neq("status", "archived"),
        supabase
          .from("content_briefs")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId!),
      ]);
      const totalClicks = (sites.data ?? []).reduce((s, r) => s + (r.monthly_clicks ?? 0), 0);
      return {
        sites: sites.count ?? 0,
        audits: audits.count ?? 0,
        openTasks: tasks.count ?? 0,
        briefs: briefs.count ?? 0,
        totalClicks,
      };
    },
  });

  type Activity = Database["public"]["Tables"]["activities"]["Row"];
  const { data: activities } = useQuery({
    queryKey: ["activities", orgId, user?.id],
    enabled: !!user && !!orgId,
    queryFn: async (): Promise<Activity[]> => {
      const { data } = await supabase
        .from("activities")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(8);
      return data ?? [];
    },
  });

  const fetchHealth = useServerFn(getSiteHealthScores);
  const { data: health } = useQuery({
    queryKey: ["site-health", orgId],
    enabled: !!orgId,
    queryFn: () => fetchHealth({ data: { organizationId: orgId! } }),
  });

  const firstName = (profile?.display_name ?? "").split(" ")[0] || "there";

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Your organic growth command center. Snapshot of sites, audits, and editorial workflow."
        actions={
          <Button asChild>
            <Link to="/sites">
              Add a site <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Globe} label="Connected sites" value={stats?.sites ?? "—"} />
        <StatCard icon={FileSearch} label="Content audits" value={stats?.audits ?? "—"} />
        <StatCard icon={ListTodo} label="Open tasks" value={stats?.openTasks ?? "—"} />
        <StatCard
          icon={TrendingUp}
          label="Monthly clicks"
          value={stats?.totalClicks?.toLocaleString() ?? "—"}
          hint="Across connected sites"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-8">
        <div className="lg:col-span-2">
          <PrioritizedActionQueue orgId={orgId} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Site health (Technical / AEO / GEO)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {health?.sites?.length ? (
              <ul className="space-y-4">
                {health.sites.map((s) => (
                  <li key={s.siteId} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium truncate">{s.name}</span>
                      <span className="text-muted-foreground tabular-nums">{s.overall}/100</span>
                    </div>
                    <Progress value={s.overall} />
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                      <span>Technical · {s.technical}</span>
                      <span>AEO · {s.aeo}</span>
                      <span>GEO · {s.geo}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Add a site and run a technical scan to see health scores.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Get started</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              {
                t: "Connect your first WordPress site",
                to: "/sites",
                done: (stats?.sites ?? 0) > 0,
              },
              { t: "Link Google Search Console & GA4", to: "/integrations", done: false },
              {
                t: "Run your first AI content audit",
                to: "/audits",
                done: (stats?.audits ?? 0) > 0,
              },
              { t: "Generate a topical map", to: "/topical-maps", done: false },
              {
                t: "Create your first content brief",
                to: "/briefs",
                done: (stats?.briefs ?? 0) > 0,
              },
            ].map((step) => (
              <Link
                key={step.t}
                to={step.to}
                className="flex items-center justify-between rounded-lg border border-border p-3 hover:border-primary/50 transition"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-5 w-5 rounded-full border ${step.done ? "bg-primary border-primary" : "border-border"}`}
                  />
                  <span
                    className={`text-sm ${step.done ? "line-through text-muted-foreground" : ""}`}
                  >
                    {step.t}
                  </span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activities && activities.length > 0 ? (
              <ul className="space-y-3">
                {activities.map((a) => (
                  <li key={a.id} className="text-sm">
                    <p className="font-medium">{a.title}</p>
                    {a.description && (
                      <p className="text-xs text-muted-foreground">{a.description}</p>
                    )}
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                      {new Date(a.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No activity yet. Once you connect sites and run audits, events will appear here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
