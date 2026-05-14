#!/usr/bin/env node
// Verifies src/integrations/supabase/types.ts contains required tables and enum values.
// Used in CI to catch stale generated types after migrations.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const TYPES_PATH = resolve("src/integrations/supabase/types.ts");

const REQUIRED_TABLES = [
  "wordpress_posts",
  "background_jobs",
  "integration_connections",
  "organizations",
  "organization_members",
  "sites",
];

const REQUIRED_COLUMNS = [
  "featured_image_url",
  "reading_time",
  "items_processed",
  "total_items",
  "error_message",
];

const REQUIRED_ENUM_VALUES = [
  "sync_running",
  "sync_failed",
  "verifying",
  "stale",
  "completed",
];

if (!existsSync(TYPES_PATH)) {
  console.error(`✖ Missing ${TYPES_PATH}. Run: bun run db:types`);
  process.exit(1);
}

const src = readFileSync(TYPES_PATH, "utf8");
const missing = [];

for (const table of REQUIRED_TABLES) {
  const re = new RegExp(`^\\s+${table}:\\s*\\{`, "m");
  if (!re.test(src)) missing.push(`table ${table}`);
}
for (const col of REQUIRED_COLUMNS) {
  if (!src.includes(col)) missing.push(`column ${col}`);
}
for (const val of REQUIRED_ENUM_VALUES) {
  if (!src.includes(`"${val}"`)) missing.push(`enum value "${val}"`);
}

if (missing.length > 0) {
  console.error("✖ Generated Supabase types are stale. Missing:");
  for (const m of missing) console.error(`  - ${m}`);
  console.error("\nRun: bun run db:types && commit the result.");
  process.exit(1);
}

console.log("✓ Supabase types include all required tables, columns, and enum values.");