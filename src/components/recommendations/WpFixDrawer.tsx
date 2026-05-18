import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Wand2, Check, ExternalLink, Loader2 } from "lucide-react";
import { previewWordpressFix, applyWordpressFix } from "@/lib/wordpress.functions";

type DiffLine = { kind: "ctx" | "add" | "del"; text: string };

type Preview = Awaited<ReturnType<typeof previewWordpressFix>>;

export function WpFixDrawer({
  open,
  onOpenChange,
  organizationId,
  siteId,
  recommendationId,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizationId: string;
  siteId: string;
  recommendationId: string | null;
  onApplied?: () => void;
}) {
  const preview = useServerFn(previewWordpressFix);
  const apply = useServerFn(applyWordpressFix);
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open || !recommendationId) return;
    setData(null);
    setLoading(true);
    preview({ data: { organizationId, siteId, recommendationId } })
      .then((d) => setData(d as Preview))
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, recommendationId, organizationId, siteId, preview]);

  const handleApply = async () => {
    if (!data?.wpPostId) {
      toast.error("No WordPress post bound to this recommendation");
      return;
    }
    setApplying(true);
    const t = toast.loading("Publishing fix to WordPress…");
    try {
      const res = await apply({
        data: {
          organizationId,
          siteId,
          recommendationId: data.recommendationId,
          wpPostId: data.wpPostId,
          content: data.after,
          title: data.afterTitle ?? undefined,
        },
      });
      toast.success("Fix applied to WordPress", { id: t });
      onApplied?.();
      onOpenChange(false);
      if (res.link) window.open(res.link, "_blank");
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[1100px] sm:w-[95vw] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" /> WordPress fix preview
          </SheetTitle>
          <SheetDescription>
            Side-by-side diff of the AI-proposed rewrite. Nothing changes on your site until you click Apply.
          </SheetDescription>
        </SheetHeader>

        {loading || !data ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-[400px]" />
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-md border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Badge variant="default" className="gap-1">
                  <Sparkles className="h-3 w-3" /> AI summary
                </Badge>
                <Badge variant="outline">+{data.stats.add} added</Badge>
                <Badge variant="outline">-{data.stats.del} removed</Badge>
                {data.url && (
                  <a
                    href={data.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" /> Live URL
                  </a>
                )}
              </div>
              <p className="font-medium">{data.summary}</p>
              <p className="text-sm text-muted-foreground mt-1">{data.rationale}</p>
              {data.changedSections.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {data.changedSections.map((s) => (
                    <Badge key={s} variant="secondary" className="text-xs">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {data.beforeTitle !== data.afterTitle && (
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md border bg-rose-500/5 p-3">
                  <div className="text-xs text-muted-foreground mb-1">Current title</div>
                  <div className="font-medium">{data.beforeTitle ?? "—"}</div>
                </div>
                <div className="rounded-md border bg-emerald-500/5 p-3">
                  <div className="text-xs text-muted-foreground mb-1">New title</div>
                  <div className="font-medium">{data.afterTitle ?? "—"}</div>
                </div>
              </div>
            )}

            <div className="mt-4 rounded-md border overflow-hidden">
              <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                Diff ({data.diff.length} lines)
              </div>
              <pre className="max-h-[55vh] overflow-auto bg-card text-xs leading-relaxed">
                {(data.diff as DiffLine[]).map((d, i) => (
                  <div
                    key={i}
                    className={
                      d.kind === "add"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3"
                        : d.kind === "del"
                          ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 px-3 line-through"
                          : "px-3 text-muted-foreground"
                    }
                  >
                    <span className="select-none mr-2 opacity-60">
                      {d.kind === "add" ? "+" : d.kind === "del" ? "−" : " "}
                    </span>
                    {d.text || "\u00a0"}
                  </div>
                ))}
              </pre>
            </div>

            <div className="sticky bottom-0 mt-6 -mx-6 -mb-6 border-t bg-background/95 backdrop-blur px-6 py-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applying}>
                Cancel
              </Button>
              <Button onClick={handleApply} disabled={applying || !data.wpPostId}>
                {applying ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Apply to WordPress
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}