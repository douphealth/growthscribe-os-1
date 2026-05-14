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
import { FileText, Sparkles } from "lucide-react";
import { generateContentBrief } from "@/lib/brief.functions";

type Brief = Database["public"]["Tables"]["content_briefs"]["Row"];
type Site = Database["public"]["Tables"]["sites"]["Row"];

export const Route = createFileRoute("/_authenticated/briefs")({
  component: BriefsPage,
});

const schema = z.object({
  siteId: z.string().uuid("Pick a site"),
  title: z.string().trim().min(3).max(200),
  targetKeyword: z.string().trim().min(2).max(120).optional().or(z.literal("")),
});

function BriefsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  const generate = useServerFn(generateContentBrief);

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

  const briefsQ = useQuery({
    queryKey: ["briefs", orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<Brief[]> => {
      const { data, error } = await supabase
        .from("content_briefs")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [siteId, setSiteId] = useState("");
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);

  const sites = sitesQ.data ?? [];
  const briefs = briefsQ.data ?? [];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    const parsed = schema.safeParse({ siteId, title, targetKeyword: keyword });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const t = toast.loading("Generating brief with AI…");
    try {
      await generate({
        data: {
          organizationId: orgId,
          siteId: parsed.data.siteId,
          title: parsed.data.title,
          targetKeyword: parsed.data.targetKeyword || undefined,
        },
      });
      toast.success("Brief ready", { id: t });
      setTitle("");
      setKeyword("");
      qc.invalidateQueries({ queryKey: ["briefs", orgId] });
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
        icon={FileText}
        title="No workspace selected"
        description="Create a workspace to generate briefs."
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
        title="Content Briefs"
        description="AI-generated outlines, internal links, and AEO question targets."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Generate brief
            </CardTitle>
            <CardDescription>Uses your synced posts as internal-link context.</CardDescription>
          </CardHeader>
          <CardContent>
            {sites.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="Add a site first"
                description="Briefs attach to a site."
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
                  <Label htmlFor="title">Working title</Label>
                  <Input
                    id="title"
                    required
                    placeholder="The complete guide to ..."
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kw">Target keyword (optional)</Label>
                  <Input
                    id="kw"
                    placeholder="content audits"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Generating…" : "Generate brief"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-3">
          {briefsQ.isLoading ? (
            [1, 2].map((i) => <div key={i} className="h-32 rounded-md bg-muted/30 animate-pulse" />)
          ) : briefs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No briefs yet"
              description="Generate one on the left."
            />
          ) : (
            briefs.map((b) => {
              const outline = Array.isArray(b.outline) ? (b.outline as Json[]) : [];
              const questions = Array.isArray(b.aeo_questions) ? (b.aeo_questions as string[]) : [];
              return (
                <Card key={b.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{b.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {b.target_keyword ?? "no keyword"} · {b.word_count_target ?? "?"} words
                        </p>
                      </div>
                      {b.search_intent && <Badge variant="outline">{b.search_intent}</Badge>}
                    </div>
                    {outline.length > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-muted-foreground">
                          {outline.length} sections
                        </summary>
                        <ol className="list-decimal pl-5 mt-2 space-y-1">
                          {outline.map((h, i) => {
                            const o = h as { heading?: string; level?: number; notes?: string };
                            return (
                              <li key={i}>
                                <strong>{o.heading}</strong>
                                {o.notes && (
                                  <span className="text-muted-foreground"> — {o.notes}</span>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      </details>
                    )}
                    {questions.length > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-muted-foreground">
                          {questions.length} AEO questions
                        </summary>
                        <ul className="list-disc pl-5 mt-2 space-y-1">
                          {questions.map((q, i) => (
                            <li key={i}>{q}</li>
                          ))}
                        </ul>
                      </details>
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
