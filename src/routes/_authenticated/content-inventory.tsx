import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Library, ExternalLink, RefreshCw, MoreHorizontal, FileSearch, FileText, ListTodo,
} from "lucide-react";
import { syncWordpressContent } from "@/lib/wordpress.functions";
import { runContentAudit, generateContentBrief } from "@/lib/growth.functions";
import type { Database } from "@/integrations/supabase/types";

type Site = Database["public"]["Tables"]["sites"]["Row"];
type Post = Database["public"]["Tables"]["wordpress_posts"]["Row"];

export const Route = createFileRoute("/_authenticated/content-inventory")({
  component: ContentInventoryPage,
});

function ScoreCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const tone = value >= 80 ? "text-emerald-500" : value >= 60 ? "text-amber-500" : "text-rose-500";
  return <span className={`font-medium ${tone}`}>{value}</span>;
}

function ContentInventoryPage() {
  const { user } = useAuth();
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sync = useServerFn(syncWordpressContent);
  const runAudit = useServerFn(runContentAudit);
  const genBrief = useServerFn(generateContentBrief);

  const [siteId, setSiteId] = useState<string>("all");
  const [search, setSearch] = useState("");

  const sitesQ = useQuery({
    queryKey: ["sites", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Site[]> => {
      const { data, error } = await supabase
        .from("sites").select("*").eq("organization_id", orgId!).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const postsQ = useQuery({
    queryKey: ["wp-content", orgId, siteId],
    enabled: !!orgId,
    queryFn: async (): Promise<Post[]> => {
      let q = supabase.from("wordpress_posts").select("*")
        .eq("organization_id", orgId!)
        .order("modified_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (siteId !== "all") q = q.eq("site_id", siteId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const sites = sitesQ.data ?? [];
  const posts = useMemo(() => {
    const list = postsQ.data ?? [];
    if (!search.trim()) return list;
    const s = search.toLowerCase();
    return list.filter((p) =>
      (p.title ?? "").toLowerCase().includes(s) ||
      (p.url ?? "").toLowerCase().includes(s),
    );
  }, [postsQ.data, search]);

  if (!currentOrg) {
    return (
      <EmptyState icon={Library} title="No workspace selected"
        description="Create or join a workspace to view content."
        action={<Button asChild><Link to="/onboarding">Start onboarding</Link></Button>} />
    );
  }

  const handleSync = async () => {
    if (!orgId) return;
    if (siteId === "all") {
      const eligible = sites;
      if (eligible.length === 0) return;
      const t = toast.loading(`Syncing ${eligible.length} site(s)…`);
      try {
        const results = await Promise.all(
          eligible.map((s) =>
            sync({ data: { organizationId: orgId, siteId: s.id } }).catch((e) => ({ error: (e as Error).message })),
          ),
        );
        const ok = results.filter((r) => !("error" in r)).length;
        toast.success(`Synced ${ok}/${eligible.length} site(s)`, { id: t });
      } catch (e) {
        toast.error((e as Error).message, { id: t });
      }
    } else {
      const t = toast.loading("Syncing…");
      try {
        const r = await sync({ data: { organizationId: orgId, siteId } });
        toast.success(`Synced ${r.synced} items`, { id: t });
      } catch (e) {
        toast.error((e as Error).message, { id: t });
      }
    }
    qc.invalidateQueries({ queryKey: ["wp-content", orgId] });
  };

  const handleAudit = async (p: Post) => {
    if (!orgId) return;
    try {
      await runAudit({ data: { organizationId: orgId, siteId: p.site_id, url: p.url } });
      toast.success("Audit queued");
      navigate({ to: "/audits" });
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleBrief = async (p: Post) => {
    if (!orgId || !p.title) return;
    try {
      await genBrief({ data: { organizationId: orgId, siteId: p.site_id, title: p.title } });
      toast.success("Brief queued");
      navigate({ to: "/briefs" });
    } catch (e) { toast.error((e as Error).message); }
  };

  const handleTask = async (p: Post) => {
    if (!orgId || !user) return;
    const { error } = await supabase.from("tasks").insert({
      organization_id: orgId,
      site_id: p.site_id,
      owner_id: user.id,
      title: `Action on: ${p.title ?? p.url}`,
      description: p.recommended_action ?? "Review content",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Task created");
    navigate({ to: "/tasks" });
  };

  return (
    <>
      <PageHeader
        title="Content Inventory"
        description="All synced WordPress posts and pages with quality, freshness, and opportunity signals."
        actions={
          <Button onClick={handleSync} disabled={sites.length === 0}>
            <RefreshCw className="h-4 w-4 mr-2" /> Sync from WordPress
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Select value={siteId} onValueChange={setSiteId}>
          <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sites</SelectItem>
            {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Search title or URL…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-0">
          {postsQ.isLoading ? (
            <div className="p-6 space-y-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : postsQ.isError ? (
            <div className="p-10">
              <EmptyState icon={Library} title="Couldn't load content"
                description={(postsQ.error as Error)?.message ?? "Unknown error"}
                action={<Button onClick={() => postsQ.refetch()}>Retry</Button>} />
            </div>
          ) : posts.length === 0 ? (
            <div className="p-10">
              <EmptyState icon={Library} title="No content yet"
                description="Connect WordPress and run a sync to populate your inventory."
                action={<Button asChild><Link to="/integrations">Connect WordPress</Link></Button>} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Modified</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Words</TableHead>
                  <TableHead className="text-right">SEO</TableHead>
                  <TableHead className="text-right">AEO</TableHead>
                  <TableHead className="text-right">GEO</TableHead>
                  <TableHead className="text-right">Fresh</TableHead>
                  <TableHead className="hidden xl:table-cell">Recommended</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-[260px]">
                      <div className="font-medium truncate">{p.title ?? "(untitled)"}</div>
                      <a href={p.url} target="_blank" rel="noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 truncate max-w-full">
                        {p.url} <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline">{p.post_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === "publish" ? "default" : "secondary"}>{p.status ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {p.modified_at ? new Date(p.modified_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-right text-sm">
                      {p.word_count ?? "—"}
                    </TableCell>
                    <TableCell className="text-right"><ScoreCell value={p.seo_score} /></TableCell>
                    <TableCell className="text-right"><ScoreCell value={p.aeo_score} /></TableCell>
                    <TableCell className="text-right"><ScoreCell value={p.geo_score} /></TableCell>
                    <TableCell className="text-right"><ScoreCell value={p.freshness_score} /></TableCell>
                    <TableCell className="hidden xl:table-cell text-xs text-muted-foreground max-w-[180px] truncate">
                      {p.recommended_action ?? "—"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <a href={p.url} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-4 w-4 mr-2" /> View
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleAudit(p)}>
                            <FileSearch className="h-4 w-4 mr-2" /> Run audit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleBrief(p)}>
                            <FileText className="h-4 w-4 mr-2" /> Generate brief
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleTask(p)}>
                            <ListTodo className="h-4 w-4 mr-2" /> Create task
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
