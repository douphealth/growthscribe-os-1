// Server-only daily SERP tracker. Pulls latest GSC data for tracked keywords
// and writes one `serp_snapshots` row per keyword per day. Detects significant
// position deltas (>= 3 places) and writes activities.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;
type JobLike = {
  id: string;
  organization_id: string;
  site_id: string | null;
  created_by: string;
  payload: unknown;
};

export async function runSerpTrack(admin: Admin, job: JobLike) {
  if (!job.site_id) throw new Error("serp.track requires site_id");

  const { data: conn } = await admin
    .from("integration_connections")
    .select("status, config")
    .eq("organization_id", job.organization_id)
    .eq("site_id", job.site_id)
    .eq("provider", "gsc")
    .maybeSingle();
  if (!conn || conn.status !== "connected") throw new Error("GSC not connected");
  const property = (conn.config as { property?: string } | null)?.property;
  if (!property) throw new Error("GSC property missing");

  const lovable = process.env.LOVABLE_API_KEY;
  const gsc = process.env.GOOGLE_SEARCH_CONSOLE_API_KEY;
  if (!lovable || !gsc) throw new Error("GSC secrets missing");

  // Top 100 keywords by impressions over last 28d
  const since = new Date();
  since.setDate(since.getDate() - 28);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const topQ = await fetch(
    `https://connector-gateway.lovable.dev/google_search_console/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovable}`,
        "X-Connection-Api-Key": gsc,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: ymd(since),
        endDate: ymd(new Date()),
        dimensions: ["query"],
        rowLimit: 100,
      }),
    },
  );
  if (!topQ.ok) throw new Error(`GSC top queries ${topQ.status}`);
  const topJson = (await topQ.json()) as {
    rows?: Array<{ keys: string[]; clicks: number; impressions: number; position: number }>;
  };
  const keywords = (topJson.rows ?? []).map((r) => r.keys[0]).filter(Boolean);
  if (keywords.length === 0) return { tracked: 0 };

  // Yesterday's per-keyword position
  const day = new Date();
  day.setDate(day.getDate() - 2);
  const dayEnd = new Date();
  dayEnd.setDate(dayEnd.getDate() - 1);
  const dailyRes = await fetch(
    `https://connector-gateway.lovable.dev/google_search_console/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovable}`,
        "X-Connection-Api-Key": gsc,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: ymd(day),
        endDate: ymd(dayEnd),
        dimensions: ["query", "page"],
        rowLimit: 1000,
      }),
    },
  );
  if (!dailyRes.ok) throw new Error(`GSC daily ${dailyRes.status}`);
  const dailyJson = (await dailyRes.json()) as {
    rows?: Array<{ keys: string[]; clicks: number; impressions: number; position: number }>;
  };

  const kwSet = new Set(keywords);
  // best (lowest pos) row per keyword
  const best = new Map<string, { page: string; position: number; clicks: number; impressions: number }>();
  for (const r of dailyJson.rows ?? []) {
    const [q, p] = r.keys;
    if (!kwSet.has(q)) continue;
    const prev = best.get(q);
    if (!prev || (r.position ?? 999) < prev.position) {
      best.set(q, { page: p ?? "", position: r.position ?? 0, clicks: r.clicks ?? 0, impressions: r.impressions ?? 0 });
    }
  }

  const today = ymd(dayEnd);
  const rows = Array.from(best.entries()).map(([keyword, v]) => ({
    organization_id: job.organization_id,
    site_id: job.site_id!,
    keyword,
    page: v.page,
    position: v.position,
    clicks: v.clicks,
    impressions: v.impressions,
    date: today,
    source: "gsc",
  }));
  if (rows.length === 0) return { tracked: 0 };

  await admin
    .from("serp_snapshots")
    .upsert(rows, { onConflict: "organization_id,site_id,keyword,date" });

  // Delta vs 7 days ago
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 8);
  const { data: priors } = await admin
    .from("serp_snapshots")
    .select("keyword, position")
    .eq("site_id", job.site_id)
    .eq("date", ymd(weekAgo));
  const priorMap = new Map((priors ?? []).map((p) => [p.keyword, Number(p.position ?? 0)]));
  const activities: Array<{
    organization_id: string;
    owner_id: string;
    type: string;
    title: string;
    description: string;
    link: string;
  }> = [];
  for (const r of rows) {
    const prev = priorMap.get(r.keyword);
    if (!prev) continue;
    const delta = prev - r.position;
    if (Math.abs(delta) >= 3) {
      activities.push({
        organization_id: job.organization_id,
        owner_id: job.created_by,
        type: "serp.delta",
        title: `${r.keyword}: ${delta > 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(1)} positions`,
        description: `${prev.toFixed(1)} → ${r.position.toFixed(1)} for ${r.page}`,
        link: "/optimization",
      });
    }
  }
  if (activities.length > 0) await admin.from("activities").insert(activities);
  return { tracked: rows.length, deltas: activities.length };
}