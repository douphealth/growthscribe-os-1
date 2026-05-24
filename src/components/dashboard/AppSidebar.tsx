import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Globe,
  FileSearch,
  Network,
  FileText,
  ListTodo,
  Plug,
  ScrollText,
  Settings,
  Sparkles,
  LogOut,
  Check,
  ChevronsUpDown,
  Plus,
  Library,
  Lightbulb,
  Bot,
  Wrench,
  CheckCircle2,
  ChevronDown,
  Telescope,
  Rocket,
  Cog,
  BookOpen,
  Zap,
  Activity,
} from "lucide-react";
import { TrendingUp } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/lib/auth-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/lib/org-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// 5 outcome-led sections — collapsible, defaults open when active route lives inside
const sections: Array<{
  label: string;
  icon: typeof LayoutDashboard;
  items: Array<{ title: string; url: string; icon: typeof LayoutDashboard; adminOnly?: boolean }>;
}> = [
  {
    label: "Overview",
    icon: LayoutDashboard,
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Sites", url: "/sites", icon: Globe },
    ],
  },
  {
    label: "Discover",
    icon: Telescope,
    items: [
      { title: "Content Inventory", url: "/content-inventory", icon: Library },
      { title: "Content Audits", url: "/audits", icon: FileSearch },
      { title: "Topical Maps", url: "/topical-maps", icon: Network },
      { title: "AI Visibility", url: "/ai-visibility", icon: Bot },
    ],
  },
  {
    label: "Plan",
    icon: Lightbulb,
    items: [
      { title: "Recommendations", url: "/recommendations", icon: Lightbulb },
      { title: "Playbooks", url: "/playbooks", icon: BookOpen },
      { title: "Content Briefs", url: "/briefs", icon: FileText },
      { title: "Tasks", url: "/tasks", icon: ListTodo },
    ],
  },
  {
    label: "Ship",
    icon: Rocket,
    items: [
      { title: "Approvals", url: "/approvals", icon: CheckCircle2 },
      { title: "Technical SEO", url: "/technical", icon: Wrench },
      { title: "Optimization", url: "/optimization", icon: Zap },
      { title: "Lift", url: "/lift", icon: TrendingUp },
      { title: "Core Web Vitals", url: "/vitals", icon: Gauge },
    ],
  },
  {
    label: "Operate",
    icon: Cog,
    items: [
      { title: "Integrations", url: "/integrations", icon: Plug },
      { title: "Observability", url: "/observability", icon: Activity, adminOnly: true },
      { title: "Audit Logs", url: "/audit-logs", icon: ScrollText, adminOnly: true },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const { profile, isAdmin, signOut, user, roles } = useAuth();
  const location = useLocation();
  const { organizations, currentOrg, setCurrentOrgId } = useOrg();
  const initials = (profile?.display_name || user?.email || "?").slice(0, 2).toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <Link to="/dashboard" className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-glow text-primary-foreground shadow-[var(--shadow-glow)]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-tight font-display tracking-tight">
              GrowthScribe
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">OS</span>
          </div>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="mx-2 mb-1 justify-between gap-2 text-xs">
              <span className="truncate">{currentOrg?.name ?? "No workspace"}</span>
              <ChevronsUpDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {organizations.map((o) => (
              <DropdownMenuItem key={o.id} onClick={() => setCurrentOrgId(o.id)}>
                <span className="flex-1 truncate">{o.name}</span>
                {o.id === currentOrg?.id && <Check className="h-3 w-3" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/onboarding">
                <Plus className="mr-2 h-3 w-3" /> New workspace
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>
      <SidebarContent>
        {sections.map((section) => {
          const visibleItems = section.items.filter((i) => !i.adminOnly || isAdmin);
          if (visibleItems.length === 0) return null;
          const sectionActive = visibleItems.some(
            (i) =>
              location.pathname === i.url ||
              location.pathname.startsWith(i.url + "/"),
          );
          return (
            <Collapsible key={section.label} defaultOpen={sectionActive} className="group/collapsible">
              <SidebarGroup>
                <CollapsibleTrigger asChild>
                  <SidebarGroupLabel className="flex w-full cursor-pointer items-center gap-2 hover:text-foreground">
                    <section.icon className="h-3.5 w-3.5 opacity-70" />
                    <span className="flex-1 text-left">{section.label}</span>
                    <ChevronDown className="h-3 w-3 transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
                  </SidebarGroupLabel>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {visibleItems.map((item) => {
                        const active =
                          location.pathname === item.url ||
                          location.pathname.startsWith(item.url + "/");
                        return (
                          <SidebarMenuItem key={item.url}>
                            <SidebarMenuButton asChild isActive={active}>
                              <Link to={item.url}>
                                <item.icon className="h-4 w-4" />
                                <span>{item.title}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2 p-2">
          <Avatar className="h-9 w-9">
            <AvatarImage src={profile?.avatar_url ?? undefined} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{profile?.display_name || user?.email}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
              {roles[0] ?? "member"}
            </p>
          </div>
          <Button size="icon" variant="ghost" onClick={signOut} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
