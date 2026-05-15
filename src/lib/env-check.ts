// Verifies required Supabase environment variables are present in the browser bundle.
// Returns the list of missing VITE_* vars so the UI can render a clear error.

const REQUIRED_VARS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;

export type RequiredEnvVar = (typeof REQUIRED_VARS)[number];

export function getMissingEnvVars(): RequiredEnvVar[] {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  return REQUIRED_VARS.filter((name) => {
    const v = env[name];
    return !v || v.trim() === "";
  });
}

export function hasRequiredEnv(): boolean {
  return getMissingEnvVars().length === 0;
}