-- Schedule the background worker to drain queued jobs every minute
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'growthscribe-worker-tick') THEN
    PERFORM cron.unschedule('growthscribe-worker-tick');
  END IF;
END$$;

SELECT cron.schedule(
  'growthscribe-worker-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://growthscribe-os.lovable.app/api/public/cron/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzdWRkb2pqdHNmYnVjcnhwbmRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDQ2MzEsImV4cCI6MjA5NDMyMDYzMX0.SJZkeN27Ofy_cfc9lNP4lhxE3N6GTPh_8RKgLfmFV28'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Stream job log updates to the app in realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'job_logs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.job_logs';
  END IF;
END$$;
ALTER TABLE public.job_logs REPLICA IDENTITY FULL;