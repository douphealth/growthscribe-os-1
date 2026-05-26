
-- =========================================================================
-- GrowthScribe OS — Multi-tenant refactor + production schema
-- =========================================================================

-- Organizations & roles -----------------------------------------------------
CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'editor', 'analyst', 'viewer');

CREATE TABLE public.organizations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.organization_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.org_role NOT NULL DEFAULT 'viewer',
  invited_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX idx_org_members_org  ON public.organization_members(organization_id);
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Security-definer helpers --------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_user_id UUID, _org_id UUID, _role public.org_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id AND role IN ('owner', 'admin')
  );
$$;

-- Backfill: one personal org per existing owner_id across business tables ---
DO $$
DECLARE
  rec RECORD;
  new_org UUID;
BEGIN
  FOR rec IN
    SELECT DISTINCT owner_id FROM (
      SELECT owner_id FROM public.sites
      UNION SELECT owner_id FROM public.content_audits
      UNION SELECT owner_id FROM public.content_briefs
      UNION SELECT owner_id FROM public.tasks
      UNION SELECT owner_id FROM public.topical_maps
      UNION SELECT owner_id FROM public.integrations
      UNION SELECT owner_id FROM public.activities
    ) t WHERE owner_id IS NOT NULL
  LOOP
    INSERT INTO public.organizations (name, slug, created_by)
    VALUES ('Personal Workspace', 'personal-' || substr(rec.owner_id::text, 1, 8), rec.owner_id)
    RETURNING id INTO new_org;
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (new_org, rec.owner_id, 'owner');
  END LOOP;
END $$;

-- Add organization_id to existing business tables ---------------------------
ALTER TABLE public.sites               ADD COLUMN organization_id UUID;
ALTER TABLE public.content_audits      ADD COLUMN organization_id UUID;
ALTER TABLE public.content_briefs      ADD COLUMN organization_id UUID;
ALTER TABLE public.tasks               ADD COLUMN organization_id UUID;
ALTER TABLE public.topical_maps        ADD COLUMN organization_id UUID;
ALTER TABLE public.integrations        ADD COLUMN organization_id UUID;
ALTER TABLE public.activities          ADD COLUMN organization_id UUID;
ALTER TABLE public.audit_logs          ADD COLUMN organization_id UUID;

UPDATE public.sites          s SET organization_id = o.id FROM public.organizations o WHERE o.created_by = s.owner_id AND s.organization_id IS NULL;
UPDATE public.content_audits s SET organization_id = o.id FROM public.organizations o WHERE o.created_by = s.owner_id AND s.organization_id IS NULL;
UPDATE public.content_briefs s SET organization_id = o.id FROM public.organizations o WHERE o.created_by = s.owner_id AND s.organization_id IS NULL;
UPDATE public.tasks          s SET organization_id = o.id FROM public.organizations o WHERE o.created_by = s.owner_id AND s.organization_id IS NULL;
UPDATE public.topical_maps   s SET organization_id = o.id FROM public.organizations o WHERE o.created_by = s.owner_id AND s.organization_id IS NULL;
UPDATE public.integrations   s SET organization_id = o.id FROM public.organizations o WHERE o.created_by = s.owner_id AND s.organization_id IS NULL;
UPDATE public.activities     s SET organization_id = o.id FROM public.organizations o WHERE o.created_by = s.owner_id AND s.organization_id IS NULL;

ALTER TABLE public.sites          ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.content_audits ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.content_briefs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.tasks          ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.topical_maps   ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.integrations   ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.activities     ALTER COLUMN organization_id SET NOT NULL;

-- FKs
ALTER TABLE public.sites          ADD CONSTRAINT sites_org_fk          FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.content_audits ADD CONSTRAINT content_audits_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.content_briefs ADD CONSTRAINT content_briefs_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.tasks          ADD CONSTRAINT tasks_org_fk          FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.topical_maps   ADD CONSTRAINT topical_maps_org_fk   FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.integrations   ADD CONSTRAINT integrations_org_fk   FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.activities     ADD CONSTRAINT activities_org_fk     FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.audit_logs     ADD CONSTRAINT audit_logs_org_fk     FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX idx_sites_org           ON public.sites(organization_id);
CREATE INDEX idx_content_audits_org  ON public.content_audits(organization_id);
CREATE INDEX idx_content_briefs_org  ON public.content_briefs(organization_id);
CREATE INDEX idx_tasks_org           ON public.tasks(organization_id);
CREATE INDEX idx_topical_maps_org    ON public.topical_maps(organization_id);
CREATE INDEX idx_integrations_org    ON public.integrations(organization_id);
CREATE INDEX idx_activities_org      ON public.activities(organization_id);

-- Drop old owner-scoped policies, add org-scoped ones -----------------------
DROP POLICY IF EXISTS "Owners manage sites"               ON public.sites;
DROP POLICY IF EXISTS "Owners manage audits"              ON public.content_audits;
DROP POLICY IF EXISTS "Owners manage briefs"              ON public.content_briefs;
DROP POLICY IF EXISTS "Owners manage tasks"               ON public.tasks;
DROP POLICY IF EXISTS "Owners delete tasks"               ON public.tasks;
DROP POLICY IF EXISTS "Owners and assignees view tasks"   ON public.tasks;
DROP POLICY IF EXISTS "Owners and assignees update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Owners manage topical maps"        ON public.topical_maps;
DROP POLICY IF EXISTS "Owners manage integrations"        ON public.integrations;
DROP POLICY IF EXISTS "Owners view activities"            ON public.activities;
DROP POLICY IF EXISTS "Owners insert activities"          ON public.activities;

CREATE POLICY "Org members read sites"   ON public.sites   FOR SELECT TO authenticated USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org members write sites"  ON public.sites   FOR ALL    TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org members audits"       ON public.content_audits  FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org members briefs"       ON public.content_briefs  FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org members tasks"        ON public.tasks           FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org members topical_maps" ON public.topical_maps    FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org members integrations" ON public.integrations    FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org members activities r" ON public.activities      FOR SELECT TO authenticated USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org members activities w" ON public.activities      FOR INSERT TO authenticated WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- Organizations / members policies -----------------------------------------
CREATE POLICY "Members read their orgs" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), id));
CREATE POLICY "Authenticated create orgs" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "Org admins update org" ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_org_admin(auth.uid(), id));
CREATE POLICY "Org owners delete org" ON public.organizations FOR DELETE TO authenticated
  USING (public.has_org_role(auth.uid(), id, 'owner'));

CREATE POLICY "Members read membership" ON public.organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org admins manage members" ON public.organization_members FOR ALL TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id))
  WITH CHECK (public.is_org_admin(auth.uid(), organization_id));
-- Allow the org creator to insert their own first owner row.
CREATE POLICY "Self insert own membership on org create" ON public.organization_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- New product tables --------------------------------------------------------
CREATE TYPE public.connection_status AS ENUM ('pending', 'connected', 'error', 'revoked');
CREATE TYPE public.job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE public.approval_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

CREATE TABLE public.integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES public.sites(id) ON DELETE CASCADE,
  provider public.integration_provider NOT NULL,
  status public.connection_status NOT NULL DEFAULT 'pending',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members ic" ON public.integration_connections FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE INDEX idx_ic_org ON public.integration_connections(organization_id);
CREATE INDEX idx_ic_site ON public.integration_connections(site_id);

CREATE TABLE public.wordpress_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  wp_post_id BIGINT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  slug TEXT,
  status TEXT,
  excerpt TEXT,
  content_html TEXT,
  word_count INTEGER,
  author TEXT,
  categories JSONB DEFAULT '[]'::jsonb,
  tags JSONB DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ,
  modified_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, wp_post_id)
);
ALTER TABLE public.wordpress_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members wp" ON public.wordpress_posts FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE INDEX idx_wp_org_site ON public.wordpress_posts(organization_id, site_id);

CREATE TABLE public.content_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  post_id UUID REFERENCES public.wordpress_posts(id) ON DELETE CASCADE,
  audit_id UUID REFERENCES public.content_audits(id) ON DELETE CASCADE,
  quality_score INTEGER, eeat_score INTEGER, aeo_score INTEGER, geo_score INTEGER,
  helpfulness_score INTEGER, originality_score INTEGER,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.content_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members cs" ON public.content_scores FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE TABLE public.content_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  post_id UUID REFERENCES public.wordpress_posts(id) ON DELETE CASCADE,
  audit_id UUID REFERENCES public.content_audits(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  detail TEXT,
  suggested_action TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.content_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members cr" ON public.content_recommendations FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE TABLE public.internal_link_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  source_post_id UUID REFERENCES public.wordpress_posts(id) ON DELETE CASCADE,
  target_post_id UUID REFERENCES public.wordpress_posts(id) ON DELETE CASCADE,
  anchor_suggestion TEXT,
  context_snippet TEXT,
  relevance_score NUMERIC(5,2),
  status TEXT NOT NULL DEFAULT 'suggested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.internal_link_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members ilo" ON public.internal_link_opportunities FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE TABLE public.topical_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pillar_topic TEXT,
  description TEXT,
  coverage_percent NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.topical_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members tc" ON public.topical_clusters FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE TABLE public.ai_visibility_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  engine TEXT NOT NULL,
  appears BOOLEAN,
  rank INTEGER,
  citation_url TEXT,
  raw_response JSONB,
  tested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_visibility_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members aivt" ON public.ai_visibility_tests FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE TABLE public.approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  brief_id UUID REFERENCES public.content_briefs(id) ON DELETE SET NULL,
  draft_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by UUID NOT NULL,
  reviewer_id UUID,
  status public.approval_status NOT NULL DEFAULT 'pending',
  decision_note TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members ar" ON public.approval_requests FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE TABLE public.background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES public.sites(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status public.job_status NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  created_by UUID NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members jobs" ON public.background_jobs FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE INDEX idx_jobs_org_status ON public.background_jobs(organization_id, status);

-- audit_logs: extend RLS with org-scoped read
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;
CREATE POLICY "Org admins read audit logs" ON public.audit_logs FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id));

-- Update handle_new_user: also create personal org -------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_org_id UUID;
  is_first_user BOOLEAN;
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO is_first_user;
  IF is_first_user THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'editor');
  END IF;

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES ('My Workspace', 'ws-' || substr(NEW.id::text, 1, 8) || '-' || substr(md5(random()::text), 1, 6), NEW.id)
  RETURNING id INTO new_org_id;
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at triggers for new tables ---------------------------------------
CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ic_updated BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
