import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import type { Database } from "@/integrations/supabase/types";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Gauge, Wand2, ShieldCheck, CheckCircle2, Link2, Image as ImageIcon, Globe, Search, Zap } from "lucide-react";
import { ActiveJobsBanner } from "@/components/jobs/ActiveJobsBanner";
import {
  runTechnicalScan,
  previewWordpressFix,
  requestWordpressFix,
  submitIndexNow,
  bulkApplyWordpressFixes,
  type FixPreview,
} from "@/lib/technical.functions";
import { enqueueJob } from "@/lib/jobs.functions";
import {
  discoverInternalLinks,
  scanImageAlts,
  bulkApplyImageAlts,
  applyInternalLink,
} from "@/lib/seo-automation.functions";

type Site = Database["public"]["Tables"]["sites"]["Row"];
type Rec = Database["public"]["Tables"]["content_recommendations"]["Row"];
type LinkOpp = Database["public"]["Tables"]["internal_link_opportunities"]["Row"] & {
  source?: { title: string | null; url: string } | null;
  target?: { title: string | null; url: string } | null;
};

export const Route = createFileRoute("/_authenticated/technical")({
  component: TechnicalPage,
});

const SCAN_CATEGORIES = [
  "title",
  "meta-description",
  "headings",
  "canonical",
  "social",
  "schema",
  "accessibility",
  "thin-content",
  "internal-links",
  "core-web-vitals",
  "image-alt",
];

function severityVariant(s: string): "default" | "destructive" | "secondary" | "outline" {
  if (s === "high") return "destructive";
  if (s === "medium") return "default";
  return "secondary";
}

function TechnicalPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  const scan = useServerFn(runTechnicalScan);
  const preview = useServerFn(previewWordpressFix);
  const requestFix = useServerFn(requestWordpressFix);
  const indexNow = useServerFn(submitIndexNow);
  const bulkApply = useServerFn(bulkApplyWordpressFixes);
  const discoverLinks = useServerFn(discoverInternalLinks);
  const scanAlts = useServerFn(scanImageAlts);
  const bulkAlts = useServerFn(bulkApplyImageAlts);
  const applyLink = useServerFn(applyInternalLink);
  const enqueue = useServerFn(enqueueJob);

  const [siteId, setSiteId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState<FixPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

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

  const recsQ = useQuery({
    queryKey: ["technical-recs", orgId, siteId],
    enabled: !!orgId && !!siteId,
    queryFn: async (): Promise<Rec[]> => {
      const { data, error } = await supabase
        .from("content_recommendations")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("site_id", siteId)
        .eq("status", "open")
        .in("category", SCAN_CATEGORIES)
        .order("severity", { ascending: true })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const linksQ = useQuery({
    queryKey: ["internal-link-opps", orgId, siteId],
    enabled: !!orgId && !!siteId,
    queryFn: async (): Promise<LinkOpp[]> => {
      const { data: opps, error } = await supabase
        .from("internal_link_opportunities")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("site_id", siteId)
        .eq("status", "suggested")
        .order("relevance_score", { ascending: false })
        .limit(50);
      if (error) throw error;
      const postIds = Array.from(
        new Set((opps ?? []).flatMap((o) => [o.source_post_id, o.target_post_id]).filter(Boolean)),
      ) as string[];
      if (postIds.length === 0) return (opps ?? []) as LinkOpp[];
      const { data: posts, error: postsError } = await supabase
        .from("wordpress_posts")
        .select("id,title,url")
        .in("id", postIds);
      if (postsError) throw postsError;
      const byId = new Map((posts ?? []).map((p) => [p.id, { title: p.title, url: p.url }]));
      return (opps ?? []).map((o) => ({
        ...o,
        source: o.source_post_id ? (byId.get(o.source_post_id) ?? null) : null,
        target: o.target_post_id ? (byId.get(o.target_post_id) ?? null) : null,
      })) as LinkOpp[];
    },
  });

  if (!currentOrg) {
    return (
      <EmptyState
        icon={Gauge}
        title="No workspace selected"
        description="Create a workspace to run technical scans."
        action={
          <Button asChild>
            <Link to="/onboarding">Start onboarding</Link>
          </Button>
        }
      />
    );
  }

  const sites = sitesQ.data ?? [];
  const recs = recsQ.data ?? [];
  const groups = recs.reduce<Record<string, Rec[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

  const onScan = async () => {
    if (!orgId || !siteId) {
      toast.error("Pick a site first");
      return;
    }
    setBusy(true);
    const t = toast.loading("Running technical scan…");
    try {
      const res = await scan({ data: { organizationId: orgId, siteId, limit: 20 } });
      toast.success(
        res.scanned === 0
          ? (res.message ?? "Nothing to scan")
          : `Scanned ${res.scanned} pages · ${res.findings} findings`,
        { id: t },
      );
      qc.invalidateQueries({ queryKey: ["technical-recs", orgId, siteId] });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  };

  const onPreview = async (rec: Rec) => {
    setPreviewBusy(true);
    try {
      const p = await preview({
        data: { organizationId: orgId!, siteId, recommendationId: rec.id },
      });
      setPreviewing(p);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  };

  const onRequest = async () => {
    if (!previewing) return;
    const t = toast.loading("Sending to approvals queue…");
    try {
      await requestFix({
        data: {
          organizationId: orgId!,
          siteId,
          recommendationId: previewing.recommendationId,
        },
      });
      toast.success("Submitted for review — open Approvals to apply", { id: t });
      setPreviewing(null);
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    }
  };

  const onDiscoverLinks = async () => {
    if (!orgId || !siteId) return;
    const t = toast.loading("Discovering internal link opportunities…");
    try {
      const res = await discoverLinks({ data: { organizationId: orgId, siteId, limit: 20 } });
      toast.success(`Suggested ${res.suggested} links across ${res.scanned} posts`, { id: t });
      qc.invalidateQueries({ queryKey: ["internal-link-opps", orgId, siteId] });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    }
  };

  const onApplyLink = async (opportunityId: string) => {
    if (!orgId || !siteId) return;
    const t = toast.loading("Inserting internal link in WordPress…");
    try {
      await applyLink({ data: { organizationId: orgId, siteId, opportunityId } });
      toast.success("Link inserted", { id: t });
      qc.invalidateQueries({ queryKey: ["internal-link-opps", orgId, siteId] });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    }
  };

  const onScanAlts = async () => {
    if (!orgId || !siteId) return;
    const t = toast.loading("Scanning images for missing alt text…");
    try {
      const res = await scanAlts({ data: { organizationId: orgId, siteId, limit: 25 } });
      toast.success(`${res.missing} missing alts across ${res.findings} posts`, { id: t });
      qc.invalidateQueries({ queryKey: ["technical-recs", orgId, siteId] });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    }
  };

  const onBulkAlts = async () => {
    if (!orgId || !siteId) return;
    const t = toast.loading("Writing alt text and pushing to WordPress…");
    try {
      const res = await bulkAlts({ data: { organizationId: orgId, siteId, limit: 10 } });
      toast.success(
        `Wrote ${res.altsWritten} alts across ${res.applied} posts${res.failed ? ` · ${res.failed} failed` : ""}`,
        { id: t },
      );
      qc.invalidateQueries({ queryKey: ["technical-recs", orgId, siteId] });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    }
  };

  const onIndexNow = async () => {
    if (!orgId || !siteId) return;
    const { data: posts } = await supabase
      .from("wordpress_posts")
      .select("url")
      .eq("organization_id", orgId)
      .eq("site_id", siteId)
      .eq("status", "publish")
      .order("modified_at", { ascending: false, nullsFirst: false })
      .limit(50);
    const urls = (posts ?? []).map((p) => p.url).filter(Boolean) as string[];
    if (urls.length === 0) {
      toast.error("No URLs to submit. Sync WordPress first.");
      return;
    }
    const t = toast.loading(`Submitting ${urls.length} URLs to IndexNow…`);
    try {
      const res = await indexNow({ data: { organizationId: orgId, siteId, urls } });
      toast.success(`Submitted ${res.count} URLs to Bing/Yandex`, { id: t });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    }
  };

  const onBulkApply = async (category: "title" | "meta-description" | "schema") => {
    if (!orgId || !siteId) return;
    const t = toast.loading(`Bulk applying ${category} fixes…`);
    try {
      const res = await bulkApply({
        data: { organizationId: orgId, siteId, category, limit: 25 },
      });
      toast.success(`Applied ${res.applied}${res.failed ? ` · ${res.failed} failed` : ""}`, {
        id: t,
      });
      qc.invalidateQueries({ queryKey: ["technical-recs", orgId, siteId] });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    }
  };

  return (
    <>
      <PageHeader
        title="Technical SEO"
        description="On-page audit, Core Web Vitals via PageSpeed, and one-click fixes pushed to WordPress."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Run scan
          </CardTitle>
          <CardDescription>
            Audits up to 20 published posts against title, meta, headings, schema, links,
            accessibility, and Core Web Vitals.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px]">
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
          <Button onClick={onScan} disabled={!siteId || busy}>
            {busy ? "Scanning…" : "Run technical scan"}
          </Button>
          <Button variant="outline" onClick={onIndexNow} disabled={!siteId}>
            Submit to IndexNow
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              if (!orgId || !siteId) return;
              await enqueue({ data: { organizationId: orgId, siteId, jobType: "crawl.site", payload: { limit: 100 }, priority: 5 } });
              toast.success("Site crawl queued — results will appear shortly");
              qc.invalidateQueries({ queryKey: ["technical-recs"] });
            }}
            disabled={!siteId}
          >
            <Globe className="mr-1 h-4 w-4" /> Crawl site
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              if (!orgId || !siteId) return;
              await enqueue({ data: { organizationId: orgId, siteId, jobType: "vitals.refresh", payload: { limit: 10 }, priority: 5 } });
              toast.success("Core Web Vitals refresh queued");
            }}
            disabled={!siteId}
          >
            <Zap className="mr-1 h-4 w-4" /> Refresh vitals
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              if (!orgId || !siteId) return;
              await enqueue({ data: { organizationId: orgId, siteId, jobType: "gsc_import", payload: { days: 7 }, priority: 5 } });
              toast.success("Search Console pull queued");
            }}
            disabled={!siteId}
          >
            <Search className="mr-1 h-4 w-4" /> Pull Search Console
          </Button>
        </CardContent>
      </Card>

      {siteId && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" /> SEO automation
            </CardTitle>
            <CardDescription>
              Internal-link discovery and image alt repair. Suggestions land in the Approvals queue
              or apply in bulk after a scan.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onDiscoverLinks}>
              <Link2 className="mr-1 h-3 w-3" /> Discover internal links
            </Button>
            <Button variant="outline" size="sm" onClick={onScanAlts}>
              <ImageIcon className="mr-1 h-3 w-3" /> Scan image alts
            </Button>
            <Button variant="secondary" size="sm" onClick={onBulkAlts}>
              <Wand2 className="mr-1 h-3 w-3" /> Bulk-fix missing alts
            </Button>
          </CardContent>
        </Card>
      )}

      {siteId && (
        <div className="mb-4">
          <ActiveJobsBanner
            organizationId={orgId}
            siteId={siteId}
            invalidateOnSuccess={[
              ["technical-recs", orgId, siteId],
              ["internal-link-opps", orgId, siteId],
            ]}
          />
        </div>
      )}

      {siteId && (linksQ.data?.length ?? 0) > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4" /> Internal link opportunities
              <span className="text-xs text-muted-foreground">({linksQ.data?.length})</span>
            </CardTitle>
            <CardDescription>
              Anchor inserts auto-detected from content overlap. Applies directly to WordPress.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {linksQ.data?.map((opp) => (
              <div
                key={opp.id}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {Math.round((opp.relevance_score ?? 0) * 100)}% match
                    </Badge>
                    <p className="font-medium truncate">
                      “{opp.anchor_suggestion}” → {opp.target?.title ?? opp.target?.url}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    From: {opp.source?.title ?? opp.source?.url}
                  </p>
                  {opp.context_snippet && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      …{opp.context_snippet}…
                    </p>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => onApplyLink(opp.id)}>
                  <Wand2 className="mr-1 h-3 w-3" /> Apply
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!siteId ? (
        <EmptyState
          icon={Gauge}
          title="Pick a site to begin"
          description="Choose one of your connected WordPress sites above."
        />
      ) : recs.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="No findings yet"
          description="Run a scan to surface technical issues across your top published pages."
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([cat, items]) => (
            <Card key={cat}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base capitalize">
                    {cat.replace(/-/g, " ")}{" "}
                    <span className="ml-2 text-xs text-muted-foreground">({items.length})</span>
                  </CardTitle>
                  {(cat === "title" || cat === "meta-description" || cat === "schema") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onBulkApply(cat as "title" | "meta-description" | "schema")}
                    >
                      <Wand2 className="mr-1 h-3 w-3" /> Apply all
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-start justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={severityVariant(r.severity)}>{r.severity}</Badge>
                        <p className="font-medium truncate">{r.title}</p>
                      </div>
                      {r.detail && <p className="text-sm text-muted-foreground">{r.detail}</p>}
                      {r.suggested_action && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Suggested: </span>
                          {r.suggested_action}
                        </p>
                      )}
                    </div>
                    {(r.category === "title" ||
                      r.category === "meta-description" ||
                      r.category === "schema") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={previewBusy}
                        onClick={() => onPreview(r)}
                      >
                        <Wand2 className="mr-1 h-3 w-3" /> Preview fix
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!previewing} onOpenChange={(o) => !o && setPreviewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="capitalize">
              {previewing?.category.replace(/-/g, " ")} fix preview
            </DialogTitle>
            <DialogDescription>
              Updates the <strong>{previewing?.field}</strong> on WP post #{previewing?.wpPostId}.
              Review before applying.
            </DialogDescription>
          </DialogHeader>
          {previewing && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-auto">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Before
                </p>
                <pre className="text-xs bg-muted/50 rounded-md p-3 whitespace-pre-wrap break-words">
                  {previewing.before || "(empty)"}
                </pre>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">After</p>
                <pre className="text-xs bg-primary/5 rounded-md p-3 whitespace-pre-wrap break-words">
                  {previewing.after}
                </pre>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreviewing(null)}>
              Cancel
            </Button>
            <Button asChild variant="ghost">
              <Link to="/approvals">Open Approvals</Link>
            </Button>
            <Button onClick={onRequest}>
              <CheckCircle2 className="mr-1 h-3 w-3" /> Request approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
