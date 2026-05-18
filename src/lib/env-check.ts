// Verifies required Lovable Cloud environment variables are present.
// During SSR, Vite public env can be unavailable even when the server runtime has the
// equivalent values, so accept either the public VITE_* value or the server fallback.

const REQUIRED_VARS = {
  VITE_SUPABASE_URL: ["VITE_SUPABASE_URL", "SUPABASE_URL"],
  VITE_SUPABASE_PUBLISHABLE_KEY: ["VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"],
} as const;

export type RequiredEnvVar = keyof typeof REQUIRED_VARS;

function getEnvValue(name: string): string | undefined {
  switch (name) {
    case "VITE_SUPABASE_URL":
      return import.meta.env.VITE_SUPABASE_URL;
    case "VITE_SUPABASE_PUBLISHABLE_KEY":
      return import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    case "SUPABASE_URL":
      return typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined;
    case "SUPABASE_PUBLISHABLE_KEY":
      return typeof process !== "undefined" ? process.env.SUPABASE_PUBLISHABLE_KEY : undefined;
    default:
      return undefined;
  }
}

function hasAnyEnvValue(names: readonly string[]): boolean {
  return names.some((name) => {
    const value = getEnvValue(name);
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