
DELETE FROM public.integration_connections a
USING public.integration_connections b
WHERE a.ctid < b.ctid
  AND a.organization_id = b.organization_id
  AND COALESCE(a.site_id::text, '') = COALESCE(b.site_id::text, '')
  AND a.provider = b.provider;

CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_org_site_provider_uniq
  ON public.integration_connections (organization_id, COALESCE(site_id::text, ''), provider);
