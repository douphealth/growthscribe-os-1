import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/recommendations")({
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader
        title="Recommendations"
        description="Prioritized improvements: refresh, merge, expand, internal linking."
      />
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          This module is part of the GrowthScribe OS roadmap and is being wired up. The data model,
          RLS, and server functions are already in place.
        </CardContent>
      </Card>
    </>
  );
}
