-- Schedule GSC daily ingestion at 04:30 UTC every day.
SELECT cron.unschedule('daily-gsc-pull') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-gsc-pull'
);

SELECT cron.schedule(
  'daily-gsc-pull',
  '30 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://growthscribe-os.lovable.app/api/public/cron/gsc-pull',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzdWRkb2pqdHNmYnVjcnhwbmRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDQ2MzEsImV4cCI6MjA5NDMyMDYzMX0.SJZkeN27Ofy_cfc9lNP4lhxE3N6GTPh_8RKgLfmFV28'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);