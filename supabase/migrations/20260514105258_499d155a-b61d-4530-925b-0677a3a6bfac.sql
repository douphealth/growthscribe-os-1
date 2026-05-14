
-- ============ NEW ANALYTICS TABLES ============

CREATE TABLE IF NOT EXISTS public.search_console_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
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
ALTER TABLE public.search_console_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members gsc" ON public.search_console_daily
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE TABLE IF NOT EXISTS public.ga4_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
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
ALTER TABLE public.ga4_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members ga4" ON public.ga4_daily
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE TABLE IF NOT EXISTS public.keyword_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
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
ALTER TABLE public.keyword_rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members kw" ON public.keyword_rankings
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- ============ INDEXES (idempotent) ============

CREATE INDEX IF NOT EXISTS idx_gsc_org_site_date ON public.search_console_daily (organization_id, site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_query ON public.search_console_daily (site_id, query);
CREATE INDEX IF NOT EXISTS idx_ga4_org_site_date ON public.ga4_daily (organization_id, site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ga4_page ON public.ga4_daily (site_id, page_path);
CREATE INDEX IF NOT EXISTS idx_kw_org_site_date ON public.keyword_rankings (organization_id, site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_kw_keyword ON public.keyword_rankings (site_id, keyword);

CREATE INDEX IF NOT EXISTS idx_sites_org ON public.sites (organization_id);
CREATE INDEX IF NOT EXISTS idx_sites_status ON public.sites (status);

CREATE INDEX IF NOT EXISTS idx_audits_org_created ON public.content_audits (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_site ON public.content_audits (site_id);
CREATE INDEX IF NOT EXISTS idx_audits_status ON public.content_audits (status);

CREATE INDEX IF NOT EXISTS idx_briefs_org_created ON public.content_briefs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefs_site ON public.content_briefs (site_id);

CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON public.tasks (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_site ON public.tasks (site_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks (assignee_id);

CREATE INDEX IF NOT EXISTS idx_topical_maps_org ON public.topical_maps (organization_id);
CREATE INDEX IF NOT EXISTS idx_topical_maps_site ON public.topical_maps (site_id);

CREATE INDEX IF NOT EXISTS idx_topical_clusters_site ON public.topical_clusters (site_id);

CREATE INDEX IF NOT EXISTS idx_integrations_org ON public.integrations (organization_id);
CREATE INDEX IF NOT EXISTS idx_integrations_provider ON public.integrations (provider);

CREATE INDEX IF NOT EXISTS idx_ic_org ON public.integration_connections (organization_id);
CREATE INDEX IF NOT EXISTS idx_ic_provider ON public.integration_connections (provider);

CREATE INDEX IF NOT EXISTS idx_activities_org_created ON public.activities (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON public.audit_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_org_status ON public.background_jobs (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON public.background_jobs (job_type);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON public.background_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wp_posts_site ON public.wordpress_posts (site_id);
CREATE INDEX IF NOT EXISTS idx_wp_posts_url ON public.wordpress_posts (url);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wp_posts_unique ON public.wordpress_posts (site_id, wp_post_id);

CREATE INDEX IF NOT EXISTS idx_cs_post ON public.content_scores (post_id);
CREATE INDEX IF NOT EXISTS idx_cs_site ON public.content_scores (site_id);

CREATE INDEX IF NOT EXISTS idx_cr_org_status ON public.content_recommendations (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_cr_post ON public.content_recommendations (post_id);

CREATE INDEX IF NOT EXISTS idx_ilo_site ON public.internal_link_opportunities (site_id);
CREATE INDEX IF NOT EXISTS idx_ilo_source ON public.internal_link_opportunities (source_post_id);

CREATE INDEX IF NOT EXISTS idx_ar_org_status ON public.approval_requests (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_ar_site ON public.approval_requests (site_id);

CREATE INDEX IF NOT EXISTS idx_aivt_org_site ON public.ai_visibility_tests (organization_id, site_id);
CREATE INDEX IF NOT EXISTS idx_aivt_tested ON public.ai_visibility_tests (tested_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members (user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON public.organization_members (organization_id);
