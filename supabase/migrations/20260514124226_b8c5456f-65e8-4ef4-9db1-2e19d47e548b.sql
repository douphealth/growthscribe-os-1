-- Defensive, idempotent reconciliation for background_jobs, job_status, and wordpress_posts uniqueness.

ALTER TABLE public.background_jobs
  ADD COLUMN IF NOT EXISTS items_processed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_items integer,
  ADD COLUMN IF NOT EXISTS error_message text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'completed'
      AND enumtypid = 'public.job_status'::regtype
  ) THEN
    ALTER TYPE public.job_status ADD VALUE 'completed';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS wordpress_posts_site_wp_type_uniq
  ON public.wordpress_posts (site_id, wp_post_id, post_type);
