
-- Pass 13: SEO/GEO/AEO/SERP push schema

-- 1. Auto-apply settings (per-org kill switch)
CREATE TABLE IF NOT EXISTS public.auto_apply_settings (
  organization_id uuid PRIMARY KEY,
  mode text NOT NULL DEFAULT 'full' CHECK (mode IN ('full','draft_only','paused')),
  exclude_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  exclude_post_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.auto_apply_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members read aas" ON public.auto_apply_settings
  FOR SELECT TO authenticated USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org admins write aas" ON public.auto_apply_settings
  FOR ALL TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id))
  WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

-- 2. SERP snapshots
CREATE TABLE IF NOT EXISTS public.serp_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  keyword text NOT NULL,
  page text,
  position numeric,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  date date NOT NULL,
  source text NOT NULL DEFAULT 'gsc',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.serp_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members serp" ON public.serp_snapshots
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE UNIQUE INDEX IF NOT EXISTS serp_snapshots_uniq
  ON public.serp_snapshots(organization_id, site_id, keyword, date);
CREATE INDEX IF NOT EXISTS serp_snapshots_site_date
  ON public.serp_snapshots(site_id, date DESC);

-- 3. GEO/AEO JSON-LD assets
CREATE TABLE IF NOT EXISTS public.geo_aeo_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  post_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('article','faq','howto','product','breadcrumb','organization')),
  jsonld jsonb NOT NULL,
  content_hash text,
  applied_at timestamptz,
  applied_changeset_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.geo_aeo_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members geo" ON public.geo_aeo_assets
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE UNIQUE INDEX IF NOT EXISTS geo_aeo_assets_uniq
  ON public.geo_aeo_assets(post_id, kind);
CREATE INDEX IF NOT EXISTS geo_aeo_assets_site
  ON public.geo_aeo_assets(site_id);

-- 4. AI engine citations (weekly rollup)
CREATE TABLE IF NOT EXISTS public.ai_engine_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  query text NOT NULL,
  engine text NOT NULL,
  appears boolean NOT NULL DEFAULT false,
  rank integer,
  citation_url text,
  week date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_engine_citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members aec" ON public.ai_engine_citations
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE UNIQUE INDEX IF NOT EXISTS ai_engine_citations_uniq
  ON public.ai_engine_citations(organization_id, site_id, query, engine, week);
CREATE INDEX IF NOT EXISTS ai_engine_citations_site_week
  ON public.ai_engine_citations(site_id, week DESC);

-- 5. Cluster gap briefs
CREATE TABLE IF NOT EXISTS public.cluster_gap_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  cluster_id uuid,
  suggested_title text NOT NULL,
  target_keyword text,
  intent text,
  rationale text,
  brief_id uuid,
  task_id uuid,
  status text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','briefed','published','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cluster_gap_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members cgb" ON public.cluster_gap_briefs
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));
CREATE INDEX IF NOT EXISTS cluster_gap_briefs_site
  ON public.cluster_gap_briefs(site_id, status);

-- 6. wordpress_posts: optimization tracking
ALTER TABLE public.wordpress_posts
  ADD COLUMN IF NOT EXISTS last_optimized_at timestamptz,
  ADD COLUMN IF NOT EXISTS optimization_score integer,
  ADD COLUMN IF NOT EXISTS content_hash text;
CREATE INDEX IF NOT EXISTS wordpress_posts_last_optimized
  ON public.wordpress_posts(site_id, last_optimized_at NULLS FIRST);

-- 7. Enqueue full optimization RPC
CREATE OR REPLACE FUNCTION public.enqueue_full_optimization(_org_id uuid, _site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  enqueued bigint;
BEGIN
  IF NOT public.is_org_member(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'not a member of organization';
  END IF;

  WITH targets AS (
    SELECT p.id
    FROM public.wordpress_posts p
    WHERE p.organization_id = _org_id
      AND p.site_id = _site_id
      AND p.status = 'publish'
      AND NOT EXISTS (
        SELECT 1 FROM public.background_jobs j
        WHERE j.organization_id = _org_id
          AND j.site_id = _site_id
          AND j.job_type = 'audit_apply'
          AND j.status IN ('queued','running')
          AND (j.payload->>'post_id')::uuid = p.id
      )
  ),
  ins AS (
    INSERT INTO public.background_jobs
      (organization_id, site_id, job_type, payload, status, priority, created_by, max_retries)
    SELECT _org_id, _site_id, 'audit_apply',
           jsonb_build_object('post_id', t.id),
           'queued', 5, auth.uid(), 2
    FROM targets t
    RETURNING 1
  )
  SELECT count(*) INTO enqueued FROM ins;

  RETURN jsonb_build_object('enqueued', enqueued);
END;
$$;

-- 8. Top-line optimization summary RPC
CREATE OR REPLACE FUNCTION public.get_optimization_status(_org_id uuid, _site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_org_member(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'not a member of organization';
  END IF;

  SELECT jsonb_build_object(
    'total_posts', (SELECT COUNT(*) FROM public.wordpress_posts WHERE organization_id = _org_id AND site_id = _site_id AND status='publish'),
    'optimized_recent', (SELECT COUNT(*) FROM public.wordpress_posts WHERE organization_id = _org_id AND site_id = _site_id AND status='publish' AND last_optimized_at > now() - INTERVAL '14 days'),
    'never_optimized', (SELECT COUNT(*) FROM public.wordpress_posts WHERE organization_id = _org_id AND site_id = _site_id AND status='publish' AND last_optimized_at IS NULL),
    'queued_apply', (SELECT COUNT(*) FROM public.background_jobs WHERE organization_id = _org_id AND site_id = _site_id AND job_type='audit_apply' AND status='queued'),
    'running_apply', (SELECT COUNT(*) FROM public.background_jobs WHERE organization_id = _org_id AND site_id = _site_id AND job_type='audit_apply' AND status='running'),
    'changesets_7d', (SELECT COUNT(*) FROM public.content_changesets WHERE organization_id = _org_id AND site_id = _site_id AND applied_at > now() - INTERVAL '7 days'),
    'avg_position_28d', (SELECT ROUND(AVG(position)::numeric, 1) FROM public.serp_snapshots WHERE organization_id = _org_id AND site_id = _site_id AND date > current_date - 28),
    'citation_share_4w', (
      SELECT ROUND(100.0 * SUM(CASE WHEN appears THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 1)
      FROM public.ai_engine_citations
      WHERE organization_id = _org_id AND site_id = _site_id AND week > current_date - 28
    )
  ) INTO result;
  RETURN result;
END;
$$;
