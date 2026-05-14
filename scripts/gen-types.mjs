#!/usr/bin/env node
// Local types generator: regenerates src/integrations/supabase/types.ts from
// the live schema when SUPABASE_ACCESS_TOKEN + VITE_SUPABASE_PROJECT_ID are
// available; otherwise restores from the committed snapshot at
// src/integrations/supabase/types.snapshot.ts so contributors without
// Supabase CLI auth can still typecheck against a known-good schema.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TYPES = resolve("src/integrations/supabase/types.ts");
const SNAPSHOT = resolve("src/integrations/supabase/types.snapshot.ts");

const projectId = process.env.VITE_SUPABASE_PROJECT_ID;
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (projectId && token) {
  const res = spawnSync(
    "supabase",
    ["gen", "types", "typescript", "--project-id", projectId],
    { encoding: "utf8", env: { ...process.env } },
  );
  if (res.status === 0 && res.stdout.trim().length > 0) {
    writeFileSync(TYPES, res.stdout);
    // Refresh the committed snapshot to match.
    writeFileSync(SNAPSHOT, res.stdout);
    console.log("✓ Regenerated types.ts from live schema and updated snapshot.");
    process.exit(0);
  }
  console.error("✖ supabase gen types failed:");
  console.error(res.stderr || res.stdout || `(exit ${res.status})`);
  console.error("Falling back to committed snapshot.");
}

if (!existsSync(SNAPSHOT)) {
  console.error(`✖ No snapshot at ${SNAPSHOT}; cannot fall back.`);
  console.error("  Set SUPABASE_ACCESS_TOKEN + VITE_SUPABASE_PROJECT_ID and retry.");
  process.exit(1);
}

copyFileSync(SNAPSHOT, TYPES);
console.log(
  "✓ Restored types.ts from committed snapshot (set SUPABASE_ACCESS_TOKEN to regenerate).",
);