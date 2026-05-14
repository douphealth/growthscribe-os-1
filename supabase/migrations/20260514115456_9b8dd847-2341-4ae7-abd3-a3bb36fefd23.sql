-- GrowthScribe OS schema reconciliation: topical cluster pages and index hardening

CREATE TABLE IF NOT EXISTS public.topical_cluster_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  cluster_id uuid NOT NULL REFERENCES public.topical_clusters(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.wordpress_posts(id) ON DELETE SET NULL,
  url text NOT NULL,
  title text,
  target_keyword text,
  page_role text,
  coverage_status text NOT NULL DEFAULT 'planned',
  position integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, url)
);

ALTER TABLE public.topical_cluster_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members tcp" ON public.topical_cluster_pages;
CREATE POLICY "Org members tcp"
ON public.topical_cluster_pages
FOR ALL
TO authenticated
USING (public.is_org_member(auth.uid(), organization_id))
WITH CHECK (public.is_org_member(auth.uid(), organization_id));

DROP TRIGGER IF EXISTS trg_topical_cluster_pages_updated ON public.topical_cluster_pages;
CREATE TRIGGER trg_topical_cluster_pages_updated
BEFORE UPDATE ON public.topical_cluster_pages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.keyword_rankings
  ADD COLUMN IF NOT EXISTS keyword_id uuid;

CREATE INDEX IF NOT EXISTS idx_tcp_org ON public.topical_cluster_pages (organization_id);
CREATE INDEX IF NOT EXISTS idx_tcp_site ON public.topical_cluster_pages (site_id);
CREATE INDEX IF NOT EXISTS idx_tcp_cluster ON public.topical_cluster_pages (cluster_id);
CREATE INDEX IF NOT EXISTS idx_tcp_post ON public.topical_cluster_pages (post_id);
CREATE INDEX IF NOT EXISTS idx_tcp_url ON public.topical_cluster_pages (url);
CREATE INDEX IF NOT EXISTS idx_tcp_status ON public.topical_cluster_pages (coverage_status);
CREATE INDEX IF NOT EXISTS idx_tcp_created ON public.topical_cluster_pages (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sites_created ON public.sites (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sites_status ON public.sites (status);
CREATE INDEX IF NOT EXISTS idx_content_audits_created ON public.content_audits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_audits_status ON public.content_audits (status);
CREATE INDEX IF NOT EXISTS idx_content_audits_site ON public.content_audits (site_id);
CREATE INDEX IF NOT EXISTS idx_topical_maps_created ON public.topical_maps (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topical_maps_site ON public.topical_maps (site_id);
CREATE INDEX IF NOT EXISTS idx_content_briefs_created ON public.content_briefs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_briefs_site ON public.content_briefs (site_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON public.tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_site ON public.tasks (site_id);
CREATE INDEX IF NOT EXISTS idx_integrations_created ON public.integrations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integrations_site ON public.integrations (site_id);
CREATE INDEX IF NOT EXISTS idx_activities_created ON public.activities (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ic_created ON public.integration_connections (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ic_status ON public.integration_connections (status);
CREATE INDEX IF NOT EXISTS idx_wp_posts_post_id ON public.wordpress_posts (id);
CREATE INDEX IF NOT EXISTS idx_wp_posts_status ON public.wordpress_posts (status);
CREATE INDEX IF NOT EXISTS idx_wp_posts_created ON public.wordpress_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cs_org ON public.content_scores (organization_id);
CREATE INDEX IF NOT EXISTS idx_cs_created ON public.content_scores (computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cr_site ON public.content_recommendations (site_id);
CREATE INDEX IF NOT EXISTS idx_cr_created ON public.content_recommendations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ilo_org ON public.internal_link_opportunities (organization_id);
CREATE INDEX IF NOT EXISTS idx_ilo_target ON public.internal_link_opportunities (target_post_id);
CREATE INDEX IF NOT EXISTS idx_ilo_status ON public.internal_link_opportunities (status);
CREATE INDEX IF NOT EXISTS idx_ilo_created ON public.internal_link_opportunities (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topical_clusters_org ON public.topical_clusters (organization_id);
CREATE INDEX IF NOT EXISTS idx_topical_clusters_created ON public.topical_clusters (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aivt_site ON public.ai_visibility_tests (site_id);
CREATE INDEX IF NOT EXISTS idx_aivt_created ON public.ai_visibility_tests (tested_at DESC);
CREATE INDEX IF NOT EXISTS idx_ar_created ON public.approval_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_site ON public.background_jobs (site_id);
CREATE INDEX IF NOT EXISTS idx_gsc_date ON public.search_console_daily (date DESC);
CREATE INDEX IF NOT EXISTS idx_ga4_date ON public.ga4_daily (date DESC);
CREATE INDEX IF NOT EXISTS idx_kw_date ON public.keyword_rankings (date DESC);
CREATE INDEX IF NOT EXISTS idx_kw_keyword_id ON public.keyword_rankings (keyword_id);
CREATE INDEX IF NOT EXISTS idx_kw_created ON public.keyword_rankings (created_at DESC);