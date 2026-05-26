
-- Centralized error capture for unhandled exceptions across server fns and routes
CREATE TABLE IF NOT EXISTS public.error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid,
  route text,
  source text NOT NULL DEFAULT 'server',
  level text NOT NULL DEFAULT 'error',
  message text NOT NULL,
  error_stack text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT error_events_level_chk CHECK (level IN ('error','warn','fatal')),
  CONSTRAINT error_events_source_chk CHECK (source IN ('server','client','worker','cron'))
);

CREATE INDEX IF NOT EXISTS idx_error_events_org_created ON public.error_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_request ON public.error_events (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_error_events_level_created ON public.error_events (level, created_at DESC);

ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their error events"
  ON public.error_events FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
  );

CREATE POLICY "Admins can view system error events"
  ON public.error_events FOR SELECT
  TO authenticated
  USING (
    organization_id IS NULL
    AND public.is_admin(auth.uid())
  );

-- Job logs: support filtering by level/time
CREATE INDEX IF NOT EXISTS idx_job_logs_level_created ON public.job_logs (level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_logs_org_created ON public.job_logs (organization_id, created_at DESC);

-- Add request_id to job_logs for correlation across services
ALTER TABLE public.job_logs ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE public.job_logs ADD COLUMN IF NOT EXISTS duration_ms integer;
CREATE INDEX IF NOT EXISTS idx_job_logs_request ON public.job_logs (request_id) WHERE request_id IS NOT NULL;
