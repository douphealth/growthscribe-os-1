import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Public cron endpoint: scheduled by pg_cron. Iterates active sites and
// records a queued background_jobs row for the technical scanner. The actual
// scan runs on the next user visit OR can be triggered by another worker —
// keeps this route fast (<10s) and Worker-friendly.
export const Route = createFileRoute("/api/public/cron/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!apikey || !expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const url = process.env.SUPABASE_URL;
        const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !service) {
          return new Response("Server not configured", { status: 500 });
        }
        const admin = createClient<Database>(url, service, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: sites, error } = await admin
          .from("sites")
          .select("id, organization_id, owner_id, name")
          .eq("status", "active");
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }
        let queued = 0;
        for (const s of sites ?? []) {
          const { error: jobErr } = await admin.from("background_jobs").insert({
            organization_id: s.organization_id,
            site_id: s.id,
            created_by: s.owner_id,
            job_type: "technical.scan",
            payload: { source: "cron", scheduledAt: new Date().toISOString() },
            status: "queued",
          });
          if (!jobErr) queued++;
        }
        return new Response(JSON.stringify({ ok: true, queued, total: sites?.length ?? 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});