
CREATE TABLE public.rollouts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  site_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  current_stage text NOT NULL DEFAULT 'dry_run',
  total_count integer NOT NULL DEFAULT 0,
  applied_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  rolled_back_count integer NOT NULL DEFAULT 0,
  regression_threshold_pct numeric NOT NULL DEFAULT 15,
  baseline_clicks integer,
  baseline_captured_at timestamptz,
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rollouts_org_site ON public.rollouts(organization_id, site_id, created_at DESC);

ALTER TABLE public.rollouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members rollouts read" ON public.rollouts
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org members rollouts write" ON public.rollouts
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE TRIGGER trg_rollouts_updated_at
  BEFORE UPDATE ON public.rollouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.rollout_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rollout_id uuid NOT NULL REFERENCES public.rollouts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  recommendation_id uuid,
  post_id uuid,
  stage text NOT NULL DEFAULT 'dry_run',
  status text NOT NULL DEFAULT 'pending',
  changeset_id uuid,
  job_id uuid,
  error text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rollout_items_rollout ON public.rollout_items(rollout_id);
CREATE INDEX idx_rollout_items_status ON public.rollout_items(rollout_id, status);

ALTER TABLE public.rollout_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members rollout_items read" ON public.rollout_items
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org members rollout_items write" ON public.rollout_items
  FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));
