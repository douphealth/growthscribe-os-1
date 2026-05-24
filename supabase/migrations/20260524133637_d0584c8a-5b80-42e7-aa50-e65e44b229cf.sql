-- Fully idempotent: skips constraints whose column or constraint already
-- exists, or whose column is missing.

CREATE OR REPLACE FUNCTION pg_temp.add_fk(
  _table text, _name text, _col text, _ref_table text, _ref_col text, _on_delete text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=_table AND column_name=_col
  ) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = _name) THEN RETURN; END IF;
  EXECUTE format(
    'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) ON DELETE %s NOT VALID',
    _table, _name, _col, _ref_table, _ref_col, _on_delete
  );
END $$;

CREATE OR REPLACE FUNCTION pg_temp.add_check(
  _table text, _name text, _expr text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name=_table
  ) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = _name) THEN RETURN; END IF;
  EXECUTE format(
    'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
    _table, _name, _expr
  );
END $$;

-- organization_id FKs
DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY[
  'activities','ai_engine_citations','ai_visibility_tests','approval_requests',
  'audit_logs','auto_apply_settings','background_jobs','cluster_gap_briefs',
  'competitor_pages','content_audits','content_briefs','content_changesets',
  'content_recommendations','content_scores','ga4_daily','geo_aeo_assets',
  'integration_connections','integrations','internal_link_opportunities',
  'job_logs','keyword_rankings','lift_measurements','organization_members',
  'page_vitals','playbook_runs','playbooks','post_intents','score_breakdowns',
  'search_console_daily','serp_snapshots','sites','tasks','topical_cluster_pages',
  'topical_clusters','topical_maps','usage_counters','usage_events','wordpress_posts'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    PERFORM pg_temp.add_fk(t, t || '_org_fk', 'organization_id', 'organizations', 'id', 'CASCADE');
  END LOOP;
END $$;

-- site_id FKs
DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY[
  'ai_engine_citations','ai_visibility_tests','approval_requests','background_jobs',
  'cluster_gap_briefs','competitor_pages','content_audits','content_briefs',
  'content_changesets','content_recommendations','content_scores','ga4_daily',
  'geo_aeo_assets','integration_connections','integrations','internal_link_opportunities',
  'keyword_rankings','lift_measurements','page_vitals','playbook_runs','post_intents',
  'score_breakdowns','search_console_daily','serp_snapshots','tasks',
  'topical_cluster_pages','topical_clusters','topical_maps','wordpress_posts'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    PERFORM pg_temp.add_fk(t, t || '_site_fk', 'site_id', 'sites', 'id', 'CASCADE');
  END LOOP;
END $$;

-- post_id FKs (nullable)
DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY[
  'cluster_gap_briefs','content_changesets','content_recommendations','content_scores',
  'geo_aeo_assets','internal_link_opportunities','page_vitals','playbook_runs',
  'post_intents','score_breakdowns','topical_cluster_pages'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    PERFORM pg_temp.add_fk(t, t || '_post_fk', 'post_id', 'wordpress_posts', 'id', 'SET NULL');
  END LOOP;
END $$;

-- Other FKs
SELECT pg_temp.add_fk('content_recommendations','content_recommendations_audit_fk','audit_id','content_audits','id','CASCADE');
SELECT pg_temp.add_fk('content_scores','content_scores_audit_fk','audit_id','content_audits','id','CASCADE');
SELECT pg_temp.add_fk('approval_requests','approval_requests_brief_fk','brief_id','content_briefs','id','SET NULL');
SELECT pg_temp.add_fk('tasks','tasks_brief_fk','brief_id','content_briefs','id','SET NULL');
SELECT pg_temp.add_fk('cluster_gap_briefs','cluster_gap_briefs_brief_fk','brief_id','content_briefs','id','SET NULL');
SELECT pg_temp.add_fk('cluster_gap_briefs','cluster_gap_briefs_task_fk','task_id','tasks','id','SET NULL');
SELECT pg_temp.add_fk('cluster_gap_briefs','cluster_gap_briefs_cluster_fk','cluster_id','topical_clusters','id','CASCADE');
SELECT pg_temp.add_fk('topical_cluster_pages','topical_cluster_pages_cluster_fk','cluster_id','topical_clusters','id','CASCADE');
SELECT pg_temp.add_fk('playbook_runs','playbook_runs_playbook_fk','playbook_id','playbooks','id','CASCADE');
SELECT pg_temp.add_fk('playbook_runs','playbook_runs_changeset_fk','applied_changeset_id','content_changesets','id','SET NULL');
SELECT pg_temp.add_fk('content_changesets','content_changesets_playbook_run_fk','playbook_run_id','playbook_runs','id','SET NULL');
SELECT pg_temp.add_fk('content_changesets','content_changesets_playbook_fk','playbook_id','playbooks','id','SET NULL');
SELECT pg_temp.add_fk('geo_aeo_assets','geo_aeo_assets_changeset_fk','applied_changeset_id','content_changesets','id','SET NULL');
SELECT pg_temp.add_fk('lift_measurements','lift_measurements_changeset_fk','changeset_id','content_changesets','id','CASCADE');
SELECT pg_temp.add_fk('job_logs','job_logs_job_fk','job_id','background_jobs','id','CASCADE');
SELECT pg_temp.add_fk('internal_link_opportunities','ilo_source_post_fk','source_post_id','wordpress_posts','id','CASCADE');
SELECT pg_temp.add_fk('internal_link_opportunities','ilo_target_post_fk','target_post_id','wordpress_posts','id','CASCADE');

-- Unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_background_jobs_idempotency
  ON public.background_jobs (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wordpress_posts_site_wp
  ON public.wordpress_posts (site_id, wp_post_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_serp_snapshots_dim
  ON public.serp_snapshots (site_id, date, keyword, COALESCE(page, ''));
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_engine_citations_dim
  ON public.ai_engine_citations (site_id, week, engine, query);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gsc_daily_dim
  ON public.search_console_daily (site_id, date, query, page, COALESCE(country, ''), COALESCE(device, ''));
CREATE UNIQUE INDEX IF NOT EXISTS uq_topical_cluster_pages_url
  ON public.topical_cluster_pages (cluster_id, url);
CREATE UNIQUE INDEX IF NOT EXISTS uq_geo_aeo_assets_post_kind
  ON public.geo_aeo_assets (post_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_apply_settings_org
  ON public.auto_apply_settings (organization_id);

-- CHECK constraints
SELECT pg_temp.add_check('auto_apply_settings','auto_apply_settings_mode_chk',
  $c$ mode IN ('full','draft','paused') $c$);
SELECT pg_temp.add_check('content_recommendations','content_recommendations_severity_chk',
  $c$ severity IN ('low','medium','high','critical') $c$);
SELECT pg_temp.add_check('content_recommendations','content_recommendations_status_chk',
  $c$ status IN ('open','dismissed','applied','wontfix','snoozed') $c$);
SELECT pg_temp.add_check('cluster_gap_briefs','cluster_gap_briefs_status_chk',
  $c$ status IN ('suggested','accepted','rejected','briefed','published') $c$);
SELECT pg_temp.add_check('internal_link_opportunities','ilo_status_chk',
  $c$ status IN ('suggested','accepted','applied','dismissed') $c$);
SELECT pg_temp.add_check('playbook_runs','playbook_runs_status_chk',
  $c$ status IN ('queued','running','succeeded','failed','cancelled','awaiting_approval') $c$);
SELECT pg_temp.add_check('geo_aeo_assets','geo_aeo_assets_kind_chk',
  $c$ kind IN ('article','faq','howto','breadcrumb','product','organization','person') $c$);
SELECT pg_temp.add_check('ai_engine_citations','ai_engine_citations_engine_chk',
  $c$ engine IN ('chatgpt','gemini','perplexity','claude','copilot') $c$);
SELECT pg_temp.add_check('ai_visibility_tests','ai_visibility_tests_engine_chk',
  $c$ engine IN ('chatgpt','gemini','perplexity','claude','copilot') $c$);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_background_jobs_claim
  ON public.background_jobs (status, priority DESC, next_run_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_background_jobs_org_status
  ON public.background_jobs (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wordpress_posts_site_status_opt
  ON public.wordpress_posts (site_id, status, last_optimized_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_serp_snapshots_site_date
  ON public.serp_snapshots (site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_citations_site_week
  ON public.ai_engine_citations (site_id, week DESC);
CREATE INDEX IF NOT EXISTS idx_content_recommendations_open
  ON public.content_recommendations (organization_id, site_id, status, severity)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_content_changesets_site_applied
  ON public.content_changesets (site_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_logs_job
  ON public.job_logs (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gsc_daily_site_date
  ON public.search_console_daily (site_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_org_status
  ON public.tasks (organization_id, status, due_date NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_activities_org_created
  ON public.activities (organization_id, created_at DESC);
