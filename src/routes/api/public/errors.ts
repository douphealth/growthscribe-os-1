import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Public endpoint for client-side error reports. Hard caps on body sizes
// keep the table small and protect against floods. Best-effort; never
// returns useful detail to clients.
const ErrorReportSchema = z.object({
  request_id: z.string().min(1).max(64).optional(),
  organization_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  route: z.string().max(512).optional(),
  level: z.enum(["error", "warn", "fatal"]).optional(),
  message: z.string().min(1).max(2000),
  error_stack: z.string().max(8000).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const BatchSchema = z.object({
  events: z.array(ErrorReportSchema).min(1).max(20),
});

export const Route = createFileRoute("/api/public/errors")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const json = await request.json().catch(() => null);
          const parsed = BatchSchema.safeParse(json);
          if (!parsed.success) {
            return new Response(JSON.stringify({ ok: false }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const rows = parsed.data.events.map((e) => ({
            request_id: e.request_id ?? null,
            organization_id: e.organization_id ?? null,
            user_id: e.user_id ?? null,
            route: e.route ?? null,
            source: "client" as const,
            level: e.level ?? "error",
            message: e.message,
            error_stack: e.error_stack ?? null,
            context: (e.context ?? {}) as never,
          }));
          const { error } = await supabaseAdmin.from("error_events").insert(rows);
          if (error) {
            return new Response(JSON.stringify({ ok: false }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ ok: true, accepted: rows.length }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch {
          return new Response(JSON.stringify({ ok: false }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});