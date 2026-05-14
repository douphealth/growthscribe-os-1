#!/usr/bin/env node
// Schema-aware verifier for src/integrations/supabase/types.ts.
// Parses the generated Database type and validates that required tables,
// columns, and enum values exist — including the precise enum membership
// for site_status (sync_running/sync_failed/...) and job_status, plus the
// background_jobs columns the WordPress sync job depends on.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const TYPES_PATH = resolve("src/integrations/supabase/types.ts");

if (!existsSync(TYPES_PATH)) {
  console.error(`✖ Missing ${TYPES_PATH}. Run: bun run db:types`);
  process.exit(1);
}

const src = readFileSync(TYPES_PATH, "utf8");
const errors = [];

// --- Helpers --------------------------------------------------------------

/** Extract the body of a `name: { ... }` block via brace counting. */
function extractBlock(source, headerRegex) {
  const m = headerRegex.exec(source);
  if (!m) return null;
  const start = source.indexOf("{", m.index);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  return null;
}

/** Get the Row block of a public table. */
function getTableRow(tableName) {
  const tableBody = extractBlock(
    src,
    new RegExp(`\\b${tableName}:\\s*\\{`, "m"),
  );
  if (!tableBody) return null;
  return extractBlock(tableBody, /\bRow:\s*\{/);
}

/** Parse an enum union like `name: "a" | "b" | "c"` (multi-line) into a Set. */
function getEnumValues(enumName) {
  // Match `enumName:` followed by union of string literals up to the next
  // top-level identifier (a line starting with two-word `name:` at same indent
  // or the closing brace of Enums).
  const re = new RegExp(
    `\\b${enumName}:\\s*((?:\\s*\\|?\\s*"[^"]+")+)`,
    "m",
  );
  const m = re.exec(src);
  if (!m) return null;
  const values = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  return new Set(values);
}

function checkEnum(name, required) {
  const values = getEnumValues(name);
  if (!values) {
    errors.push(`enum ${name} not found in types.ts`);
    return;
  }
  for (const v of required) {
    if (!values.has(v)) errors.push(`enum ${name} missing value "${v}"`);
  }
}

function checkTableColumns(table, required) {
  const row = getTableRow(table);
  if (!row) {
    errors.push(`table ${table} not found in types.ts`);
    return;
  }
  for (const col of required) {
    // Match `colName:` at the start of a line (with leading whitespace).
    const re = new RegExp(`^\\s+${col}\\s*:`, "m");
    if (!re.test(row)) errors.push(`table ${table} missing column "${col}"`);
  }
}

// --- Required schema ------------------------------------------------------

const REQUIRED_TABLES = [
  "wordpress_posts",
  "background_jobs",
  "integration_connections",
  "organizations",
  "organization_members",
  "sites",
];

for (const t of REQUIRED_TABLES) {
  if (!getTableRow(t)) errors.push(`table ${t} not found in types.ts`);
}

// background_jobs columns the WordPress sync job reads/writes.
checkTableColumns("background_jobs", [
  "id",
  "job_type",
  "status",
  "payload",
  "result",
  "error",
  "error_message",
  "items_processed",
  "total_items",
  "started_at",
  "finished_at",
  "organization_id",
  "site_id",
  "created_by",
]);

checkTableColumns("wordpress_posts", [
  "wp_post_id",
  "url",
  "title",
  "status",
  "content_html",
  "featured_image_url",
  "reading_time",
  "synced_at",
]);

// site_status must contain the sync lifecycle values.
checkEnum("site_status", [
  "connected",
  "disconnected",
  "error",
  "pending",
  "verifying",
  "sync_running",
  "sync_failed",
  "stale",
]);

// job_status must contain the lifecycle values used by background_jobs.
checkEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "completed",
]);

// --- Report ---------------------------------------------------------------

if (errors.length > 0) {
  console.error("✖ Generated Supabase types are stale or incomplete:");
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "\nRun `bun run db:types` after applying migrations, then commit the result.",
  );
  process.exit(1);
}

console.log(
  "✓ Supabase types include all required tables, columns, and enum values.",
);