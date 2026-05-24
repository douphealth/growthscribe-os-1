import { describe, expect, it } from "vitest";
import { scoreContent, scoreBreakdowns } from "@/lib/content-scoring";

const longHtml = `
<h1>Modern Edge Runtimes</h1>
<h2>What is an edge runtime?</h2>
<p>${"sentence ".repeat(50)}</p>
<h2>How does it differ from serverless?</h2>
<p>${"answer ".repeat(50)}</p>
<h3>When should you choose Workers?</h3>
<ul><li>low latency</li><li>global</li><li>cheap</li></ul>
<ol><li>one</li><li>two</li></ol>
<table><tr><td>a</td><td>b</td></tr></table>
<blockquote>cite</blockquote>
<p>By Jane Doe, updated 2026. Used by 12 million users worldwide (38%).</p>
<a href="https://example.com/internal">internal</a>
<a href="https://example.com/another">internal2</a>
<a href="https://external.com/ref">ref</a>
<a href="https://other.org/ref">ref2</a>
<img src="/a.png" alt="diagram" />
<img src="/b.png" alt="chart" />
<script type="application/ld+json">{"@type":"Article"}</script>
${"<p>" + "word ".repeat(40) + "</p>".repeat(1)}
${"<p>" + "word ".repeat(40) + "</p>".repeat(1)}
`;

describe("scoreContent", () => {
  it("returns 0-100 integers across all dimensions", () => {
    const out = scoreContent({
      title: "Modern Edge Runtimes: A 2026 Practitioner Guide",
      excerpt: "A thorough walkthrough of edge runtimes, trade-offs, and benchmarks for production teams in 2026.",
      contentHtml: longHtml,
      contentText: null,
      wordCount: 2200,
      url: "https://example.com/edge-runtimes",
    });
    for (const v of Object.values(out)) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(out.seo_score).toBeGreaterThan(60);
    expect(out.aeo_score).toBeGreaterThan(50);
    expect(out.geo_score).toBeGreaterThan(50);
  });

  it("penalizes thin pages", () => {
    const out = scoreContent({
      title: "Hi",
      excerpt: null,
      contentHtml: "<p>short</p>",
      contentText: "short",
      wordCount: 1,
      url: "https://example.com/x",
    });
    expect(out.seo_score).toBeLessThan(30);
    expect(out.aeo_score).toBeLessThan(20);
    expect(out.geo_score).toBeLessThan(20);
  });

  it("handles fully null input without throwing", () => {
    const out = scoreContent({
      title: null,
      excerpt: null,
      contentHtml: null,
      contentText: null,
      wordCount: null,
      url: "not-a-url",
    });
    expect(out.seo_score).toBe(0);
    expect(out.aeo_score).toBe(0);
    expect(out.geo_score).toBe(0);
  });
});

describe("scoreBreakdowns", () => {
  it("returns one breakdown per dimension with bounded scores", () => {
    const rows = scoreBreakdowns({
      title: "Edge Runtimes",
      excerpt: null,
      contentHtml: longHtml,
      contentText: null,
      wordCount: 2200,
      url: "https://example.com/edge-runtimes",
    });
    expect(rows.length).toBeGreaterThan(0);
    const types = new Set(rows.map((r) => r.score_type));
    expect(types.size).toBe(rows.length); // no duplicates
    for (const r of rows) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(["low", "medium", "high"]).toContain(r.estimated_impact);
      expect(["low", "medium", "high"]).toContain(r.confidence);
      expect(Array.isArray(r.recommended_actions)).toBe(true);
    }
  });
});