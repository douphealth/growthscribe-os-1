-- Enable pg_cron + pg_net so we can hit the worker endpoint on a schedule
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Stream background-job changes to the app in realtime so the UI can show
-- queued -> running -> succeeded transitions without polling
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'background_jobs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.background_jobs';
  END IF;
END $$;
ALTER TABLE public.background_jobs REPLICA IDENTITY FULL;