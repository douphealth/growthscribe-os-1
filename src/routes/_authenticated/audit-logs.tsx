import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOrg } from "@/lib/org-context";
import { getAuditLogs } from "@/lib/observability.functions";

export const Route = createFileRoute("/_authenticated/audit-logs")({
  component: Page,
});

function Page() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const fetchLogs = useServerFn(getAuditLogs);
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", orgId],
    queryFn: () => fetchLogs({ data: { organizationId: orgId!, since: "30d", limit: 500 } }),
    enabled: !!orgId,
  });

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Workspace activity and security events. Admin-only, 30-day window."
      />
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : (data ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No audit events recorded yet for this workspace.
            </p>
          ) : (
            <ul className="divide-y">
              {data!.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{a.action}</Badge>
                    {a.resource_type && <span className="font-mono">{a.resource_type}</span>}
                    {a.resource_id && (
                      <span className="font-mono opacity-70">{a.resource_id.slice(0, 8)}</span>
                    )}
                    {a.ip_address && <span>{a.ip_address}</span>}
                    <span>{new Date(a.created_at).toLocaleString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
