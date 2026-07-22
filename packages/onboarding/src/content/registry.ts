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
    slug: "how-you-run",
    navLabel: msg`How You Run`,
    title: msg`Tell Us How You Run`,
    group: "get-started",
    order: 1
  },
  {
    slug: "team",
    navLabel: msg`Your Project Team`,
    title: msg`Your Project Team`,
    group: "get-started",
    order: 2,
    tiers: ["guided", "enterprise"],
    // Real substance, greyed out, sells — self-serve sees these as locked previews.
    lockedPreviewFor: ["self_serve"]
  },
  {
    slug: "how-we-work",
    navLabel: msg`How We Work`,
    title: msg`How We Work Together`,
    group: "get-started",
    order: 3,
    tiers: ["guided", "enterprise"],
    // Real substance, greyed out, sells — self-serve sees these as locked previews.
    lockedPreviewFor: ["self_serve"]
  },
  {
    slug: "scope",
    navLabel: msg`Scope Summary`,
    title: msg`Scope Summary`,
    group: "align",
    order: 4,
    // Paid-tier only — self-serve has no commercial scope/acceptance agreement.
    tiers: ["guided", "enterprise"]
  },
  {
    slug: "roles",
    navLabel: msg`Roles`,
    title: msg`Roles and Responsibilities`,
    group: "align",
    order: 5,
    // Paid-tier only — self-serve has no Carbon team, so there are no shared
    // roles/responsibilities to divide.
    tiers: ["guided", "enterprise"]
  },
  {
    slug: "value",
    navLabel: msg`Value Snapshot`,
    title: msg`Value Snapshot`,
    group: "align",
    order: 6,
    optional: true
  },
  {
    slug: "plan",
    navLabel: msg`Plan`,
    title: msg`Project Plan`,
    group: "plan",
    order: 7,
    key: true
  },
  {
    slug: "requirements",
    navLabel: msg`Requirements`,
    title: msg`Requirements and Process Map`,
    group: "plan",
    order: 8,
    // Paid-tier only — self-serve customers configure directly rather than going
    // through a formal requirements/process-mapping exercise.
    tiers: ["guided", "enterprise"],
    // Real substance, greyed out, sells — self-serve sees these as locked previews.
    lockedPreviewFor: ["self_serve"]
  },
  {
    slug: "setup",
    navLabel: msg`Setup Map`,
    title: msg`Setup Map`,
    group: "configure",
    order: 9
  },
  {
    slug: "load-data",
    navLabel: msg`Load Your Data`,
    title: msg`Load Your Data`,
    group: "configure",
    order: 10
  },
  {
    slug: "pilot",
    navLabel: msg`Prove It Works`,
    title: msg`Prove It Works`,
    group: "launch",
    order: 11
  },
  {
    slug: "crew",
    navLabel: msg`Ready Your Team`,
    title: msg`Ready Your Team`,
    group: "launch",
    order: 12
  },
  {
    slug: "training",
    navLabel: msg`Training Plan`,
    title: msg`Training Plan`,
    group: "launch",
    order: 13
  },
  {
    slug: "switch",
    navLabel: msg`Make the Switch`,
    title: msg`Make the Switch`,
    group: "launch",
    order: 14
  },
  {
    slug: "live",
    navLabel: msg`Live on Carbon`,
    title: msg`Live on Carbon`,
    group: "launch",
    order: 15
  },
  {
    slug: "controls",
    navLabel: msg`Setup & Controls`,
    title: msg`Setup & Controls`,
    group: "carbon-only",
    order: 16,
    carbonOnly: true
  },
  {
    slug: "fleet",
    navLabel: msg`Fleet`,
    title: msg`Implementation Fleet`,
    group: "carbon-only",
    order: 17,
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
// Empty since the Project Board (and its Risks section) was removed; keep the
// list + wiring so a future optional section is a one-line add.
export const OPTIONAL_SECTIONS: { key: string; label: MessageDescriptor }[] =
  [];

// New hubs start with every optional page and section excluded — a Carbon admin
// opts them back in per customer from Setup & Controls. Modules stay all-in.
export const DEFAULT_EXCLUSIONS: HubExclusions = {
  modules: [],
  pages: REGISTRY.filter((p) => p.optional).map((p) => p.slug),
  sections: OPTIONAL_SECTIONS.map((s) => s.key)
};
