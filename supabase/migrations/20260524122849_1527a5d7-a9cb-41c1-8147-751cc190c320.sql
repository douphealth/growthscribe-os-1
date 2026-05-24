
-- Pass 8: dashboard summary RPC
CREATE OR REPLACE FUNCTION public.get_dashboard_summary(_org_id uuid)
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
    'sites', (SELECT COUNT(*) FROM public.sites WHERE organization_id = _org_id),
    'audits', (SELECT COUNT(*) FROM public.content_audits WHERE organization_id = _org_id),
    'open_tasks', (SELECT COUNT(*) FROM public.tasks
                   WHERE organization_id = _org_id
                     AND status NOT IN ('published','archived')),
    'briefs', (SELECT COUNT(*) FROM public.content_briefs WHERE organization_id = _org_id),
    'monthly_clicks', COALESCE((SELECT SUM(monthly_clicks) FROM public.sites WHERE organization_id = _org_id), 0),
    'monthly_impressions', COALESCE((SELECT SUM(monthly_impressions) FROM public.sites WHERE organization_id = _org_id), 0),
    'recent_activities', COALESCE((
      SELECT jsonb_agg(a) FROM (
        SELECT id, type, title, description, link, created_at, metadata
        FROM public.activities
        WHERE organization_id = _org_id
        ORDER BY created_at DESC
        LIMIT 8
      ) a
    ), '[]'::jsonb),
    'active_jobs', COALESCE((
      SELECT jsonb_agg(j) FROM (
        SELECT id, job_type, status, created_at, items_processed, total_items
        FROM public.background_jobs
        WHERE organization_id = _org_id AND status IN ('queued','running')
        ORDER BY created_at DESC
        LIMIT 20
      ) j
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_dashboard_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(uuid) TO authenticated;

-- Pass 9: atomic batch job claim with SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_jobs(_worker_id text, _max_jobs int, _max_per_org int)
RETURNS SETOF public.background_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH running_per_org AS (
    SELECT organization_id, COUNT(*) AS n
    FROM public.background_jobs
    WHERE status = 'running'
    GROUP BY organization_id
  ),
  candidates AS (
    SELECT j.id
    FROM public.background_jobs j
    LEFT JOIN running_per_org r ON r.organization_id = j.organization_id
    WHERE j.status = 'queued'
      AND j.next_run_at <= now()
      AND COALESCE(r.n, 0) < _max_per_org
    ORDER BY j.priority DESC, j.next_run_at ASC
    LIMIT _max_jobs
    FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE public.background_jobs j
  SET status = 'running',
      started_at = now(),
      locked_at = now(),
      locked_by = _worker_id
  FROM candidates c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_jobs(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(text, int, int) TO service_role;

-- Pass 12: cleanup function for old job logs and stale GSC rows
CREATE OR REPLACE FUNCTION public.cleanup_stale_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_logs bigint;
  deleted_gsc bigint;
  deleted_jobs bigint;
BEGIN
  DELETE FROM public.job_logs WHERE created_at < now() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_logs = ROW_COUNT;

  DELETE FROM public.search_console_daily WHERE date < CURRENT_DATE - INTERVAL '180 days';
  GET DIAGNOSTICS deleted_gsc = ROW_COUNT;

  DELETE FROM public.background_jobs
  WHERE status IN ('succeeded','failed')
    AND finished_at < now() - INTERVAL '14 days';
  GET DIAGNOSTICS deleted_jobs = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_logs', deleted_logs,
    'deleted_gsc', deleted_gsc,
    'deleted_jobs', deleted_jobs
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_stale_data() FROM PUBLIC, anon;

-- Reschedule cron: worker every 30s (two staggered minute jobs), nightly cleanup
DO $$
BEGIN
  PERFORM cron.unschedule('nightly-cleanup-stale-data');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'nightly-cleanup-stale-data',
  '20 3 * * *',
  $$SELECT public.cleanup_stale_data();$$
);

-- ANALYZE hot tables so the planner picks the new indexes immediately
ANALYZE public.search_console_daily;
ANALYZE public.background_jobs;
ANALYZE public.wordpress_posts;
ANALYZE public.content_changesets;
