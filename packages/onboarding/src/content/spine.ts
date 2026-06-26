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
    title: "Discovery",
    gate: "Scope signed",
    owner: "shared",
    timing: "Weeks 1 to 2",
    refSlug: "scope",
    gantt: { color: "#8A93A3", startWeek: 0, weeks: 2 },
    // Paid-tier only — self-serve has no scoping/discovery phase; they configure
    // directly.
    tiers: ["guided", "enterprise"],
    desc: "Confirm how your shop runs and lock the scope."
  },
  {
    key: "gate:configure",
    n: 2,
    title: "Configure",
    gate: "System configured",
    owner: "carbon",
    timing: "Weeks 2 to 5",
    // The Setup Map is the configuration checklist this gate works through; it
    // deep-links each item to its ERP screen.
    refSlug: "setup",
    gantt: { color: "#2FA350", startWeek: 1, weeks: 4 },
    desc: "Set Carbon up around how your shop runs: sites, parts, BOMs, Bill of Process, and the flows you use.",
    nested: [
      {
        key: "prod:configure-data",
        label: "Set up your resources and settings",
        detail:
          "Sites, locations, work centers, users, suppliers, and your company settings — the foundation everything else builds on. Start from ready-made templates.",
        cta: "Open the Setup Map",
        detect: null
      },
      {
        key: "prod:configure-bom",
        label: "Import your BOM",
        detail:
          "Bring in your parts, BOMs, Bill of Process, and costing — with Carbon's import tools, CSV, or LLM help.",
        docsUrl: "https://docs.carbon.ms/docs/reference/items",
        videoKey: "bom",
        detect: "hasItems"
      },
      {
        key: "prod:configure-builtins",
        label: "Turn on the built-in pieces",
        detail:
          "Configure-to-order, automated purchase planning, the shop-floor app.",
        docsUrl: "https://docs.carbon.ms/docs/reference/methods",
        detect: null
      },
      {
        key: "prod:configure-netnew",
        label: "Build any net-new work",
        detail:
          "An integration or a custom change — the small slice that's actually custom.",
        detect: null,
        tiers: ["guided", "enterprise"]
      },
      {
        key: "prod:configure-hosting",
        label: "Stand up hosting",
        detail: "Cloud, or your self-hosted environment.",
        detect: null,
        tiers: ["guided", "enterprise"]
      }
    ]
  },
  {
    key: "gate:migrate",
    n: 3,
    title: "Migrate data",
    gate: "Data validated",
    owner: "shared",
    timing: "Weeks 4 to 6",
    refSlug: "data",
    gantt: { color: "#1574E0", startWeek: 3, weeks: 3 },
    desc: "Your real data is loaded and you have checked a sample and approved it.",
    // Paid-tier only — self-serve customers bring no data to migrate.
    tiers: ["guided", "enterprise"]
  },
  {
    key: "gate:train",
    n: 4,
    title: "Train",
    gate: "Team trained",
    owner: "you",
    timing: "Weeks 5 to 7",
    refSlug: "training",
    gantt: { color: "#5B6EE1", startWeek: 4, weeks: 3 },
    desc: "Your team leads learn Carbon first using the in-app guides and Academy, then bring everyone else up to speed."
  },
  {
    key: "gate:acceptance",
    n: 5,
    title: "Acceptance",
    gate: "Acceptance passed",
    owner: "shared",
    timing: "Weeks 7 to 8",
    refSlug: "go-live",
    gantt: { color: "#0E9C8A", startWeek: 6, weeks: 2 },
    desc: "Every in-scope test passes in your configured system, with your data.",
    // Paid-tier only — self-serve has no formal acceptance/sign-off gate.
    tiers: ["guided", "enterprise"],
    nested: [
      {
        key: "prod:purchase-make",
        label: "Purchase & manufacture from MRP",
        detail: "Convert MRP suggestions into purchase orders and jobs.",
        docsUrl: "https://docs.carbon.ms/docs/reference/jobs",
        videoKey: "jobs",
        detect: "hasJob"
      },
      {
        key: "prod:serialize-sell",
        label: "Serialize & sell your parts",
        detail: "Track serial/lot numbers and fulfil sales orders.",
        docsUrl: "https://docs.carbon.ms/docs/reference/sales-orders",
        videoKey: "salesOrders",
        detect: "hasSalesOrder"
      }
    ]
  },
  {
    key: "gate:golive",
    n: 6,
    title: "Go-Live",
    gate: "Live on Carbon",
    owner: "shared",
    timing: "Week 8 cutover",
    refSlug: "go-live",
    gantt: { color: "#1659B2", startWeek: 7, weeks: 1 },
    desc: "Cut over, freeze the old system, and confirm you're live on Carbon."
  }
];

export const GATE_COUNT = SPINE.length;
