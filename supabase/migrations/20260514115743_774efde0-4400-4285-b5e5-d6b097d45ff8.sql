-- Tighten organization-scoped RLS edge cases

DROP POLICY IF EXISTS "Self insert own membership on org create" ON public.organization_members;
CREATE POLICY "Self insert own membership on org create"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = organization_id
      AND o.created_by = auth.uid()
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.organization_members existing
    WHERE existing.organization_id = organization_id
  )
);

DROP POLICY IF EXISTS "Users insert own audit logs" ON public.audit_logs;
CREATE POLICY "Users insert own audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
  actor_id = auth.uid()
  AND (
    organization_id IS NULL
    OR public.is_org_member(auth.uid(), organization_id)
  )
);