GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, uuid, public.org_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.org_has_no_members(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_create_initial_org_membership(uuid, uuid) TO authenticated, anon;