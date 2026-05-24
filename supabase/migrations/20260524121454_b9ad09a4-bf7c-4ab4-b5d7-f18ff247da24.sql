
-- 1) Revoke EXECUTE on SECURITY DEFINER helper functions from anon (and PUBLIC).
--    These are only meant to be called from RLS policies / server code on behalf
--    of authenticated users.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.has_org_role(uuid, uuid, org_role)',
    'public.is_org_admin(uuid, uuid)',
    'public.is_org_member(uuid, uuid)',
    'public.org_has_no_members(uuid)',
    'public.can_create_initial_org_membership(uuid, uuid)',
    'public.has_role(uuid, app_role)',
    'public.is_admin(uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- 2) Realtime authorization: restrict channel subscriptions to org members.
--    Channel topics must be named like 'jobs-<organization_id>-...' so we can
--    parse the org id from the topic and check membership.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can read realtime jobs topics" ON realtime.messages;
CREATE POLICY "Org members can read realtime jobs topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() LIKE 'jobs-%'
  AND public.is_org_member(
    auth.uid(),
    NULLIF(split_part(realtime.topic(), '-', 2), '')::uuid
  )
);
