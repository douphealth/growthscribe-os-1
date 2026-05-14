import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Sparkles, Network, FileSearch, ListTodo, ShieldCheck, BarChart3,
  Globe, Bot, ArrowRight, Check,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GrowthScribe OS — AI Growth Command Center for WordPress" },
      { name: "description", content: "Enterprise AI command center for SEO, AEO/GEO, topical authority, and editorial workflows. Built for WordPress publishers, affiliate marketers, and SEO teams." },
      { property: "og:title", content: "GrowthScribe OS — AI Growth Command Center" },
      { property: "og:description", content: "Rank, earn, and grow without mass-publishing low-quality AI content." },
    ],
  }),
  component: Landing,
});

const features = [
  { icon: FileSearch, title: "AI Content Audits", desc: "Score every URL on quality, E-E-A-T, and AEO readiness with actionable fixes." },
  { icon: Network, title: "Topical Authority Maps", desc: "Visualize pillar/cluster gaps and prioritize the next piece that moves rankings." },
  { icon: Bot, title: "AEO + GEO Recommendations", desc: "Optimize for AI Overviews, ChatGPT, Perplexity, and Gemini-style search." },
  { icon: BarChart3, title: "Unified GSC + GA4", desc: "Clicks, impressions, revenue, and rankings — one executive dashboard." },
  { icon: ListTodo, title: "Editorial Workflow", desc: "Briefs → drafts → review → approval → WordPress publish." },
  { icon: ShieldCheck, title: "Approval-based Publishing", desc: "Nothing ships to WordPress without human review. No mass-publish junk." },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-50">
        <div className="mx-auto max-w-7xl flex h-16 items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight">GrowthScribe <span className="text-muted-foreground">OS</span></span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition">Features</a>
            <a href="#how" className="hover:text-foreground transition">How it works</a>
            <a href="#who" className="hover:text-foreground transition">Who it's for</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><Link to="/login">Sign in</Link></Button>
            <Button asChild size="sm"><Link to="/signup">Get started</Link></Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--color-primary)_0%,_transparent_55%)] opacity-[0.08]" />
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            For WordPress publishers, affiliate marketers & SEO teams
          </div>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight text-foreground max-w-4xl mx-auto leading-[1.05]">
            The AI growth command center for <span className="text-primary">organic publishers</span>.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            Rank, earn, and grow without mass-publishing low-quality AI content. GrowthScribe OS turns GSC, GA4, and your WordPress library into prioritized growth actions — with human approval before anything ships.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg" className="gap-2">
              <Link to="/signup">Start free <ArrowRight className="h-4 w-4" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-accent" /> Approval-based WordPress publishing</span>
            <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-accent" /> Role-based access</span>
            <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-accent" /> SOC-style audit logs</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border/60 bg-secondary/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-widest text-primary font-medium">Platform</p>
            <h2 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight">Everything you need to compound organic growth.</h2>
            <p className="mt-4 text-muted-foreground">Built around the publishers who refuse to flood the web with junk. Audit, plan, brief, approve, ship.</p>
          </div>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-border/60 bg-card p-6 hover:border-primary/40 transition">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="text-xs uppercase tracking-widest text-primary font-medium">How it works</p>
          <h2 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight max-w-2xl">From data to ranking, in four deliberate steps.</h2>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { n: "01", t: "Connect", d: "Plug in WordPress, Google Search Console, and GA4 in minutes." },
              { n: "02", t: "Audit", d: "AI scores every URL on quality, E-E-A-T, AEO/GEO readiness." },
              { n: "03", t: "Plan", d: "Topical maps reveal pillar gaps. Briefs queue the next moves." },
              { n: "04", t: "Approve & ship", d: "Editor approves; draft lands in WordPress — never auto-published." },
            ].map((s) => (
              <div key={s.n} className="rounded-xl border border-border/60 bg-card p-6">
                <div className="text-xs font-mono text-primary">{s.n}</div>
                <h3 className="mt-2 font-semibold">{s.t}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="who" className="border-t border-border/60 bg-secondary/30">
        <div className="mx-auto max-w-6xl px-6 py-20 grid md:grid-cols-3 gap-6">
          {[
            { icon: Globe, t: "WordPress publishers", d: "Programmatic teams that need quality controls at scale." },
            { icon: BarChart3, t: "Affiliate marketers", d: "Protect revenue pages and find the next ranking opportunity." },
            { icon: ShieldCheck, t: "In-house SEO teams", d: "Run audits, briefs, and approvals from one workspace with audit logs." },
          ].map((c) => (
            <div key={c.t} className="rounded-xl border border-border/60 bg-card p-6">
              <c.icon className="h-6 w-6 text-primary mb-4" />
              <h3 className="font-semibold">{c.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-4xl px-6 py-24 text-center">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Stop guessing. Start compounding.</h2>
          <p className="mt-4 text-muted-foreground">Set up your workspace in under 10 minutes.</p>
          <div className="mt-8">
            <Button asChild size="lg" className="gap-2">
              <Link to="/signup">Create your workspace <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} GrowthScribe OS</span>
          <span>Built with Lovable</span>
        </div>
      </footer>
    </div>
  );
}
