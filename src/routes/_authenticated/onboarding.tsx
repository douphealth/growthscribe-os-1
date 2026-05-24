import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useOrg } from "@/lib/org-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Check, Building2, Globe, Rocket } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
});

const orgSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "lowercase, numbers, dashes"),
});

const siteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  url: z.string().trim().url(),
});

const STEPS = [
  { id: 1, title: "Workspace", icon: Building2, description: "Name your workspace" },
  { id: 2, title: "Connect a site", icon: Globe, description: "Add your first WordPress site" },
  { id: 3, title: "Launch", icon: Rocket, description: "Open your dashboard" },
] as const;

function OnboardingPage() {
  const { user } = useAuth();
  const { refresh, setCurrentOrgId, currentOrg } = useOrg();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(currentOrg ? 2 : 1);
  const [orgId, setOrgId] = useState<string | null>(currentOrg?.id ?? null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("https://");
  const [submitting, setSubmitting] = useState(false);

  const onSubmitOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = orgSchema.safeParse({ name, slug });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    const { data: org, error } = await supabase
      .from("organizations")
      .insert({ name: parsed.data.name, slug: parsed.data.slug, created_by: user.id })
      .select()
      .single();
    if (error || !org) {
      toast.error(error?.message ?? "Could not create workspace");
      setSubmitting(false);
      return;
    }
    const { error: mErr } = await supabase
      .from("organization_members")
      .insert({ organization_id: org.id, user_id: user.id, role: "owner" });
    if (mErr) {
      toast.error(mErr.message);
      setSubmitting(false);
      return;
    }
    await refresh();
    setCurrentOrgId(org.id);
    setOrgId(org.id);
    toast.success("Workspace created");
    setStep(2);
    setSubmitting(false);
  };

  const onSubmitSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !orgId) return;
    const parsed = siteSchema.safeParse({ name: siteName, url: siteUrl });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("sites").insert({
      organization_id: orgId,
      owner_id: user.id,
      name: parsed.data.name,
      url: parsed.data.url,
    });
    if (error) {
      toast.error(error.message);
      setSubmitting(false);
      return;
    }
    toast.success("Site added");
    setStep(3);
    setSubmitting(false);
  };

  const skipSite = () => setStep(3);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Stepper current={step} />
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Create your workspace</CardTitle>
            <CardDescription>
              A workspace groups your sites, integrations, audits and team members.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmitOrg} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Workspace name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slug) {
                      setSlug(
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, "")
                          .slice(0, 60),
                      );
                    }
                  }}
                  placeholder="Acme Media"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">URL slug</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="acme-media"
                  required
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Creating…" : "Continue"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Connect your first site</CardTitle>
            <CardDescription>
              Add a WordPress site to scan, score, and optimize. You can connect more later.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmitSite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="siteName">Site name</Label>
                <Input
                  id="siteName"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="Acme Blog"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="siteUrl">Site URL</Label>
                <Input
                  id="siteUrl"
                  type="url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="https://example.com"
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={skipSite} className="flex-1">
                  Skip for now
                </Button>
                <Button type="submit" disabled={submitting} className="flex-1">
                  {submitting ? "Adding…" : "Add site"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>You're ready to roll</CardTitle>
            <CardDescription>
              Open the dashboard to run your first audit, connect Search Console, and review recommendations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-emerald-600" /> Connect Search Console under Integrations for live SERP data</li>
              <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-emerald-600" /> Run a content audit from the Audits tab to populate recommendations</li>
              <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-emerald-600" /> Approve safe edits one-by-one — every change is rollback-safe</li>
            </ul>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => navigate({ to: "/integrations" })} variant="outline" className="flex-1">
                Connect integrations
              </Button>
              <Button onClick={() => navigate({ to: "/dashboard" })} className="flex-1">
                Open dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = current > s.id;
        const active = current === s.id;
        return (
          <div key={s.id} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition ${
                done
                  ? "border-emerald-600 bg-emerald-600 text-primary-foreground"
                  : active
                  ? "border-primary bg-primary text-primary-foreground shadow-[var(--shadow-glow)]"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </div>
            <div className="hidden flex-col sm:flex">
              <span className={`text-xs font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}>{s.title}</span>
              <span className="text-[10px] text-muted-foreground">{s.description}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px flex-1 ${done ? "bg-emerald-600" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
  };

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Create a workspace</CardTitle>
          <CardDescription>
            A workspace groups your sites, integrations, audits and team members.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Workspace name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Media"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">URL slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="acme-media"
                required
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Creating…" : "Create workspace"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
