import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Architectural invariant: only files in this allow-list may import
// the WordPress write helper `updateWpPost`. Everything else (recommendation
// generators, scoring, dashboards, route components, etc.) must go through
// an approval / auto-apply gate that records to `wp_revisions` first.
//
// If you legitimately need a new caller, add it here AND make sure the new
// site (a) writes a `wp_revisions` row before the push and (b) gates the
// push behind an explicit user approval, an `auto_apply_settings.mode`
// check, or a worker-job that respects those gates.
const ALLOWED_WP_WRITERS = new Set<string>([
  "src/lib/wordpress.server.ts", // defines updateWpPost itself
  "src/lib/auto-apply.server.ts", // snapshots wp_revisions + respects auto_apply_settings
  "src/lib/approvals.functions.ts", // requires a `pending` approval_request
  "src/lib/seo-automation.functions.ts", // gated server fns that build wp_revisions
  "src/lib/technical.functions.ts", // applyWordpressFix: user-invoked single-shot apply
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("Human-in-the-loop guard for WordPress writes", () => {
  const files = walk("src");

  it("only allow-listed modules import updateWpPost", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.replace(/\\/g, "/");
      const src = readFileSync(f, "utf8");
      if (!/\bupdateWpPost\b/.test(src)) continue;
      // Skip the test file itself.
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
      if (!ALLOWED_WP_WRITERS.has(rel)) offenders.push(rel);
    }
    expect(offenders, `Unauthorized WP writers: ${offenders.join(", ")}`).toEqual([]);
  });

  it("recommendation generators never push to WordPress directly", () => {
    const recs = files.filter((f) => /recommendations?\.(functions|server)\.ts$/.test(f));
    expect(recs.length).toBeGreaterThan(0);
    for (const f of recs) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} must not import updateWpPost`).not.toMatch(/\bupdateWpPost\b/);
      expect(src, `${f} must not import wordpress.server`).not.toMatch(
        /from\s+["']\.\/wordpress\.server["']/,
      );
    }
  });

  it("approval handler asserts pending status before pushing to WP", () => {
    const src = readFileSync("src/lib/approvals.functions.ts", "utf8");
    // Defensive double-check: the approve handler must call updateWpPost
    // AND verify the row is still 'pending' (no double-apply).
    expect(src).toMatch(/status\s*!==\s*["']pending["']/);
    expect(src).toMatch(/updateWpPost\(/);
  });

  it("auto-apply writes a wp_revisions snapshot before pushing", () => {
    const src = readFileSync("src/lib/auto-apply.server.ts", "utf8");
    const revIdx = src.indexOf('from("wp_revisions")');
    const updIdx = src.indexOf("updateWpPost(");
    expect(revIdx).toBeGreaterThan(-1);
    expect(updIdx).toBeGreaterThan(-1);
    expect(revIdx, "wp_revisions snapshot must come before updateWpPost").toBeLessThan(updIdx);
  });

  it("rollback path uses wp_revisions to restore prior content", () => {
    const src = readFileSync("src/lib/auto-apply.server.ts", "utf8");
    expect(src).toMatch(/export async function rollbackWpRevision/);
    // Rollback must read the snapshot AND push it back to WP.
    expect(src).toMatch(/from\(["']wp_revisions["']\)/);
    expect(src).toMatch(/updateWpPost\(/);
  });
});