
CREATE TABLE public.competitor_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  site_id UUID NOT NULL,
  competitor_domain TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  meta_description TEXT,
  h1 TEXT,
  headings JSONB NOT NULL DEFAULT '[]'::jsonb,
  schema_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  word_count INTEGER,
  internal_links_count INTEGER,
  external_links_count INTEGER,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  analyzed_by UUID NOT NULL,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_competitor_pages_org_site ON public.competitor_pages (organization_id, site_id, analyzed_at DESC);

ALTER TABLE public.competitor_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members competitor_pages"
ON public.competitor_pages
FOR ALL
TO authenticated
USING (public.is_org_member(auth.uid(), organization_id))
WITH CHECK (public.is_org_member(auth.uid(), organization_id));
