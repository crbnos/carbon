import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { HubExclusions, PageDef } from "../types";

// The hub's page list + sidebar structure (the prototype's REG array). `slug`
// matches the route filename under apps/erp/app/routes/x+/get-started+/.
// `order` is authoritative; numbering in the UI is derived, not stored.
export const REGISTRY: PageDef[] = [
  {
    slug: "start",
    navLabel: msg`Start Here`,
    title: msg`Start Here`,
    group: "get-started",
    order: 0
  },
  {
    slug: "team",
    navLabel: msg`Your Project Team`,
    title: msg`Your Project Team`,
    group: "get-started",
    order: 1,
    tiers: ["guided", "enterprise"]
  },
  {
    slug: "how-we-work",
    navLabel: msg`How We Work`,
    title: msg`How We Work Together`,
    group: "get-started",
    order: 2,
    tiers: ["guided", "enterprise"]
  },
  {
    slug: "scope",
    navLabel: msg`Scope Summary`,
    title: msg`Scope Summary`,
    group: "align",
    order: 3
  },
  {
    slug: "roles",
    navLabel: msg`Roles`,
    title: msg`Roles and Responsibilities`,
    group: "align",
    order: 4,
    // Paid-tier only — self-serve has no Carbon team, so there are no shared
    // roles/responsibilities to divide.
    tiers: ["guided", "enterprise"]
  },
  {
    slug: "value",
    navLabel: msg`Value Snapshot`,
    title: msg`Value Snapshot`,
    group: "align",
    order: 5,
    optional: true
  },
  {
    // Plan + Board are one page now, switched via a view toggle (?view=board).
    slug: "plan",
    navLabel: msg`Plan & Board`,
    title: msg`Project Plan & Board`,
    group: "plan",
    order: 6,
    key: true
  },
  {
    slug: "requirements",
    navLabel: msg`Requirements`,
    title: msg`Requirements and Process Map`,
    group: "plan",
    order: 7,
    // Paid-tier only — self-serve customers configure directly rather than going
    // through a formal requirements/process-mapping exercise.
    tiers: ["guided", "enterprise"]
  },
  {
    slug: "setup",
    navLabel: msg`Setup Map`,
    title: msg`Setup Map`,
    group: "configure",
    order: 8
  },
  {
    slug: "data",
    navLabel: msg`Data Migration`,
    title: msg`Data Migration Map`,
    group: "configure",
    order: 9,
    // Paid-tier only — self-serve customers bring no data to migrate.
    tiers: ["guided", "enterprise"]
  },
  {
    slug: "training",
    navLabel: msg`Training Plan`,
    title: msg`Training Plan`,
    group: "launch",
    order: 10
  },
  {
    slug: "go-live",
    navLabel: msg`Go-Live`,
    title: msg`Go-Live and Acceptance`,
    group: "launch",
    order: 11
  },
  {
    slug: "controls",
    navLabel: msg`Setup & Controls`,
    title: msg`Setup & Controls`,
    group: "carbon-only",
    order: 12,
    carbonOnly: true
  },
  {
    slug: "positioning",
    navLabel: msg`Others vs Carbon`,
    title: msg`Others vs Carbon`,
    group: "carbon-only",
    order: 13,
    carbonOnly: true
  }
];

export const PAGE_GROUP_LABEL: Record<PageDef["group"], MessageDescriptor> = {
  "get-started": msg`Get started`,
  align: msg`Align on scope`,
  plan: msg`Plan the work`,
  configure: msg`Configure Carbon`,
  launch: msg`Train & go live`,
  "carbon-only": msg`Carbon only`
};

export const PAGE_GROUP_ORDER: PageDef["group"][] = [
  "get-started",
  "align",
  "plan",
  "configure",
  "launch",
  "carbon-only"
];

export function pageBySlug(slug: string): PageDef | undefined {
  return REGISTRY.find((p) => p.slug === slug);
}

// Optional sections (sub-page blocks a customer may not need). Canonical list —
// the Setup & Controls toggles and the default-exclusions seed both read it.
export const OPTIONAL_SECTIONS: { key: string; label: MessageDescriptor }[] = [
  { key: "risks", label: msg`Risks (on the Project Board)` }
];

// New hubs start with every optional page and section excluded — a Carbon admin
// opts them back in per customer from Setup & Controls. Modules stay all-in.
export const DEFAULT_EXCLUSIONS: HubExclusions = {
  modules: [],
  pages: REGISTRY.filter((p) => p.optional).map((p) => p.slug),
  sections: OPTIONAL_SECTIONS.map((s) => s.key)
};
