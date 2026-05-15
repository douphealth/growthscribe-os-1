import { AlertTriangle } from "lucide-react";
import type { RequiredEnvVar } from "@/lib/env-check";

export function MissingEnvScreen({ missing }: { missing: RequiredEnvVar[] }) {
  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="bg-mesh absolute inset-0 -z-10 opacity-60" aria-hidden />
      <div className="w-full max-w-lg rounded-2xl border bg-card/80 backdrop-blur p-8 shadow-[var(--shadow-elegant)]">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-destructive/15 to-destructive/5 ring-1 ring-destructive/20">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="text-center text-2xl font-display tracking-tight text-foreground">
          Backend not configured
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          The app can't reach Lovable Cloud because required configuration is missing from this
          build. Reconnect Lovable Cloud and republish to fix this.
        </p>
        <div className="mt-5 rounded-md border bg-muted/50 p-4">
          <p className="text-xs font-medium text-foreground">Missing variables</p>
          <ul className="mt-2 space-y-1">
            {missing.map((name) => (
              <li key={name} className="font-mono text-xs text-muted-foreground">
                • {name}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          In Lovable: open <strong>Cloud</strong> in the sidebar and ensure the backend is
          connected, then republish.
        </p>
      </div>
    </div>
  );
}