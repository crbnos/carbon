import { msg } from "@lingui/core/macro";

import type { StepDef } from "../types";

// The six "path to live" steps. Each ends at exactly one gate (1:1). Product
// "do-this-in-Carbon" actions are nested inside Configure + Acceptance and
// auto-detect against real Carbon data (decision: nest product steps inside).
//
// Stable keys are baked in (NOT document-order) so template edits never corrupt
// persisted state.
export const SPINE: StepDef[] = [
  {
    key: "gate:discovery",
    n: 1,
    title: msg`Discovery`,
    gate: msg`Scope signed`,
    owner: "shared",
    timing: msg`Weeks 1 to 2`,
    refSlug: "scope",
    gantt: { color: "#8A93A3", startWeek: 0, weeks: 2 },
    // Paid-tier only — self-serve has no scoping/discovery phase; they configure
    // directly.
    tiers: ["guided", "enterprise"],
    desc: msg`Confirm how your company runs and lock the scope.`
  },
  {
    key: "gate:configure",
    n: 2,
    title: msg`Configure`,
    gate: msg`System configured`,
    owner: "carbon",
    timing: msg`Weeks 2 to 5`,
    // The Setup Map is the configuration checklist this gate works through; it
    // deep-links each item to its ERP screen.
    refSlug: "setup",
    gantt: { color: "#2FA350", startWeek: 1, weeks: 4 },
    desc: msg`Set Carbon up around how your company runs: sites, parts, BOMs, Bill of Process, and the flows you use.`,
    nested: [
      {
        key: "prod:configure-data",
        label: msg`Set up your resources and settings`,
        detail: msg`Sites, locations, work centers, users, suppliers, and your company settings — the foundation everything else builds on. Start from ready-made templates.`,
        cta: msg`Open the Setup Map`,
        detect: null
      },
      {
        key: "prod:configure-bom",
        label: msg`Import your BOM`,
        detail: msg`Bring in your parts, BOMs, Bill of Process, and costing — with Carbon's import tools, CSV, or LLM help.`,
        docsUrl: "https://docs.carbon.ms/docs/reference/items",
        videoKey: "bom",
        detect: "hasItems"
      },
      {
        key: "prod:configure-builtins",
        label: msg`Turn on the built-in pieces`,
        detail: msg`Configure-to-order, automated purchase planning, the shop-floor app.`,
        docsUrl: "https://docs.carbon.ms/docs/reference/methods",
        detect: null
      },
      {
        key: "prod:configure-netnew",
        label: msg`Build any net-new work`,
        detail: msg`An integration or a custom change — the small slice that's actually custom.`,
        detect: null,
        tiers: ["guided", "enterprise"]
      },
      {
        key: "prod:configure-hosting",
        label: msg`Stand up hosting`,
        detail: msg`Cloud, or your self-hosted environment.`,
        detect: null,
        tiers: ["guided", "enterprise"]
      }
    ]
  },
  {
    key: "gate:migrate",
    n: 3,
    title: msg`Migrate data`,
    gate: msg`Data validated`,
    owner: "shared",
    timing: msg`Weeks 4 to 6`,
    refSlug: "data",
    gantt: { color: "#1574E0", startWeek: 3, weeks: 3 },
    desc: msg`Your real data is loaded and you have checked a sample and approved it.`,
    // Paid-tier only — self-serve customers bring no data to migrate.
    tiers: ["guided", "enterprise"]
  },
  {
    key: "gate:train",
    n: 4,
    title: msg`Train`,
    gate: msg`Team trained`,
    owner: "you",
    timing: msg`Weeks 5 to 7`,
    refSlug: "training",
    gantt: { color: "#5B6EE1", startWeek: 4, weeks: 3 },
    desc: msg`Your team leads learn Carbon first using the in-app guides and Academy, then bring everyone else up to speed.`
  },
  {
    key: "gate:acceptance",
    n: 5,
    title: msg`Acceptance`,
    gate: msg`Acceptance passed`,
    owner: "shared",
    timing: msg`Weeks 7 to 8`,
    refSlug: "go-live",
    gantt: { color: "#0E9C8A", startWeek: 6, weeks: 2 },
    desc: msg`Every in-scope test passes in your configured system, with your data.`,
    // Paid-tier only — self-serve has no formal acceptance/sign-off gate.
    tiers: ["guided", "enterprise"],
    nested: [
      {
        key: "prod:purchase-make",
        label: msg`Purchase & manufacture from MRP`,
        detail: msg`Convert MRP suggestions into purchase orders and jobs.`,
        docsUrl: "https://docs.carbon.ms/docs/reference/jobs",
        videoKey: "jobs",
        detect: "hasJob"
      },
      {
        key: "prod:serialize-sell",
        label: msg`Serialize & sell your parts`,
        detail: msg`Track serial/lot numbers and fulfil sales orders.`,
        docsUrl: "https://docs.carbon.ms/docs/reference/sales-orders",
        videoKey: "salesOrders",
        detect: "hasSalesOrder"
      }
    ]
  },
  {
    key: "gate:golive",
    n: 6,
    title: msg`Go-Live`,
    gate: msg`Live on Carbon`,
    owner: "shared",
    timing: msg`Week 8 cutover`,
    refSlug: "go-live",
    gantt: { color: "#1659B2", startWeek: 7, weeks: 1 },
    desc: msg`Cut over, freeze the old system, and confirm you're live on Carbon.`
  }
];

export const GATE_COUNT = SPINE.length;
