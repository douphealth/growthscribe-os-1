
CREATE TABLE IF NOT EXISTS public.content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  brief_id uuid REFERENCES public.content_briefs(id) ON DELETE SET NULL,
  title text NOT NULL,
  meta_description text,
  target_keyword text,
  tone text NOT NULL DEFAULT 'professional',
  persona text,
  content_html text NOT NULL DEFAULT '',
  content_text text,
  word_count integer NOT NULL DEFAULT 0,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  status text NOT NULL DEFAULT 'draft',
  wp_post_id bigint,
  wp_link text,
  published_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_drafts_org_created
  ON public.content_drafts (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_drafts_site
  ON public.content_drafts (site_id);
CREATE INDEX IF NOT EXISTS idx_content_drafts_brief
  ON public.content_drafts (brief_id);

ALTER TABLE public.content_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view drafts"
  ON public.content_drafts FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org members can create drafts"
  ON public.content_drafts FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org members can update drafts"
  ON public.content_drafts FOR UPDATE TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org members can delete drafts"
  ON public.content_drafts FOR DELETE TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE TRIGGER update_content_drafts_updated_at
  BEFORE UPDATE ON public.content_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
