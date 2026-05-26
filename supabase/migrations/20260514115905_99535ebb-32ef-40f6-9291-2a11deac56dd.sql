-- Correct first-membership bootstrap with a single security-definer helper

CREATE OR REPLACE FUNCTION public.can_create_initial_org_membership(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = _org_id
      AND o.created_by = _user_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = _org_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_create_initial_org_membership(uuid, uuid) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Self insert own membership on org create" ON public.organization_members;
CREATE POLICY "Self insert own membership on org create"
ON public.organization_members
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.can_create_initial_org_membership(auth.uid(), organization_id)
);