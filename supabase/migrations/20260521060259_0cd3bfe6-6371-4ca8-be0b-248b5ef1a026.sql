
CREATE TABLE IF NOT EXISTS public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_events_org_created ON public.usage_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_type ON public.usage_events(event_type);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins read usage events" ON public.usage_events
  FOR SELECT TO authenticated
  USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Members insert their own usage events" ON public.usage_events
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() AND public.is_org_member(auth.uid(), organization_id));

CREATE TABLE IF NOT EXISTS public.usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  event_type text NOT NULL,
  total_quantity integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, period_month, event_type)
);
CREATE INDEX IF NOT EXISTS idx_usage_counters_org_period ON public.usage_counters(organization_id, period_month DESC);

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read usage counters" ON public.usage_counters
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION public.record_usage_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage_counters (organization_id, period_month, event_type, total_quantity, updated_at)
  VALUES (NEW.organization_id, date_trunc('month', NEW.created_at)::date, NEW.event_type, NEW.quantity, now())
  ON CONFLICT (organization_id, period_month, event_type)
  DO UPDATE SET total_quantity = usage_counters.total_quantity + EXCLUDED.total_quantity,
                updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_usage_event ON public.usage_events;
CREATE TRIGGER trg_record_usage_event
AFTER INSERT ON public.usage_events
FOR EACH ROW EXECUTE FUNCTION public.record_usage_event();
