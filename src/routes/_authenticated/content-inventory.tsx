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
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Library,
  ExternalLink,
  RefreshCw,
  MoreHorizontal,
  FileSearch,
  FileText,
  ListTodo,
  Download,
  ChevronDown,
} from "lucide-react";
import { syncWordpressContent } from "@/lib/wordpress.functions";
import { runContentAudit, generateContentBrief } from "@/lib/growth.functions";
import type { Database } from "@/integrations/supabase/types";

type Site = Database["public"]["Tables"]["sites"]["Row"];
type Post = Database["public"]["Tables"]["wordpress_posts"]["Row"];

const STALE_DAYS = 180;
const SCORE_RANGES: Record<string, [number, number]> = {
  all: [0, 100],
  "0-40": [0, 40],
  "40-60": [40, 60],
  "60-80": [60, 80],
  "80-100": [80, 100],
};

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
  const [postType, setPostType] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [scoreRange, setScoreRange] = useState<string>("all");
  const [staleOnly, setStaleOnly] = useState(false);
  const [missingActionOnly, setMissingActionOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const sitesQ = useQuery({
    queryKey: ["sites", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Site[]> => {
      const { data, error } = await supabase
        .from("sites")
        .select("*")
        .eq("organization_id", orgId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const postsQ = useQuery({
    queryKey: ["wp-content", orgId, siteId],
    enabled: !!orgId,
    queryFn: async (): Promise<Post[]> => {
      let q = supabase
        .from("wordpress_posts")
        .select("*")
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
    const s = search.trim().toLowerCase();
    const [minScore, maxScore] = SCORE_RANGES[scoreRange] ?? SCORE_RANGES.all;
    const cutoff = Date.now() - STALE_DAYS * 86_400_000;
    return list.filter((p) => {
      if (postType !== "all" && p.post_type !== postType) return false;
      if (statusFilter !== "all" && (p.status ?? "") !== statusFilter) return false;
      if (missingActionOnly && p.recommended_action) return false;
      if (staleOnly) {
        const t = p.modified_at ? new Date(p.modified_at).getTime() : 0;
        if (t >= cutoff) return false;
      }
      if (scoreRange !== "all") {
        const score = p.seo_score ?? p.aeo_score ?? p.geo_score ?? p.freshness_score ?? null;
        if (score == null || score < minScore || score > maxScore) return false;
      }
      if (s) {
        const hay = `${p.title ?? ""} ${p.url ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [postsQ.data, search, postType, statusFilter, scoreRange, staleOnly, missingActionOnly]);

  const postTypes = useMemo(
    () => Array.from(new Set((postsQ.data ?? []).map((p) => p.post_type))).sort(),
    [postsQ.data],
  );
  const statuses = useMemo(
    () =>
      Array.from(new Set((postsQ.data ?? []).map((p) => p.status).filter(Boolean) as string[])).sort(),
    [postsQ.data],
  );

  const allSelected = posts.length > 0 && posts.every((p) => selected.has(p.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(posts.map((p) => p.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const selectedPosts = useMemo(
    () => posts.filter((p) => selected.has(p.id)),
    [posts, selected],
  );

  if (!currentOrg) {
    return (
      <EmptyState
        icon={Library}
        title="No workspace selected"
        description="Create or join a workspace to view content."
        action={
          <Button asChild>
            <Link to="/onboarding">Start onboarding</Link>
          </Button>
        }
      />
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
            sync({ data: { organizationId: orgId, siteId: s.id } }).catch((e) => ({
              error: (e as Error).message,
            })),
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
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleBrief = async (p: Post) => {
    if (!orgId || !p.title) return;
    try {
      await genBrief({ data: { organizationId: orgId, siteId: p.site_id, title: p.title } });
      toast.success("Brief queued");
      navigate({ to: "/briefs" });
    } catch (e) {
      toast.error((e as Error).message);
    }
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
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Task created");
    navigate({ to: "/tasks" });
  };

  const bulkAudit = async () => {
    if (!orgId || selectedPosts.length === 0) return;
    setBulkBusy(true);
    const t = toast.loading(`Queuing ${selectedPosts.length} audits…`);
    let ok = 0;
    for (const p of selectedPosts) {
      try {
        await runAudit({ data: { organizationId: orgId, siteId: p.site_id, url: p.url } });
        ok += 1;
      } catch {
        /* continue */
      }
    }
    toast.success(`Queued ${ok}/${selectedPosts.length} audits`, { id: t });
    setBulkBusy(false);
  };

  const bulkBrief = async () => {
    if (!orgId || selectedPosts.length === 0) return;
    setBulkBusy(true);
    const t = toast.loading(`Generating ${selectedPosts.length} briefs…`);
    let ok = 0;
    for (const p of selectedPosts) {
      if (!p.title) continue;
      try {
        await genBrief({ data: { organizationId: orgId, siteId: p.site_id, title: p.title } });
        ok += 1;
      } catch {
        /* continue */
      }
    }
    toast.success(`Created ${ok} briefs`, { id: t });
    setBulkBusy(false);
  };

  const bulkTask = async () => {
    if (!orgId || !user || selectedPosts.length === 0) return;
    setBulkBusy(true);
    const rows = selectedPosts.map((p) => ({
      organization_id: orgId,
      site_id: p.site_id,
      owner_id: user.id,
      title: `Action on: ${p.title ?? p.url}`,
      description: p.recommended_action ?? "Review content",
    }));
    const { error } = await supabase.from("tasks").insert(rows);
    if (error) toast.error(error.message);
    else toast.success(`Created ${rows.length} tasks`);
    setBulkBusy(false);
  };

  const exportCsv = () => {
    const rows = (selectedPosts.length ? selectedPosts : posts).map((p) => ({
      title: p.title ?? "",
      url: p.url,
      post_type: p.post_type,
      status: p.status ?? "",
      modified_at: p.modified_at ?? "",
      word_count: p.word_count ?? "",
      seo_score: p.seo_score ?? "",
      aeo_score: p.aeo_score ?? "",
      geo_score: p.geo_score ?? "",
      freshness_score: p.freshness_score ?? "",
      recommended_action: p.recommended_action ?? "",
    }));
    if (rows.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => escape((r as Record<string, unknown>)[h])).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `content-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

      <div className="flex flex-wrap gap-2 mb-4">
        <Select value={siteId} onValueChange={setSiteId}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Site" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sites</SelectItem>
            {sites.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={postType} onValueChange={setPostType}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {postTypes.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {statuses.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={scoreRange} onValueChange={setScoreRange}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Score" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any score</SelectItem>
            <SelectItem value="0-40">0–40</SelectItem>
            <SelectItem value="40-60">40–60</SelectItem>
            <SelectItem value="60-80">60–80</SelectItem>
            <SelectItem value="80-100">80–100</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm px-3 rounded-md border">
          <Checkbox checked={staleOnly} onCheckedChange={(v) => setStaleOnly(!!v)} />
          Stale (&gt;{STALE_DAYS}d)
        </label>
        <label className="flex items-center gap-2 text-sm px-3 rounded-md border">
          <Checkbox checked={missingActionOnly} onCheckedChange={(v) => setMissingActionOnly(!!v)} />
          Missing action
        </label>
        <Input
          placeholder="Search title or URL…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px]"
        />
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md border bg-muted/30">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={bulkBusy}>
                Bulk actions <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Apply to {selected.size} item(s)</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={bulkAudit}><FileSearch className="h-4 w-4 mr-2" /> Run audits</DropdownMenuItem>
              <DropdownMenuItem onClick={bulkBrief}><FileText className="h-4 w-4 mr-2" /> Generate briefs</DropdownMenuItem>
              <DropdownMenuItem onClick={bulkTask}><ListTodo className="h-4 w-4 mr-2" /> Create tasks</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={exportCsv}><Download className="h-4 w-4 mr-2" /> Export CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          <div className="ml-auto">
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="h-3 w-3 mr-1" /> Export CSV
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {postsQ.isLoading ? (
            <div className="p-6 space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : postsQ.isError ? (
            <div className="p-10">
              <EmptyState
                icon={Library}
                title="Couldn't load content"
                description={(postsQ.error as Error)?.message ?? "Unknown error"}
                action={<Button onClick={() => postsQ.refetch()}>Retry</Button>}
              />
            </div>
          ) : posts.length === 0 ? (
            <div className="p-10">
              <EmptyState
                icon={Library}
                title="No content yet"
                description="Connect WordPress and run a sync to populate your inventory."
                action={
                  <Button asChild>
                    <Link to="/integrations">Connect WordPress</Link>
                  </Button>
                }
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                  </TableHead>
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
                    <TableCell>
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={() => toggleOne(p.id)}
                        aria-label="Select row"
                      />
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <div className="font-medium truncate">{p.title ?? "(untitled)"}</div>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 truncate max-w-full"
                      >
                        {p.url} <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline">{p.post_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === "publish" ? "default" : "secondary"}>
                        {p.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {p.modified_at ? new Date(p.modified_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-right text-sm">
                      {p.word_count ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <ScoreCell value={p.seo_score} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ScoreCell value={p.aeo_score} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ScoreCell value={p.geo_score} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ScoreCell value={p.freshness_score} />
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-xs text-muted-foreground max-w-[180px] truncate">
                      {p.recommended_action ?? "—"}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
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
