create table if not exists public.page_vitals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  site_id uuid not null,
  post_id uuid,
  url text not null,
  strategy text not null check (strategy in ('mobile','desktop')),
  performance_score integer,
  lcp_ms integer,
  inp_ms integer,
  cls numeric,
  ttfb_ms integer,
  fcp_ms integer,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

create unique index if not exists page_vitals_unique
  on public.page_vitals (site_id, url, strategy);
create index if not exists page_vitals_org_idx
  on public.page_vitals (organization_id, site_id);
create index if not exists page_vitals_post_idx
  on public.page_vitals (post_id);

alter table public.page_vitals enable row level security;

drop policy if exists "Org members page_vitals" on public.page_vitals;
create policy "Org members page_vitals"
  on public.page_vitals for all
  to authenticated
  using (public.is_org_member(auth.uid(), organization_id))
  with check (public.is_org_member(auth.uid(), organization_id));

do $$
begin
  if exists (select 1 from cron.job where jobname = 'growthscribe-vitals-daily') then
    perform cron.unschedule('growthscribe-vitals-daily');
  end if;
end$$;

select cron.schedule(
  'growthscribe-vitals-daily',
  '0 5 * * *',
  $$
  insert into public.background_jobs (organization_id, site_id, created_by, job_type, status, payload)
  select s.organization_id, s.id, s.owner_id, 'vitals.refresh', 'queued', jsonb_build_object('limit', 10)
  from public.sites s
  where s.status in ('connected','sync_running');
  $$
);