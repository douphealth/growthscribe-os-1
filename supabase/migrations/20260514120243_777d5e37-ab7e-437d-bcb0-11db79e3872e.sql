-- 1. wordpress_posts new columns
ALTER TABLE public.wordpress_posts
  ADD COLUMN IF NOT EXISTS featured_image_url text,
  ADD COLUMN IF NOT EXISTS reading_time integer;

-- 2. Replace dedupe key with (site_id, wp_post_id, post_type)
ALTER TABLE public.wordpress_posts
  DROP CONSTRAINT IF EXISTS wordpress_posts_site_id_wp_post_id_key;
DROP INDEX IF EXISTS public.wordpress_posts_site_wp_uniq;
DROP INDEX IF EXISTS public.idx_wp_posts_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wordpress_posts_site_wp_type_uniq'
  ) THEN
    ALTER TABLE public.wordpress_posts
      ADD CONSTRAINT wordpress_posts_site_wp_type_uniq
      UNIQUE (site_id, wp_post_id, post_type);
  END IF;
END$$;

-- 3. background_jobs progress fields
ALTER TABLE public.background_jobs
  ADD COLUMN IF NOT EXISTS items_processed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_items integer,
  ADD COLUMN IF NOT EXISTS error_message text;

-- 4. site_status: add verifying, sync_running, sync_failed, stale
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'verifying'
                 AND enumtypid = 'public.site_status'::regtype) THEN
    ALTER TYPE public.site_status ADD VALUE 'verifying';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'sync_running'
                 AND enumtypid = 'public.site_status'::regtype) THEN
    ALTER TYPE public.site_status ADD VALUE 'sync_running';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'sync_failed'
                 AND enumtypid = 'public.site_status'::regtype) THEN
    ALTER TYPE public.site_status ADD VALUE 'sync_failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'stale'
                 AND enumtypid = 'public.site_status'::regtype) THEN
    ALTER TYPE public.site_status ADD VALUE 'stale';
  END IF;
END$$;

-- 5. job_status: add completed
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'completed'
                 AND enumtypid = 'public.job_status'::regtype) THEN
    ALTER TYPE public.job_status ADD VALUE 'completed';
  END IF;
END$$;