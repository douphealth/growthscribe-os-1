
-- 1. Indexes on hot read paths
CREATE INDEX IF NOT EXISTS idx_gsc_site_date ON public.search_console_daily (site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_site_page_date ON public.search_console_daily (site_id, page, date DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_site_query_date ON public.search_console_daily (site_id, query, date DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_org_date ON public.search_console_daily (organization_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_wp_posts_site_status ON public.wordpress_posts (site_id, status);
CREATE INDEX IF NOT EXISTS idx_wp_posts_site_modified ON public.wordpress_posts (site_id, modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_changesets_site_applied ON public.content_changesets (site_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_changesets_post ON public.content_changesets (post_id) WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_queue ON public.background_jobs (priority DESC, next_run_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_jobs_running ON public.background_jobs (started_at)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_jobs_org_status ON public.background_jobs (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_ga4_site_date ON public.ga4_daily (site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_kw_site_keyword_date ON public.keyword_rankings (site_id, keyword, date DESC);

-- 2. Normalize search_console_daily key cols so upsert works (NULLs treated as distinct otherwise)
UPDATE public.search_console_daily SET query = '' WHERE query IS NULL;
UPDATE public.search_console_daily SET page = '' WHERE page IS NULL;
ALTER TABLE public.search_console_daily ALTER COLUMN query SET DEFAULT '';
ALTER TABLE public.search_console_daily ALTER COLUMN page SET DEFAULT '';
ALTER TABLE public.search_console_daily ALTER COLUMN query SET NOT NULL;
ALTER TABLE public.search_console_daily ALTER COLUMN page SET NOT NULL;

-- Deduplicate before adding the unique constraint
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY site_id, date, query, page
    ORDER BY clicks DESC, impressions DESC, created_at DESC
  ) AS rn
  FROM public.search_console_daily
)
DELETE FROM public.search_console_daily
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gsc_site_date_query_page
  ON public.search_console_daily (site_id, date, query, page);

-- 3. 28-day page rollup materialized view
DROP MATERIALIZED VIEW IF EXISTS public.gsc_page_rollup_28d;
CREATE MATERIALIZED VIEW public.gsc_page_rollup_28d AS
SELECT
  organization_id,
  site_id,
  page,
  SUM(clicks)::bigint AS clicks,
  SUM(impressions)::bigint AS impressions,
  CASE WHEN SUM(impressions) > 0
    THEN SUM(clicks)::numeric / SUM(impressions)::numeric
    ELSE 0 END AS ctr,
  AVG(position) FILTER (WHERE position IS NOT NULL) AS position
FROM public.search_console_daily
WHERE date >= (CURRENT_DATE - INTERVAL '28 days')
GROUP BY organization_id, site_id, page;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gsc_page_rollup_28d
  ON public.gsc_page_rollup_28d (site_id, page);
CREATE INDEX IF NOT EXISTS idx_gsc_page_rollup_28d_org
  ON public.gsc_page_rollup_28d (organization_id);

GRANT SELECT ON public.gsc_page_rollup_28d TO authenticated;

-- Refresh function (security definer so cron can call without role)
CREATE OR REPLACE FUNCTION public.refresh_gsc_page_rollup_28d()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.gsc_page_rollup_28d;
EXCEPTION WHEN OTHERS THEN
  REFRESH MATERIALIZED VIEW public.gsc_page_rollup_28d;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_gsc_page_rollup_28d() FROM PUBLIC, anon;

-- 4. Nightly refresh via pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-gsc-page-rollup-28d');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'refresh-gsc-page-rollup-28d',
  '10 3 * * *',
  $$SELECT public.refresh_gsc_page_rollup_28d();$$
);
