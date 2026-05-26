import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Keep Vitest fast and isolated from the Playwright E2E suite under /e2e.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", ".output", "e2e/**"],
    environment: "node",
  },
});