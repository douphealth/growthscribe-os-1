import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { Database } from "@/integrations/supabase/types";

export type OrgRole = Database["public"]["Enums"]["org_role"];
export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type OrganizationMember = Database["public"]["Tables"]["organization_members"]["Row"];

type OrgWithRole = Organization & { role: OrgRole };

interface OrgContextValue {
  organizations: OrgWithRole[];
  currentOrg: OrgWithRole | null;
  loading: boolean;
  error: Error | null;
  setCurrentOrgId: (id: string) => void;
  refresh: () => Promise<void>;
  isAdmin: boolean;
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined);
const STORAGE_KEY = "gs_current_org_id";

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["organizations", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<OrgWithRole[]> => {
      const { data: members, error: mErr } = await supabase
        .from("organization_members")
        .select("role, organization_id, organizations(*)")
        .eq("user_id", user!.id);
      if (mErr) throw mErr;
      return (members ?? [])
        .filter((m) => m.organizations)
        .map((m) => ({ ...(m.organizations as Organization), role: m.role as OrgRole }));
    },
  });

  const organizations = data ?? [];

  useEffect(() => {
    if (!organizations.length) return;
    if (!currentOrgId || !organizations.find((o) => o.id === currentOrgId)) {
      const next = organizations[0].id;
      setCurrentOrgIdState(next);
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, [organizations, currentOrgId]);

  const setCurrentOrgId = useCallback(
    (id: string) => {
      setCurrentOrgIdState(id);
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
      qc.invalidateQueries();
    },
    [qc],
  );

  const currentOrg = organizations.find((o) => o.id === currentOrgId) ?? null;

  const value = useMemo<OrgContextValue>(
    () => ({
      organizations,
      currentOrg,
      loading: isLoading,
      error: (error as Error | null) ?? null,
      setCurrentOrgId,
      refresh: async () => {
        await refetch();
      },
      isAdmin: currentOrg?.role === "owner" || currentOrg?.role === "admin",
    }),
    [organizations, currentOrg, isLoading, error, setCurrentOrgId, refetch],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrganizationProvider");
  return ctx;
}

export function useRequiredOrgId(): string | null {
  const { currentOrg } = useOrg();
  return currentOrg?.id ?? null;
}