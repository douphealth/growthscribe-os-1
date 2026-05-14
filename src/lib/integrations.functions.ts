import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type SB = SupabaseClient<Database>;
async function assertMember(supabase: SB, userId: string, organizationId: string) {
  const { data, error } = await supabase
    .from("organization_members")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Not a member of this organization");
}

const GSC_GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";

function gscHeaders(): HeadersInit {
  const lovable = process.env.LOVABLE_API_KEY;
  const gsc = process.env.GOOGLE_SEARCH_CONSOLE_API_KEY;
  if (!lovable) throw new Error("LOVABLE_API_KEY is not configured");
  if (!gsc)
    throw new Error(
      "Google Search Console connector is not linked. Connect it from Integrations.",
    );
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": gsc,
    "Content-Type": "application/json",
  };
}

async function gscFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${GSC_GATEWAY}${path}`, {
    ...init,
    headers: { ...gscHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GSC ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

export const listGscProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { organizationId: string }) =>
    z.object({ organizationId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context.supabase, context.userId, data.organizationId);
    try {
      const json = (await gscFetch(`/webmasters/v3/sites`)) as {
        siteEntry?: { siteUrl: string; permissionLevel: string }[];
      };
      const entries = json.siteEntry ?? [];
      return {
        ok: true as const,
        properties: entries.map((e) => ({
          siteUrl: e.siteUrl,
          permissionLevel: e.permissionLevel,
        })),
      };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message, properties: [] };
    }
  });

const gscInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  property: z.string().trim().min(4).max(300),
});

export const saveGscProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => gscInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    await supabase
      .from("integration_connections")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("provider", "gsc");
    const { error } = await supabase.from("integration_connections").insert({
      organization_id: data.organizationId,
      site_id: data.siteId,
      provider: "gsc",
      status: "connected",
      created_by: userId,
      config: { property: data.property } as Json,
    });
    if (error) throw error;
    await supabase
      .from("sites")
      .update({ gsc_property: data.property })
      .eq("id", data.siteId)
      .eq("organization_id", data.organizationId);
    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "integration.gsc.connected",
      title: "Search Console linked",
      description: data.property,
      link: "/integrations",
    });
    return { ok: true };
  });

const pullGscInput = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  days: z.number().int().min(1).max(90).default(28),
});

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export const pullSearchConsole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => pullGscInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);

    const { data: site, error: siteErr } = await supabase
      .from("sites")
      .select("id, gsc_property")
      .eq("id", data.siteId)
      .eq("organization_id", data.organizationId)
      .maybeSingle();
    if (siteErr) throw siteErr;
    if (!site?.gsc_property) throw new Error("Save a GSC property URL first.");

    const property = site.gsc_property;
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - data.days);

    const { data: job, error: jobErr } = await supabase
      .from("background_jobs")
      .insert({
        organization_id: data.organizationId,
        site_id: data.siteId,
        created_by: userId,
        job_type: "gsc.pull",
        status: "running",
        started_at: new Date().toISOString(),
        payload: { property, days: data.days } as Json,
      })
      .select("id")
      .single();
    if (jobErr) throw jobErr;
    const jobId = job.id;

    try {
      let totalRows = 0;
      let startRow = 0;
      const rowLimit = 5000;
      const encoded = encodeURIComponent(property);
      // delete prior window to keep idempotent
      await supabase
        .from("search_console_daily")
        .delete()
        .eq("site_id", data.siteId)
        .eq("organization_id", data.organizationId)
        .gte("date", ymd(start));

      while (true) {
        const body = {
          startDate: ymd(start),
          endDate: ymd(end),
          dimensions: ["date", "query", "page"],
          rowLimit,
          startRow,
        };
        const json = (await gscFetch(
          `/webmasters/v3/sites/${encoded}/searchAnalytics/query`,
          { method: "POST", body: JSON.stringify(body) },
        )) as {
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
          organization_id: data.organizationId,
          site_id: data.siteId,
          date: r.keys[0],
          query: r.keys[1] ?? null,
          page: r.keys[2] ?? null,
          clicks: Math.round(r.clicks ?? 0),
          impressions: Math.round(r.impressions ?? 0),
          ctr: r.ctr ?? null,
          position: r.position ?? null,
        }));

        for (let i = 0; i < inserts.length; i += 500) {
          const chunk = inserts.slice(i, i + 500);
          const { error: insErr } = await supabase
            .from("search_console_daily")
            .insert(chunk);
          if (insErr) throw insErr;
        }

        totalRows += rows.length;
        await supabase
          .from("background_jobs")
          .update({ items_processed: totalRows })
          .eq("id", jobId);
        if (rows.length < rowLimit) break;
        startRow += rowLimit;
      }

      // Refresh aggregates on the site (last 28d totals)
      const since = new Date();
      since.setDate(since.getDate() - 28);
      const { data: agg } = await supabase
        .from("search_console_daily")
        .select("clicks,impressions")
        .eq("site_id", data.siteId)
        .gte("date", ymd(since));
      const totals = (agg ?? []).reduce(
        (acc, r) => ({
          clicks: acc.clicks + (r.clicks ?? 0),
          impressions: acc.impressions + (r.impressions ?? 0),
        }),
        { clicks: 0, impressions: 0 },
      );

      await supabase
        .from("sites")
        .update({
          monthly_clicks: totals.clicks,
          monthly_impressions: totals.impressions,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", data.siteId);

      await supabase
        .from("integration_connections")
        .update({ last_synced_at: new Date().toISOString(), last_error: null })
        .eq("organization_id", data.organizationId)
        .eq("site_id", data.siteId)
        .eq("provider", "gsc");

      await supabase
        .from("background_jobs")
        .update({
          status: "completed",
          finished_at: new Date().toISOString(),
          total_items: totalRows,
          items_processed: totalRows,
          result: { rows: totalRows, totals } as Json,
        })
        .eq("id", jobId);

      await supabase.from("activities").insert({
        organization_id: data.organizationId,
        owner_id: userId,
        type: "integration.gsc.synced",
        title: "Search Console synced",
        description: `${totalRows.toLocaleString()} rows · ${totals.clicks.toLocaleString()} clicks · ${totals.impressions.toLocaleString()} impressions (28d)`,
        link: "/integrations",
      });

      return { ok: true as const, rows: totalRows, totals };
    } catch (err) {
      const msg = (err as Error).message;
      await supabase
        .from("background_jobs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: msg,
        })
        .eq("id", jobId);
      await supabase
        .from("integration_connections")
        .update({ last_error: msg })
        .eq("organization_id", data.organizationId)
        .eq("site_id", data.siteId)
        .eq("provider", "gsc");
      throw err;
    }
  });

const ga4Input = z.object({
  organizationId: z.string().uuid(),
  siteId: z.string().uuid(),
  propertyId: z.string().trim().min(3).max(80),
});

export const saveGa4Property = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ga4Input.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, userId, data.organizationId);
    await supabase
      .from("integration_connections")
      .delete()
      .eq("organization_id", data.organizationId)
      .eq("site_id", data.siteId)
      .eq("provider", "ga4");
    const { error } = await supabase.from("integration_connections").insert({
      organization_id: data.organizationId,
      site_id: data.siteId,
      provider: "ga4",
      status: "connected",
      created_by: userId,
      config: { property_id: data.propertyId } as Json,
    });
    if (error) throw error;
    await supabase
      .from("sites")
      .update({ ga4_property_id: data.propertyId })
      .eq("id", data.siteId)
      .eq("organization_id", data.organizationId);
    await supabase.from("activities").insert({
      organization_id: data.organizationId,
      owner_id: userId,
      type: "integration.ga4.connected",
      title: "GA4 linked",
      description: data.propertyId,
      link: "/integrations",
    });
    return { ok: true };
  });
