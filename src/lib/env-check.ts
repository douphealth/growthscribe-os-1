// Verifies required Lovable Cloud environment variables are present.
// During SSR, Vite public env can be unavailable even when the server runtime has the
// equivalent values, so accept either the public VITE_* value or the server fallback.

const REQUIRED_VARS = {
  VITE_SUPABASE_URL: ["VITE_SUPABASE_URL", "SUPABASE_URL"],
  VITE_SUPABASE_PUBLISHABLE_KEY: ["VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"],
} as const;

export type RequiredEnvVar = keyof typeof REQUIRED_VARS;

function readProcessEnv(): Record<string, string | undefined> {
  const maybeGlobal = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return maybeGlobal.process?.env ?? {};
}

function hasAnyEnvValue(names: readonly string[]): boolean {
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const processEnv = readProcessEnv();
  return names.some((name) => {
    const value = viteEnv[name] ?? processEnv[name];
    return typeof value === "string" && value.trim() !== "";
  });
}

export function getMissingEnvVars(): RequiredEnvVar[] {
  return (Object.keys(REQUIRED_VARS) as RequiredEnvVar[]).filter(
    (name) => !hasAnyEnvValue(REQUIRED_VARS[name]),
  );
}

export function hasRequiredEnv(): boolean {
  return getMissingEnvVars().length === 0;
}