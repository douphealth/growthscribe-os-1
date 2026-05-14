
ALTER TABLE public.wordpress_posts
  ADD COLUMN IF NOT EXISTS post_type text NOT NULL DEFAULT 'post',
  ADD COLUMN IF NOT EXISTS content_text text,
  ADD COLUMN IF NOT EXISTS seo_score integer,
  ADD COLUMN IF NOT EXISTS aeo_score integer,
  ADD COLUMN IF NOT EXISTS geo_score integer,
  ADD COLUMN IF NOT EXISTS freshness_score integer,
  ADD COLUMN IF NOT EXISTS recommended_action text;

CREATE UNIQUE INDEX IF NOT EXISTS wordpress_posts_site_wp_uniq
  ON public.wordpress_posts (site_id, wp_post_id);

CREATE INDEX IF NOT EXISTS wordpress_posts_org_modified_idx
  ON public.wordpress_posts (organization_id, modified_at DESC);
