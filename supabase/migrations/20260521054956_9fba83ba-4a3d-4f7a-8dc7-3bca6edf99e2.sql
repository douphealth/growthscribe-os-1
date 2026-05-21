
-- Background jobs: retry/backoff/locking/idempotency
ALTER TABLE public.background_jobs
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text;

CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_idem_key
  ON public.background_jobs (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS background_jobs_due
  ON public.background_jobs (status, next_run_at, priority DESC);

-- Job logs
CREATE TABLE IF NOT EXISTS public.job_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.background_jobs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_logs_job_id ON public.job_logs (job_id, created_at);
ALTER TABLE public.job_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members job_logs" ON public.job_logs;
CREATE POLICY "Org members job_logs" ON public.job_logs
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- WordPress posts: canonical + SEO plugin metadata
ALTER TABLE public.wordpress_posts
  ADD COLUMN IF NOT EXISTS canonical_url text,
  ADD COLUMN IF NOT EXISTS seo_plugin text,
  ADD COLUMN IF NOT EXISTS seo_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

-- WP revisions for rollback
CREATE TABLE IF NOT EXISTS public.wp_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  post_id uuid REFERENCES public.wordpress_posts(id) ON DELETE SET NULL,
  wp_post_id bigint NOT NULL,
  post_type text NOT NULL DEFAULT 'post',
  before jsonb NOT NULL DEFAULT '{}'::jsonb,
  after jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_by uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  job_id uuid REFERENCES public.background_jobs(id) ON DELETE SET NULL,
  rolled_back_at timestamptz,
  rolled_back_by uuid
);
CREATE INDEX IF NOT EXISTS wp_revisions_post ON public.wp_revisions (site_id, wp_post_id, applied_at DESC);
ALTER TABLE public.wp_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members wp_revisions" ON public.wp_revisions;
CREATE POLICY "Org members wp_revisions" ON public.wp_revisions
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- Score breakdowns
CREATE TABLE IF NOT EXISTS public.score_breakdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  post_id uuid REFERENCES public.wordpress_posts(id) ON DELETE CASCADE,
  url text,
  score_type text NOT NULL,
  score integer NOT NULL,
  explanation text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_impact text,
  confidence text NOT NULL DEFAULT 'medium',
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS score_breakdowns_unique
  ON public.score_breakdowns (post_id, score_type)
  WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS score_breakdowns_site ON public.score_breakdowns (site_id, score_type, computed_at DESC);
ALTER TABLE public.score_breakdowns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members score_breakdowns" ON public.score_breakdowns;
CREATE POLICY "Org members score_breakdowns" ON public.score_breakdowns
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- Sites: detected SEO plugin (organization-wide convenience field)
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS detected_seo_plugin text;

-- Realtime: stream job status changes
ALTER TABLE public.background_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.job_logs REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.background_jobs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_logs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
