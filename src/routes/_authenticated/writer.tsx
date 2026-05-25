import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import type { Database } from "@/integrations/supabase/types";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { PenLine, Sparkles, Send, RefreshCw, Trash2, ExternalLink } from "lucide-react";
import {
  generateDraftFromBrief,
  regenerateDraft,
  saveDraft,
  publishDraftToWordpress,
  deleteDraft,
} from "@/lib/writer.functions";

type Draft = Database["public"]["Tables"]["content_drafts"]["Row"];
type Brief = Database["public"]["Tables"]["content_briefs"]["Row"];

export const Route = createFileRoute("/_authenticated/writer")({
  component: WriterPage,
});

const TONES = ["professional", "conversational", "authoritative", "playful", "technical"] as const;

function WriterPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();

  const generate = useServerFn(generateDraftFromBrief);
  const regen = useServerFn(regenerateDraft);
  const save = useServerFn(saveDraft);
  const publish = useServerFn(publishDraftToWordpress);
  const remove = useServerFn(deleteDraft);

  const briefsQ = useQuery({
    queryKey: ["writer-briefs", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Brief[]> => {
      const { data, error } = await supabase
        .from("content_briefs")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
  });

  const draftsQ = useQuery({
    queryKey: ["drafts", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Draft[]> => {
      const { data, error } = await supabase
        .from("content_drafts")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [briefId, setBriefId] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("professional");
  const [persona, setPersona] = useState("");
  const [busy, setBusy] = useState(false);

  const [editor, setEditor] = useState<Draft | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eMeta, setEMeta] = useState("");
  const [eContent, setEContent] = useState("");
  const [editInstructions, setEditInstructions] = useState("");

  const briefs = briefsQ.data ?? [];
  const drafts = draftsQ.data ?? [];

  const briefMap = useMemo(() => new Map(briefs.map((b) => [b.id, b])), [briefs]);

  function openEditor(d: Draft) {
    setEditor(d);
    setETitle(d.title);
    setEMeta(d.meta_description ?? "");
    setEContent(d.content_html);
    setEditInstructions("");
  }

  async function onGenerate() {
    if (!orgId || !briefId) return;
    setBusy(true);
    try {
      await generate({
        data: { organizationId: orgId, briefId, tone, persona: persona.trim() || undefined },
      });
      toast.success("Draft generated");
      setBriefId("");
      setPersona("");
      qc.invalidateQueries({ queryKey: ["drafts", orgId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRegen() {
    if (!orgId || !editor) return;
    setBusy(true);
    try {
      await regen({
        data: {
          organizationId: orgId,
          draftId: editor.id,
          tone,
          persona: persona.trim() || undefined,
          instructions: editInstructions.trim() || undefined,
        },
      });
      toast.success("Draft rewritten");
      qc.invalidateQueries({ queryKey: ["drafts", orgId] });
      setEditor(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (!orgId || !editor) return;
    setBusy(true);
    try {
      await save({
        data: {
          organizationId: orgId,
          draftId: editor.id,
          title: eTitle,
          meta_description: eMeta || undefined,
          content_html: eContent,
        },
      });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["drafts", orgId] });
      setEditor(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onPublish(d: Draft) {
    if (!orgId) return;
    setBusy(true);
    try {
      const r = (await publish({ data: { organizationId: orgId, draftId: d.id } })) as {
        link: string | null;
      };
      toast.success("Sent to WordPress as draft", {
        description: r.link ?? undefined,
      });
      qc.invalidateQueries({ queryKey: ["drafts", orgId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(d: Draft) {
    if (!orgId) return;
    if (!confirm(`Delete draft "${d.title}"?`)) return;
    try {
      await remove({ data: { organizationId: orgId, draftId: d.id } });
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["drafts", orgId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={PenLine}
        title="AI Content Writer"
        description="Turn approved briefs into ready-to-publish drafts. Edit, rewrite, and push to WordPress."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Generate a new draft
          </CardTitle>
          <CardDescription>
            Pick a brief, choose a tone, and produce a full first-draft article.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label className="text-xs">Brief</Label>
            <Select value={briefId} onValueChange={setBriefId}>
              <SelectTrigger>
                <SelectValue placeholder="Select brief" />
              </SelectTrigger>
              <SelectContent>
                {briefs.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tone</Label>
            <Select value={tone} onValueChange={(v) => setTone(v as (typeof TONES)[number])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TONES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Audience (optional)</Label>
            <Input
              placeholder="e.g. CTOs at Series B SaaS"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
            />
          </div>
          <div className="md:col-span-4">
            <Button onClick={onGenerate} disabled={!briefId || busy}>
              <Sparkles className="mr-2 h-4 w-4" />
              {busy ? "Generating…" : "Generate draft"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {drafts.length === 0 ? (
        <EmptyState
          icon={PenLine}
          title="No drafts yet"
          description="Generate your first draft from an approved brief."
        />
      ) : (
        <div className="grid gap-3">
          {drafts.map((d) => {
            const brief = d.brief_id ? briefMap.get(d.brief_id) : null;
            return (
              <Card key={d.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{d.title}</CardTitle>
                      <CardDescription className="text-xs">
                        {d.word_count} words · tone {d.tone}
                        {brief ? ` · from brief "${brief.title}"` : ""}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {d.status === "published" ? (
                        <Badge variant="default">Published</Badge>
                      ) : (
                        <Badge variant="secondary">Draft</Badge>
                      )}
                      {d.wp_link && (
                        <a
                          href={d.wp_link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary inline-flex items-center gap-1"
                        >
                          WP <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {d.meta_description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {d.meta_description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditor(d)}>
                      <PenLine className="mr-1 h-3 w-3" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTone(d.tone as (typeof TONES)[number]);
                        setPersona(d.persona ?? "");
                        openEditor(d);
                      }}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" /> Rewrite
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || d.status === "published"}
                      onClick={() => onPublish(d)}
                    >
                      <Send className="mr-1 h-3 w-3" /> Push to WordPress
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(d)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit draft</DialogTitle>
            <DialogDescription>
              Edit manually or describe a rewrite and let AI revise the article.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={eTitle} onChange={(e) => setETitle(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Meta description</Label>
              <Textarea
                rows={2}
                value={eMeta}
                onChange={(e) => setEMeta(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Content (HTML)</Label>
              <Textarea
                rows={14}
                className="font-mono text-xs"
                value={eContent}
                onChange={(e) => setEContent(e.target.value)}
              />
            </div>
            <div className="rounded-md border bg-muted/40 p-3 space-y-2">
              <Label className="text-xs">AI rewrite instructions (optional)</Label>
              <Textarea
                rows={2}
                placeholder="e.g. Tighten intro, add stats, more examples"
                value={editInstructions}
                onChange={(e) => setEditInstructions(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Select value={tone} onValueChange={(v) => setTone(v as (typeof TONES)[number])}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TONES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={busy} onClick={onRegen}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Rewrite with AI
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}