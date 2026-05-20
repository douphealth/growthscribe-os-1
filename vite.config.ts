// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://lsuddojjtsfbucrxpndc.supabase.co"),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzdWRkb2pqdHNmYnVjcnhwbmRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDQ2MzEsImV4cCI6MjA5NDMyMDYzMX0.SJZkeN27Ofy_cfc9lNP4lhxE3N6GTPh_8RKgLfmFV28",
      ),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify("lsuddojjtsfbucrxpndc"),
    },
  },
});
