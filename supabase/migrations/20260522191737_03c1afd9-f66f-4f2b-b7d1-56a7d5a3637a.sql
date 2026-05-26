-- Playbooks: reusable editorial recipes
CREATE TABLE public.playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  target_intent text,
  asset_blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  scoring_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_playbooks_org ON public.playbooks(organization_id);
ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members playbooks" ON public.playbooks
  FOR ALL TO authenticated
  USING (is_org_member(auth.uid(), organization_id))
  WITH CHECK (is_org_member(auth.uid(), organization_id));
CREATE TRIGGER playbooks_updated BEFORE UPDATE ON public.playbooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Playbook runs: one row per (playbook, post) application
CREATE TABLE public.playbook_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  playbook_id uuid NOT NULL,
  post_id uuid,
  status text NOT NULL DEFAULT 'queued',
  proposed_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by uuid,
  applied_changeset_id uuid,
  error text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_playbook_runs_org ON public.playbook_runs(organization_id);
CREATE INDEX idx_playbook_runs_playbook ON public.playbook_runs(playbook_id);
ALTER TABLE public.playbook_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members playbook_runs" ON public.playbook_runs
  FOR ALL TO authenticated
  USING (is_org_member(auth.uid(), organization_id))
  WITH CHECK (is_org_member(auth.uid(), organization_id));
CREATE TRIGGER playbook_runs_updated BEFORE UPDATE ON public.playbook_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Content changesets: immutable before/after of every applied edit
CREATE TABLE public.content_changesets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  post_id uuid,
  wp_post_id bigint,
  source text NOT NULL,
  playbook_id uuid,
  playbook_run_id uuid,
  asset_blocks_added jsonb NOT NULL DEFAULT '[]'::jsonb,
  before_hash text,
  after_hash text,
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_by uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_changesets_org ON public.content_changesets(organization_id);
CREATE INDEX idx_changesets_post ON public.content_changesets(post_id);
CREATE INDEX idx_changesets_applied_at ON public.content_changesets(applied_at DESC);
ALTER TABLE public.content_changesets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members changesets read" ON public.content_changesets
  FOR SELECT TO authenticated USING (is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org members changesets insert" ON public.content_changesets
  FOR INSERT TO authenticated WITH CHECK (is_org_member(auth.uid(), organization_id) AND applied_by = auth.uid());

-- Lift measurements: attributed performance deltas per changeset
CREATE TABLE public.lift_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  changeset_id uuid NOT NULL,
  window_days integer NOT NULL,
  measured_at timestamptz NOT NULL DEFAULT now(),
  baseline_clicks numeric,
  baseline_impressions numeric,
  baseline_position numeric,
  post_clicks numeric,
  post_impressions numeric,
  post_position numeric,
  clicks_delta numeric,
  impressions_delta numeric,
  position_delta numeric,
  UNIQUE(changeset_id, window_days)
);
CREATE INDEX idx_lift_org ON public.lift_measurements(organization_id);
CREATE INDEX idx_lift_changeset ON public.lift_measurements(changeset_id);
ALTER TABLE public.lift_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members lift read" ON public.lift_measurements
  FOR SELECT TO authenticated USING (is_org_member(auth.uid(), organization_id));

-- Post intents: AI-classified intent per wordpress post
CREATE TABLE public.post_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  post_id uuid NOT NULL UNIQUE,
  intent text NOT NULL,
  confidence numeric,
  rationale text,
  classified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_post_intents_org ON public.post_intents(organization_id);
ALTER TABLE public.post_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members post_intents" ON public.post_intents
  FOR ALL TO authenticated
  USING (is_org_member(auth.uid(), organization_id))
  WITH CHECK (is_org_member(auth.uid(), organization_id));