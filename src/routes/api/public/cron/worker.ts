import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  auditHtml,
  buildFindings,
  runPageSpeed,
  psiFindings,
  SCAN_CATEGORIES,
} from "@/lib/technical.functions";
import {
  runWpVerify,
  runWpSync,
  runContentAudit,
  runBriefGenerate,
  runAiVisibility,
  runGscImport,
  runGa4Import,
  runVitalsRefresh,
  runCrawlSite,
  runAuditApply,
  runSerpTrack,
  runTopicalGapFill,
  type JobRow,
} from "@/lib/worker-jobs.server";

// Background job worker. Drains the `background_jobs` queue. Triggered every
// minute by pg_cron (and safe to invoke manually). Atomically claims jobs by
// flipping status `queued` -> `running` (lost-update tolerant via the WHERE
// clause), runs the dispatcher, and writes the result back.

const MAX_JOBS_PER_TICK = 10;
const MAX_PARALLEL = 5;
const JOB_TIMEOUT_MS = 90_000;
const MAX_RUNNING_PER_ORG = 3;
const BACKOFF_BASE_SECONDS = 30;

type Admin = ReturnType<typeof createClient<Database>>;

async function runTechnicalScanJob(
  admin: Admin,
  job: { organization_id: string; site_id: string | null; payload: unknown },
) {
  if (!job.site_id) throw new Error("technical.scan requires site_id");
  const limit =
    typeof (job.payload as { limit?: number })?.limit === "number"
      ? Math.min(50, Math.max(1, (job.payload as { limit: number }).limit))
      : 20;

  const { data: posts, error: pErr } = await admin
    .from("wordpress_posts")
    .select("id, url, title, content_html, modified_at")
    .eq("organization_id", job.organization_id)
    .eq("site_id", job.site_id)
    .eq("status", "publish")
    .order("modified_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (pErr) throw pErr;
  if (!posts || posts.length === 0) {
    return { scanned: 0, findings: 0, message: "no posts" };
  }

  await admin
    .from("content_recommendations")
    .delete()
    .eq("organization_id", job.organization_id)
    .eq("site_id", job.site_id)
    .eq("status", "open")
    .in("category", SCAN_CATEGORIES);

  const findings: Array<{
    organization_id: string;
    site_id: string;
    post_id: string;
    category: string;
    severity: string;
    title: string;
    detail: string;
    suggested_action: string | null;
    status: string;
  }> = [];

  let scanned = 0;
  for (const p of posts) {
    if (!p.content_html || !p.url) continue;
    const audit = auditHtml(p.content_html, p.url);
    for (const f of buildFindings(audit)) {
      findings.push({
        organization_id: job.organization_id,
        site_id: job.site_id,
        post_id: p.id,
        category: f.category,
        severity: f.severity,
        title: `${f.title} \u2014 ${p.title ?? p.url}`,
        detail: f.detail,
        suggested_action: f.suggested_action,
        status: "open",
      });
    }
    scanned++;
  }

  const psiTargets = posts
    .slice(0, 3)
    .map((p) => p.url)
    .filter(Boolean) as string[];
  for (const url of psiTargets) {
    for (const strategy of ["mobile", "desktop"] as const) {
      const psi = await runPageSpeed(url, strategy);
      const post = posts.find((p) => p.url === url);
      for (const f of psiFindings(psi)) {
        findings.push({
          organization_id: job.organization_id,
          site_id: job.site_id,
          post_id: post?.id ?? posts[0].id,
          category: f.category,
          severity: f.severity,
          title: `${f.title} \u2014 ${post?.title ?? url}`,
          detail: f.detail,
          suggested_action: f.suggested_action,
          status: "open",
        });
      }
    }
  }

  if (findings.length > 0) {
    const { error } = await admin.from("content_recommendations").insert(findings);
    if (error) throw error;
  }

  return { scanned, findings: findings.length };
}

async function dispatch(
  admin: Admin,
  job: JobRow,
) {
  switch (job.job_type) {
    case "technical.scan":
      return runTechnicalScanJob(admin, job);
    case "wp_verify":
      return runWpVerify(admin, job);
    case "wp_sync":
    case "wordpress.sync":
      return runWpSync(admin, job);
    case "content_audit":
      return runContentAudit(admin, job);
    case "brief_generate":
      return runBriefGenerate(admin, job);
    case "ai_visibility":
      return runAiVisibility(admin, job);
    case "gsc_import":
    case "gsc.pull":
      return runGscImport(admin, job);
    case "ga4_import":
      return runGa4Import(admin, job);
    case "vitals.refresh":
    case "vitals_refresh":
      return runVitalsRefresh(admin, job);
    case "crawl.site":
    case "crawl_site":
      return runCrawlSite(admin, job);
    case "audit_apply":
      return runAuditApply(admin, job);
    case "serp.track":
      return runSerpTrack(admin, job);
    case "topical.gap_fill":
      return runTopicalGapFill(admin, job);
    default:
      throw new Error(`Unknown job_type: ${job.job_type}`);
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Job timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export const Route = createFileRoute("/api/public/cron/worker")({
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

        // Reap stuck `running` jobs older than 10 minutes back to failed.
        const stuckCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
        await admin
          .from("background_jobs")
          .update({
            status: "queued",
            locked_at: null,
            locked_by: null,
            last_error: "reaped: worker did not finish within 10 minutes",
            finished_at: new Date().toISOString(),
          })
          .eq("status", "running")
          .lt("started_at", stuckCutoff);

        const workerId = `worker-${crypto.randomUUID().slice(0, 8)}`;
        const results: Array<{ id: string; status: string; error?: string }> = [];

        // Atomic batch claim using SKIP LOCKED — no races, no per-org probe.
        const { data: claimedJobs, error: cErr } = await admin.rpc("claim_jobs", {
          _worker_id: workerId,
          _max_jobs: MAX_JOBS_PER_TICK,
          _max_per_org: MAX_RUNNING_PER_ORG,
        });
        if (cErr) {
          return new Response(JSON.stringify({ error: cErr.message }), { status: 500 });
        }

        // Execute phase: run claimed jobs in parallel batches.
        const runJob = async (c: NonNullable<typeof claimedJobs>[number]) => {
          await admin.from("job_logs").insert({
            job_id: c.id,
            organization_id: c.organization_id,
            level: "info",
            message: `Job started (attempt ${c.retry_count + 1}/${c.max_retries + 1})`,
            metadata: { job_type: c.job_type, worker_id: workerId },
          });

          try {
            const result = await withTimeout(dispatch(admin, c), JOB_TIMEOUT_MS);
            await admin
              .from("background_jobs")
              .update({
                status: "succeeded",
                finished_at: new Date().toISOString(),
                locked_at: null,
                locked_by: null,
                result: result as never,
              })
              .eq("id", c.id);
            await admin.from("job_logs").insert({
              job_id: c.id,
              organization_id: c.organization_id,
              level: "info",
              message: "Job succeeded",
              metadata: { result: result as never },
            });
            await admin.from("activities").insert({
              organization_id: c.organization_id,
              owner_id: c.created_by,
              type: c.job_type,
              title: `${c.job_type} completed`,
              description: JSON.stringify(result).slice(0, 240),
              link: "/technical",
            });
            results.push({ id: c.id, status: "succeeded" });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            const nextAttempt = c.retry_count + 1;
            const willRetry = nextAttempt <= c.max_retries;
            if (willRetry) {
              const delayMs = BACKOFF_BASE_SECONDS * 1000 * Math.pow(2, c.retry_count);
              await admin
                .from("background_jobs")
                .update({
                  status: "queued",
                  retry_count: nextAttempt,
                  last_error: message,
                  next_run_at: new Date(Date.now() + delayMs).toISOString(),
                  locked_at: null,
                  locked_by: null,
                })
                .eq("id", c.id);
              await admin.from("job_logs").insert({
                job_id: c.id,
                organization_id: c.organization_id,
                level: "warn",
                message: `Job failed, will retry in ${Math.round(delayMs / 1000)}s`,
                metadata: { error: message, attempt: nextAttempt },
              });
              results.push({ id: c.id, status: "retry", error: message });
            } else {
              await admin
                .from("background_jobs")
                .update({
                  status: "failed",
                  finished_at: new Date().toISOString(),
                  error: message,
                  last_error: message,
                  locked_at: null,
                  locked_by: null,
                })
                .eq("id", c.id);
              await admin.from("job_logs").insert({
                job_id: c.id,
                organization_id: c.organization_id,
                level: "error",
                message: "Job permanently failed after max retries",
                metadata: { error: message, attempts: nextAttempt },
              });
              results.push({ id: c.id, status: "failed", error: message });
            }
          }
        };

        for (let i = 0; i < claimedJobs.length; i += MAX_PARALLEL) {
          const batch = claimedJobs.slice(i, i + MAX_PARALLEL);
          await Promise.allSettled(batch.map(runJob));
        }

        return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
