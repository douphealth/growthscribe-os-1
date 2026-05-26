-- GrowthScribe OS production schema reconciliation
-- Idempotent catch-up migration: repo schema = generated types = app expectations.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'editor', 'analyst', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.connection_status AS ENUM ('pending', 'connected', 'error', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.approval_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Helper function used by timestamp triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Organization model
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.org_role NOT NULL DEFAULT 'viewer',
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON public.organization_members(organization_id);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = _user_id
      AND organization_id = _org_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_user_id uuid, _org_id uuid, _role public.org_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = _user_id
      AND organization_id = _org_id
      AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = _user_id
      AND organization_id = _org_id
      AND role IN ('owner', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- Ensure organization_id on legacy business tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.content_audits ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.topical_maps ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.content_briefs ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS organization_id uuid;

-- Create a personal organization for each owner seen in legacy rows.
INSERT INTO public.organizations (name, slug, created_by)
SELECT 'Personal Workspace', 'personal-' || substr(owner_id::text, 1, 8), owner_id
FROM (
  SELECT owner_id FROM public.sites WHERE owner_id IS NOT NULL
  UNION SELECT owner_id FROM public.content_audits WHERE owner_id IS NOT NULL
  UNION SELECT owner_id FROM public.content_briefs WHERE owner_id IS NOT NULL
  UNION SELECT owner_id FROM public.tasks WHERE owner_id IS NOT NULL
  UNION SELECT owner_id FROM public.topical_maps WHERE owner_id IS NOT NULL
  UNION SELECT owner_id FROM public.integrations WHERE owner_id IS NOT NULL
  UNION SELECT owner_id FROM public.activities WHERE owner_id IS NOT NULL
) owners
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.organization_members (organization_id, user_id, role)
SELECT o.id, o.created_by, 'owner'::public.org_role
FROM public.organizations o
WHERE o.slug LIKE 'personal-%'
ON CONFLICT (organization_id, user_id) DO NOTHING;

UPDATE public.sites s SET organization_id = o.id FROM public.organizations o WHERE s.organization_id IS NULL AND o.created_by = s.owner_id;
UPDATE public.content_audits s SET organization_id = o.id FROM public.organizations o WHERE s.organization_id IS NULL AND o.created_by = s.owner_id;
UPDATE public.content_briefs s SET organization_id = o.id FROM public.organizations o WHERE s.organization_id IS NULL AND o.created_by = s.owner_id;
UPDATE public.tasks s SET organization_id = o.id FROM public.organizations o WHERE s.organization_id IS NULL AND o.created_by = s.owner_id;
UPDATE public.topical_maps s SET organization_id = o.id FROM public.organizations o WHERE s.organization_id IS NULL AND o.created_by = s.owner_id;
UPDATE public.integrations s SET organization_id = o.id FROM public.organizations o WHERE s.organization_id IS NULL AND o.created_by = s.owner_id;
UPDATE public.activities s SET organization_id = o.id FROM public.organizations o WHERE s.organization_id IS NULL AND o.created_by = s.owner_id;

DO $$ BEGIN
  ALTER TABLE public.sites ADD CONSTRAINT sites_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.content_audits ADD CONSTRAINT content_audits_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.topical_maps ADD CONSTRAINT topical_maps_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.content_briefs ADD CONSTRAINT content_briefs_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.tasks ADD CONSTRAINT tasks_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.integrations ADD CONSTRAINT integrations_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.activities ADD CONSTRAINT activities_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_sites_org ON public.sites(organization_id);
CREATE INDEX IF NOT EXISTS idx_content_audits_org ON public.content_audits(organization_id);
CREATE INDEX IF NOT EXISTS idx_topical_maps_org ON public.topical_maps(organization_id);
CREATE INDEX IF NOT EXISTS idx_content_briefs_org ON public.content_briefs(organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org ON public.tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_integrations_org ON public.integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_activities_org ON public.activities(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON public.audit_logs(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Production tables used by the app and generated types
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  provider public.integration_provider NOT NULL,
  status public.connection_status NOT NULL DEFAULT 'pending',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  last_synced_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integration_connections ADD COLUMN IF NOT EXISTS credential_secret_name text;

CREATE TABLE IF NOT EXISTS public.wordpress_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  wp_post_id bigint NOT NULL,
  post_type text NOT NULL DEFAULT 'post',
  status text,
  slug text,
  url text NOT NULL,
  title text,
  excerpt text,
  content_html text,
  content_text text,
  author text,
  categories jsonb DEFAULT '[]'::jsonb,
  tags jsonb DEFAULT '[]'::jsonb,
  published_at timestamptz,
  modified_at timestamptz,
  word_count integer,
  seo_score integer,
  aeo_score integer,
  geo_score integer,
  freshness_score integer,
  recommended_action text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, wp_post_id)
);

ALTER TABLE public.wordpress_posts ADD COLUMN IF NOT EXISTS post_type text NOT NULL DEFAULT 'post';
ALTER TABLE public.wordpress_posts ADD COLUMN IF NOT EXISTS content_text text;
ALTER TABLE public.wordpress_posts ADD COLUMN IF NOT EXISTS seo_score integer;
ALTER TABLE public.wordpress_posts ADD COLUMN IF NOT EXISTS aeo_score integer;
ALTER TABLE public.wordpress_posts ADD COLUMN IF NOT EXISTS geo_score integer;
ALTER TABLE public.wordpress_posts ADD COLUMN IF NOT EXISTS freshness_score integer;
ALTER TABLE public.wordpress_posts ADD COLUMN IF NOT EXISTS recommended_action text;

CREATE TABLE IF NOT EXISTS public.content_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.wordpress_posts(id) ON DELETE CASCADE,
  audit_id uuid REFERENCES public.content_audits(id) ON DELETE CASCADE,
  quality_score integer,
  eeat_score integer,
  aeo_score integer,
  geo_score integer,
  helpfulness_score integer,
  originality_score integer,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.wordpress_posts(id) ON DELETE CASCADE,
  audit_id uuid REFERENCES public.content_audits(id) ON DELETE SET NULL,
  category text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  detail text,
  suggested_action text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_link_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  source_post_id uuid REFERENCES public.wordpress_posts(id) ON DELETE CASCADE,
  target_post_id uuid REFERENCES public.wordpress_posts(id) ON DELETE CASCADE,
  anchor_suggestion text,
  context_snippet text,
  relevance_score numeric,
  status text NOT NULL DEFAULT 'suggested',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.topical_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name text NOT NULL,
  pillar_topic text,
  description text,
  coverage_percent numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_visibility_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  query text NOT NULL,
  engine text NOT NULL,
  appears boolean,
  rank integer,
  citation_url text,
  raw_response jsonb,
  tested_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  brief_id uuid REFERENCES public.content_briefs(id) ON DELETE SET NULL,
  draft_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid NOT NULL,
  reviewer_id uuid,
  status public.approval_status NOT NULL DEFAULT 'pending',
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status public.job_status NOT NULL DEFAULT 'queued',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  created_by uuid NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.search_console_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  date date NOT NULL,
  query text,
  page text,
  country text,
  device text,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  ctr numeric,
  position numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ga4_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  date date NOT NULL,
  page_path text,
  source text,
  medium text,
  sessions integer NOT NULL DEFAULT 0,
  users integer NOT NULL DEFAULT 0,
  engaged_sessions integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.keyword_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  page text,
  date date NOT NULL,
  position numeric,
  search_volume integer,
  difficulty integer,
  intent text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ic_org ON public.integration_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_ic_site ON public.integration_connections(site_id);
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_org_site_provider_uniq ON public.integration_connections(organization_id, COALESCE(site_id::text, ''), provider);
CREATE INDEX IF NOT EXISTS idx_wp_org_site ON public.wordpress_posts(organization_id, site_id);
CREATE INDEX IF NOT EXISTS idx_wp_posts_site ON public.wordpress_posts(site_id);
CREATE INDEX IF NOT EXISTS idx_wp_posts_url ON public.wordpress_posts(url);
CREATE INDEX IF NOT EXISTS idx_wp_posts_org_modified ON public.wordpress_posts(organization_id, modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_cs_post ON public.content_scores(post_id);
CREATE INDEX IF NOT EXISTS idx_cs_site ON public.content_scores(site_id);
CREATE INDEX IF NOT EXISTS idx_cr_org_status ON public.content_recommendations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_cr_post ON public.content_recommendations(post_id);
CREATE INDEX IF NOT EXISTS idx_ilo_site ON public.internal_link_opportunities(site_id);
CREATE INDEX IF NOT EXISTS idx_ilo_source ON public.internal_link_opportunities(source_post_id);
CREATE INDEX IF NOT EXISTS idx_topical_clusters_site ON public.topical_clusters(site_id);
CREATE INDEX IF NOT EXISTS idx_aivt_org_site ON public.ai_visibility_tests(organization_id, site_id);
CREATE INDEX IF NOT EXISTS idx_aivt_tested ON public.ai_visibility_tests(tested_at DESC);
CREATE INDEX IF NOT EXISTS idx_ar_org_status ON public.approval_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_ar_site ON public.approval_requests(site_id);
CREATE INDEX IF NOT EXISTS idx_jobs_org_status ON public.background_jobs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON public.background_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON public.background_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_org_site_date ON public.search_console_daily(organization_id, site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_query ON public.search_console_daily(site_id, query);
CREATE INDEX IF NOT EXISTS idx_ga4_org_site_date ON public.ga4_daily(organization_id, site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ga4_page ON public.ga4_daily(site_id, page_path);
CREATE INDEX IF NOT EXISTS idx_kw_org_site_date ON public.keyword_rankings(organization_id, site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_kw_keyword ON public.keyword_rankings(site_id, keyword);

-- ---------------------------------------------------------------------------
-- RLS: replace global-admin tenant access with organization-scoped access
-- ---------------------------------------------------------------------------
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wordpress_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_link_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topical_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_visibility_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_console_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga4_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keyword_rankings ENABLE ROW LEVEL SECURITY;

-- Legacy owner/global-admin policies
DROP POLICY IF EXISTS "Owners manage sites" ON public.sites;
DROP POLICY IF EXISTS "Owners manage audits" ON public.content_audits;
DROP POLICY IF EXISTS "Owners manage briefs" ON public.content_briefs;
DROP POLICY IF EXISTS "Owners manage tasks" ON public.tasks;
DROP POLICY IF EXISTS "Owners delete tasks" ON public.tasks;
DROP POLICY IF EXISTS "Owners and assignees view tasks" ON public.tasks;
DROP POLICY IF EXISTS "Owners and assignees update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Owners manage topical maps" ON public.topical_maps;
DROP POLICY IF EXISTS "Owners manage integrations" ON public.integrations;
DROP POLICY IF EXISTS "Owners view activities" ON public.activities;
DROP POLICY IF EXISTS "Owners insert activities" ON public.activities;
DROP POLICY IF EXISTS "Admins read audit logs" ON public.audit_logs;

-- Current org policies, recreated to avoid drift
DROP POLICY IF EXISTS "Members read their orgs" ON public.organizations;
CREATE POLICY "Members read their orgs" ON public.organizations FOR SELECT TO authenticated USING (public.is_org_member(auth.uid(), id));
DROP POLICY IF EXISTS "Authenticated create orgs" ON public.organizations;
CREATE POLICY "Authenticated create orgs" ON public.organizations FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
DROP POLICY IF EXISTS "Org admins update org" ON public.organizations;
CREATE POLICY "Org admins update org" ON public.organizations FOR UPDATE TO authenticated USING (public.is_org_admin(auth.uid(), id));
DROP POLICY IF EXISTS "Org owners delete org" ON public.organizations;
CREATE POLICY "Org owners delete org" ON public.organizations FOR DELETE TO authenticated USING (public.has_org_role(auth.uid(), id, 'owner'::public.org_role));

DROP POLICY IF EXISTS "Members read membership" ON public.organization_members;
CREATE POLICY "Members read membership" ON public.organization_members FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org admins manage members" ON public.organization_members;
CREATE POLICY "Org admins manage members" ON public.organization_members FOR ALL TO authenticated USING (public.is_org_admin(auth.uid(), organization_id)) WITH CHECK (public.is_org_admin(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Self insert own membership on org create" ON public.organization_members;
CREATE POLICY "Self insert own membership on org create" ON public.organization_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Org members read sites" ON public.sites;
CREATE POLICY "Org members read sites" ON public.sites FOR SELECT TO authenticated USING (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members write sites" ON public.sites;
CREATE POLICY "Org members write sites" ON public.sites FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Org members audits" ON public.content_audits;
CREATE POLICY "Org members audits" ON public.content_audits FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members briefs" ON public.content_briefs;
CREATE POLICY "Org members briefs" ON public.content_briefs FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members tasks" ON public.tasks;
CREATE POLICY "Org members tasks" ON public.tasks FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members topical_maps" ON public.topical_maps;
CREATE POLICY "Org members topical_maps" ON public.topical_maps FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members integrations" ON public.integrations;
CREATE POLICY "Org members integrations" ON public.integrations FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members activities r" ON public.activities;
CREATE POLICY "Org members activities r" ON public.activities FOR SELECT TO authenticated USING (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members activities w" ON public.activities;
CREATE POLICY "Org members activities w" ON public.activities FOR INSERT TO authenticated WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org admins read audit logs" ON public.audit_logs;
CREATE POLICY "Org admins read audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (organization_id IS NOT NULL AND public.is_org_admin(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Org members ic" ON public.integration_connections;
CREATE POLICY "Org members ic" ON public.integration_connections FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members wp" ON public.wordpress_posts;
CREATE POLICY "Org members wp" ON public.wordpress_posts FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members cs" ON public.content_scores;
CREATE POLICY "Org members cs" ON public.content_scores FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members cr" ON public.content_recommendations;
CREATE POLICY "Org members cr" ON public.content_recommendations FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members ilo" ON public.internal_link_opportunities;
CREATE POLICY "Org members ilo" ON public.internal_link_opportunities FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members tc" ON public.topical_clusters;
CREATE POLICY "Org members tc" ON public.topical_clusters FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members aivt" ON public.ai_visibility_tests;
CREATE POLICY "Org members aivt" ON public.ai_visibility_tests FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members ar" ON public.approval_requests;
CREATE POLICY "Org members ar" ON public.approval_requests FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members jobs" ON public.background_jobs;
CREATE POLICY "Org members jobs" ON public.background_jobs FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members gsc" ON public.search_console_daily;
CREATE POLICY "Org members gsc" ON public.search_console_daily FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members ga4" ON public.ga4_daily;
CREATE POLICY "Org members ga4" ON public.ga4_daily FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));
DROP POLICY IF EXISTS "Org members kw" ON public.keyword_rankings;
CREATE POLICY "Org members kw" ON public.keyword_rankings FOR ALL TO authenticated USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- New signups should create a workspace and membership.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
  is_first_user boolean;
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO is_first_user;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN is_first_user THEN 'owner'::public.app_role ELSE 'editor'::public.app_role END)
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES ('My Workspace', 'ws-' || substr(NEW.id::text, 1, 8) || '-' || substr(md5(random()::text), 1, 6), NEW.id)
  RETURNING id INTO new_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner'::public.org_role)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS trg_orgs_updated ON public.organizations;
CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_ic_updated ON public.integration_connections;
CREATE TRIGGER trg_ic_updated BEFORE UPDATE ON public.integration_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
