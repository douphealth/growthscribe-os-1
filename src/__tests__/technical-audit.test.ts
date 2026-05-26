import { describe, expect, it } from "vitest";
import { auditHtml, buildFindings, psiFindings } from "@/lib/technical.functions";

const HTML_GOOD = `<!doctype html><html><head>
  <title>The Definitive Guide to Server-Side Rendering in 2026</title>
  <meta name="description" content="A long-form, evidence-backed walkthrough of modern SSR patterns, edge runtimes, and trade-offs. Updated for 2026." />
  <link rel="canonical" href="https://example.com/ssr-guide" />
  <meta property="og:title" content="SSR Guide" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">{"@type":"Article","headline":"SSR"}</script>
</head><body>
  <h1>SSR in 2026</h1>
  <img src="/a.png" alt="diagram" />
  <a href="/internal">internal</a>
  <a href="https://other.com">external</a>
  <p>${"word ".repeat(800)}</p>
</body></html>`;

const HTML_BAD = `<!doctype html><html><head></head><body>
  <h1>One</h1><h1>Two</h1>
  <img src="/a.png"/>
  <p>tiny body</p>
</body></html>`;

describe("auditHtml", () => {
  it("extracts SEO signals from a well-formed page", () => {
    const a = auditHtml(HTML_GOOD, "https://example.com/ssr-guide");
    expect(a.title).toMatch(/Definitive Guide/);
    expect(a.metaDescription).toBeTruthy();
    expect(a.canonical).toBe("https://example.com/ssr-guide");
    expect(a.h1Count).toBe(1);
    expect(a.imgMissingAlt).toBe(0);
    expect(a.internalLinks).toBeGreaterThanOrEqual(1);
    expect(a.externalLinks).toBeGreaterThanOrEqual(1);
    expect(a.hasOg).toBe(true);
    expect(a.hasTwitterCard).toBe(true);
    expect(a.hasJsonLd).toBe(true);
    expect(a.jsonLdTypes).toContain("Article");
    expect(a.wordCount).toBeGreaterThan(500);
  });

  it("flags structural problems on a bad page", () => {
    const a = auditHtml(HTML_BAD, "https://example.com/bad");
    expect(a.title).toBeNull();
    expect(a.metaDescription).toBeNull();
    expect(a.h1Count).toBe(2);
    expect(a.imgMissingAlt).toBe(1);
    expect(a.hasOg).toBe(false);
    expect(a.hasJsonLd).toBe(false);
  });

  it("does not throw on malformed JSON-LD", () => {
    const html = `<html><head><title>x</title><script type="application/ld+json">{not json</script></head><body><h1>x</h1></body></html>`;
    expect(() => auditHtml(html, "https://example.com")).not.toThrow();
  });

  it("tolerates an invalid pageUrl", () => {
    const a = auditHtml("<html><body><a href='https://x.com'>x</a></body></html>", "not a url");
    expect(a.externalLinks).toBe(1);
  });
});

describe("buildFindings", () => {
  it("returns no high-severity findings on a healthy page", () => {
    const findings = buildFindings(auditHtml(HTML_GOOD, "https://example.com/ssr-guide"));
    expect(findings.filter((f) => f.severity === "high")).toHaveLength(0);
  });

  it("flags missing title, description, h1 on a stripped page", () => {
    const findings = buildFindings(auditHtml(HTML_BAD, "https://example.com/bad"));
    const cats = findings.map((f) => f.category);
    expect(cats).toContain("title");
    expect(cats).toContain("meta-description");
    expect(cats).toContain("headings");
  });

  it("each finding carries a non-empty title and severity", () => {
    const findings = buildFindings(auditHtml(HTML_BAD, "https://example.com/bad"));
    for (const f of findings) {
      expect(f.title.length).toBeGreaterThan(3);
      expect(["high", "medium", "low"]).toContain(f.severity);
    }
  });
});

describe("psiFindings", () => {
  it("produces findings for poor Core Web Vitals", () => {
    const findings = psiFindings({
      strategy: "mobile",
      performance: 0.3,
      lcp: 6000,
      cls: 0.4,
      inp: 600,
      ttfb: 800,
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => /LCP|CLS|INP|Performance/i.test(f.title))).toBe(true);
  });

  it("returns empty findings for healthy scores", () => {
    const findings = psiFindings({
      strategy: "mobile",
      performance: 0.95,
      lcp: 2000,
      cls: 0.05,
      inp: 150,
      ttfb: 200,
    });
    expect(findings).toHaveLength(0);
  });
});