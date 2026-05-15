#!/usr/bin/env node
// Regenerates Supabase types into a temp file and fails if it differs from
// the committed src/integrations/supabase/types.ts. Used in CI to catch
// schema drift between migrations and the generated client types.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TYPES_PATH = resolve("src/integrations/supabase/types.ts");
const SNAPSHOT_PATH = resolve("src/integrations/supabase/types.snapshot.ts");
const projectId = process.env.VITE_SUPABASE_PROJECT_ID;
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!projectId) {
  console.error("✖ VITE_SUPABASE_PROJECT_ID is not set; cannot regenerate types.");
  process.exit(1);
}

if (!token) {
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(`✖ No snapshot at ${SNAPSHOT_PATH}; cannot verify types drift.`);
    process.exit(1);
  }
  const committed = readFileSync(TYPES_PATH, "utf8").trim();
  const snapshot = readFileSync(SNAPSHOT_PATH, "utf8").trim();
  if (committed !== snapshot) {
    console.error("✖ Drift detected between types.ts and types.snapshot.ts.");
    console.error("Run `bun run db:types` to restore types.ts from the committed snapshot, or set SUPABASE_ACCESS_TOKEN to verify against the live schema.");
    process.exit(1);
  }
  console.log("✓ types.ts matches types.snapshot.ts (set SUPABASE_ACCESS_TOKEN to verify live schema drift).");
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "sb-types-"));
const out = join(tmp, "types.ts");

const res = spawnSync("supabase", ["gen", "types", "typescript", "--project-id", projectId], {
  encoding: "utf8",
});

if (res.status !== 0) {
  console.error("✖ `supabase gen types` failed:");
  console.error(res.stderr || res.stdout);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}

writeFileSync(out, res.stdout);

const committed = readFileSync(TYPES_PATH, "utf8").trim();
const generated = res.stdout.trim();

if (committed !== generated) {
  console.error("✖ Drift detected between live schema and committed types.ts.");
  console.error(`  Committed: ${TYPES_PATH}`);
  console.error(`  Generated: ${out}`);
  console.error("\nRun `bun run db:types` and commit the updated file.");
  // Leave tmp file in place so CI can upload/inspect it.
  process.exit(1);
}

rmSync(tmp, { recursive: true, force: true });
console.log("✓ Committed types.ts matches the live database schema.");
