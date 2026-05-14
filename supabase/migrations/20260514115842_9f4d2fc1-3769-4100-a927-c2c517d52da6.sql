-- Avoid recursive RLS in organization_members first-membership bootstrap policy

CREATE OR REPLACE FUNCTION public.org_has_no_members(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = _org_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public.org_has_no_members(uuid) FROM PUBLIC, anon, authenticated;

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
  AND public.org_has_no_members(organization_id)
);