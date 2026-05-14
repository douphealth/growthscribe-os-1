import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Globe, Plus, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sites")({
  component: SitesPage,
});

function SitesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: sites, isLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("sites").insert({
      owner_id: user.id, name, url, status: "pending",
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Site added");
    setOpen(false); setName(""); setUrl("");
    qc.invalidateQueries({ queryKey: ["sites"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
  };

  return (
    <>
      <PageHeader
        title="Sites"
        description="WordPress properties under management. Connect WordPress, GSC, and GA4 from each site's settings."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> Add site</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add a WordPress site</DialogTitle></DialogHeader>
              <form onSubmit={handleAdd} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Display name</Label>
                  <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Blog" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="url">Site URL</Label>
                  <Input id="url" required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add site"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !sites || sites.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No sites yet"
          description="Add your first WordPress site to start running audits and tracking growth."
          action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> Add site</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sites.map((s: any) => (
            <Card key={s.id}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{s.name}</h3>
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 truncate max-w-full">
                      {s.url} <ExternalLink className="h-3 w-3 flex-shrink-0" />
                    </a>
                  </div>
                  <Badge variant={s.status === "connected" ? "default" : "secondary"}>{s.status}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-6 text-center">
                  <div><p className="text-xs text-muted-foreground">Posts</p><p className="font-semibold">{s.total_posts ?? 0}</p></div>
                  <div><p className="text-xs text-muted-foreground">Health</p><p className="font-semibold">{s.health_score ?? 0}</p></div>
                  <div><p className="text-xs text-muted-foreground">Authority</p><p className="font-semibold">{s.topical_authority_score ?? 0}</p></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}