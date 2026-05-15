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
} from "lucide-react";
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

const sections = [
  {
    label: "Workspace",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Sites", url: "/sites", icon: Globe },
    ],
  },
  {
    label: "Growth Engine",
    items: [
      { title: "Content Inventory", url: "/content-inventory", icon: Library },
      { title: "Content Audits", url: "/audits", icon: FileSearch },
      { title: "Recommendations", url: "/recommendations", icon: Lightbulb },
      { title: "Topical Maps", url: "/topical-maps", icon: Network },
      { title: "Content Briefs", url: "/briefs", icon: FileText },
      { title: "Tasks", url: "/tasks", icon: ListTodo },
      { title: "AI Visibility", url: "/ai-visibility", icon: Bot },
      { title: "Technical SEO", url: "/technical", icon: Wrench },
      { title: "Approvals", url: "/approvals", icon: CheckCircle2 },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Integrations", url: "/integrations", icon: Plug },
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
        {sections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items
                  .filter((i) => !i.adminOnly || isAdmin)
                  .map((item) => {
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
          </SidebarGroup>
        ))}
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
