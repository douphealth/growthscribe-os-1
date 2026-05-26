// System playbook presets — the 12 asset blocks from the manual pass.
// Each block has a generator prompt + a validator that confirms it landed.

export type AssetBlockKind =
  | "quick_answer_aeo"
  | "h2_authority"
  | "h3_support"
  | "extraction_table"
  | "checklist_framework"
  | "review_decision_framework"
  | "cro_module"
  | "internal_topical_links"
  | "affiliate_funnel"
  | "trust_compliance_note"
  | "title_excerpt_refresh"
  | "seo_meta_sync";

export type AssetBlock = {
  kind: AssetBlockKind;
  label: string;
  description: string;
  weight: number;
  validator?: string; // regex / DOM marker that proves it landed
};

export const ASSET_BLOCKS: Record<AssetBlockKind, AssetBlock> = {
  quick_answer_aeo: {
    kind: "quick_answer_aeo",
    label: "Quick-Answer / AEO block",
    description: "40–60 word direct answer placed immediately after H1 for SGE/AIO extraction.",
    weight: 10,
    validator: 'data-block="quick-answer"',
  },
  h2_authority: {
    kind: "h2_authority",
    label: "H2 authority section",
    description: "New H2 covering an entity/sub-intent the SERP top 10 cover that we don't.",
    weight: 8,
  },
  h3_support: {
    kind: "h3_support",
    label: "H3 support sections",
    description: "Nested H3s under each H2 to deepen topical coverage.",
    weight: 5,
  },
  extraction_table: {
    kind: "extraction_table",
    label: "Extraction-ready table",
    description: "Comparison/specs table with semantic headers, ideal for AI-overview citations.",
    weight: 7,
    validator: "<table",
  },
  checklist_framework: {
    kind: "checklist_framework",
    label: "Checklist / framework",
    description: "Numbered or checkbox list that condenses the post's actionable advice.",
    weight: 6,
  },
  review_decision_framework: {
    kind: "review_decision_framework",
    label: "Review decision framework",
    description: "Buy-it-if / skip-it-if block for review intent posts.",
    weight: 9,
  },
  cro_module: {
    kind: "cro_module",
    label: "CRO module",
    description: "Inline CTA + value-prop card placed at the post's highest-scroll-depth section.",
    weight: 7,
  },
  internal_topical_links: {
    kind: "internal_topical_links",
    label: "Internal topical links",
    description: "3–5 contextual links to pillar + adjacent cluster pages.",
    weight: 6,
  },
  affiliate_funnel: {
    kind: "affiliate_funnel",
    label: "Affiliate funnel routing",
    description: "Outbound monetized link with cloaked tracking + UTM funnel attribution.",
    weight: 8,
  },
  trust_compliance_note: {
    kind: "trust_compliance_note",
    label: "Trust / compliance note",
    description: "Disclosure, fact-checked-by, updated-on stamps for E-E-A-T.",
    weight: 5,
  },
  title_excerpt_refresh: {
    kind: "title_excerpt_refresh",
    label: "Title + excerpt refresh",
    description: "Rewrites SEO title and excerpt for current search intent + freshness.",
    weight: 9,
  },
  seo_meta_sync: {
    kind: "seo_meta_sync",
    label: "SEO meta family sync",
    description: "Writes through Yoast / Rank Math / WDS / Metabox / kk_seo_* adapters in one pass.",
    weight: 6,
  },
};

export type SystemPlaybook = {
  slug: string;
  name: string;
  description: string;
  target_intent: "informational" | "commercial" | "transactional" | "review" | "comparison";
  blocks: AssetBlockKind[];
};

export const SYSTEM_PLAYBOOKS: SystemPlaybook[] = [
  {
    slug: "review-post-uplift",
    name: "Review Post Uplift",
    description: "Apply the full review-post upgrade pack: AEO, decision framework, CRO, affiliate funnel, trust.",
    target_intent: "review",
    blocks: [
      "quick_answer_aeo",
      "review_decision_framework",
      "extraction_table",
      "cro_module",
      "affiliate_funnel",
      "trust_compliance_note",
      "title_excerpt_refresh",
      "seo_meta_sync",
      "internal_topical_links",
    ],
  },
  {
    slug: "comparison-post-uplift",
    name: "Comparison Post Uplift",
    description: "Head-to-head posts: comparison tables, decision framework, internal links, affiliate routing.",
    target_intent: "comparison",
    blocks: [
      "quick_answer_aeo",
      "extraction_table",
      "h2_authority",
      "h3_support",
      "review_decision_framework",
      "cro_module",
      "affiliate_funnel",
      "internal_topical_links",
      "seo_meta_sync",
    ],
  },
  {
    slug: "informational-aeo-pack",
    name: "Informational AEO Pack",
    description: "How-to / explainer posts: AEO blocks, checklists, authority H2s, internal links.",
    target_intent: "informational",
    blocks: [
      "quick_answer_aeo",
      "h2_authority",
      "h3_support",
      "checklist_framework",
      "extraction_table",
      "internal_topical_links",
      "trust_compliance_note",
      "title_excerpt_refresh",
      "seo_meta_sync",
    ],
  },
  {
    slug: "commercial-cro-pack",
    name: "Commercial CRO Pack",
    description: "Money pages: CRO modules, trust, internal links, affiliate funnel.",
    target_intent: "commercial",
    blocks: [
      "quick_answer_aeo",
      "cro_module",
      "review_decision_framework",
      "extraction_table",
      "affiliate_funnel",
      "trust_compliance_note",
      "internal_topical_links",
      "title_excerpt_refresh",
      "seo_meta_sync",
    ],
  },
];