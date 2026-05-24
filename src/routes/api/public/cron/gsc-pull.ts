import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

// Daily Search Console ingestion. Iterates every connected GSC integration,
// pulls the last 3 days (incremental + handles GSC's reporting lag), and
// upserts per (site, date, query, page). Authenticated via apikey header
// (Supabase publishable key) — same pattern as the worker route.

const GSC_GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";
const ROW_LIMIT = 5000;
const DAYS = 3;

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function pullOne(
  admin: ReturnType<typeof createClient<Database>>,
  conn: { organization_id: string; site_id: string; property: string },
) {
  const lovable = process.env.LOVABLE_API_KEY;
  const gsc = process.env.GOOGLE_SEARCH_CONSOLE_API_KEY;
  if (!lovable || !gsc) throw new Error("GSC connector not configured");

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - DAYS);
  const encoded = encodeURIComponent(conn.property);
  // No delete: rows upsert on (site_id, date, query, page).

  let total = 0;
  let startRow = 0;
  while (true) {
    const res = await fetch(`${GSC_GATEWAY}/webmasters/v3/sites/${encoded}/searchAnalytics/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovable}`,
        "X-Connection-Api-Key": gsc,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: ymd(start),
        endDate: ymd(end),
        dimensions: ["date", "query", "page"],
        rowLimit: ROW_LIMIT,
        startRow,
      }),
    });
    if (!res.ok) throw new Error(`GSC ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      rows?: {
        keys: string[];
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
      }[];
    };
    const rows = json.rows ?? [];
    if (rows.length === 0) break;
    const inserts = rows.map((r) => ({
      organization_id: conn.organization_id,
      site_id: conn.site_id,
      date: r.keys[0],
      query: r.keys[1] ?? "",
      page: r.keys[2] ?? "",
      clicks: Math.round(r.clicks ?? 0),
      impressions: Math.round(r.impressions ?? 0),
      ctr: r.ctr ?? null,
      position: r.position ?? null,
    }));
    for (let i = 0; i < inserts.length; i += 500) {
      const { error } = await admin
        .from("search_console_daily")
        .upsert(inserts.slice(i, i + 500), { onConflict: "site_id,date,query,page" });
      if (error) throw error;
    }
    total += rows.length;
    if (rows.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
    if (startRow > 25000) break; // hard cap per site per tick
  }

  // Refresh 28d aggregates on the site row.
  const since = new Date();
  since.setDate(since.getDate() - 28);
  const { data: agg } = await admin
    .from("search_console_daily")
    .select("clicks,impressions")
    .eq("site_id", conn.site_id)
    .gte("date", ymd(since));
  const totals = (agg ?? []).reduce(
    (a, r) => ({
      clicks: a.clicks + (r.clicks ?? 0),
      impressions: a.impressions + (r.impressions ?? 0),
    }),
    { clicks: 0, impressions: 0 },
  );
  await admin
    .from("sites")
    .update({
      monthly_clicks: totals.clicks,
      monthly_impressions: totals.impressions,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", conn.site_id);
  await admin
    .from("integration_connections")
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq("organization_id", conn.organization_id)
    .eq("site_id", conn.site_id)
    .eq("provider", "gsc");

  return { rows: total, totals };
}

export const Route = createFileRoute("/api/public/cron/gsc-pull")({
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
        if (!url || !service) return new Response("Server not configured", { status: 500 });
        const admin = createClient<Database>(url, service, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: conns, error } = await admin
          .from("integration_connections")
          .select("organization_id, site_id, config")
          .eq("provider", "gsc")
          .eq("status", "connected");
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

        const results: Array<{ site_id: string; ok: boolean; rows?: number; error?: string }> = [];
        for (const c of conns ?? []) {
          const cfg = (c.config ?? {}) as Record<string, unknown>;
          const property = typeof cfg.property === "string" ? cfg.property : null;
          if (!c.site_id || !property) continue;
          try {
            const r = await pullOne(admin, {
              organization_id: c.organization_id,
              site_id: c.site_id,
              property,
            });
            results.push({ site_id: c.site_id, ok: true, rows: r.rows });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            await admin
              .from("integration_connections")
              .update({ last_error: message } as { last_error: string })
              .eq("organization_id", c.organization_id)
              .eq("site_id", c.site_id)
              .eq("provider", "gsc");
            results.push({ site_id: c.site_id, ok: false, error: message });
          }
        }
        const payload: Json = { ok: true, processed: results.length, results } as unknown as Json;
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
