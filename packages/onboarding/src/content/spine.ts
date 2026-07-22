import { msg } from "@lingui/core/macro";

import type { StepDef } from "../types";

// The seven-phase "path to activated" spine, shared by every tier. Each phase
// ends at exactly one gate (1:1). The finish line is activation (ten qualifying
// business days of real usage), not cutover day. Product "do-this-in-Carbon"
// actions nest inside phases and auto-detect against real Carbon data.
//
// Stable keys are baked in (NOT document-order) so template edits never corrupt
// persisted state. Paid-tier-only work survives as tier-scoped nested steps
// (net-new build + hosting) — the gates themselves are identical across tiers;
// who does the work differs (see logic/labels ownerForTier).
//
// The customer's go-live date anchors on the SWITCH gate (cutover). "Live on
// Carbon" runs after it — the streak to activation.
export const GO_LIVE_STEP_KEY = "gate:switch";

export const SPINE: StepDef[] = [
  {
    key: "gate:intake",
    n: 1,
    title: msg`Tell Us How You Run`,
    gate: msg`Plan tailored`,
    owner: "you",
    timing: msg`Day one`,
    refSlug: "how-you-run",
    gantt: { color: "#8A93A3", startWeek: 0, weeks: 1 },
    desc: msg`Ten minutes of questions so your plan only contains what applies to you — then your first part, on screen, in Carbon.`,
    nested: [
      {
        key: "prod:intake-answers",
        label: msg`Answer the questions`,
        detail: msg`About ten minutes, in plain language. Every answer tailors your plan — nothing that doesn't apply to you will show up.`,
        cta: msg`Start now`,
        detect: null
      },
      {
        key: "prod:intake-first-win",
        label: msg`See your first part in Carbon`,
        detail: msg`We draft a product you make all the time — item, bill of materials, routing, and cost — and you correct it.`,
        detect: null
      },
      {
        key: "prod:intake-commit",
        label: msg`Set your go-live date and owner`,
        detail: msg`One date, one accountable owner. The countdown starts here.`,
        detect: null
      }
    ]
  },
  {
    key: "gate:basics",
    n: 2,
    title: msg`Set Up the Basics`,
    gate: msg`Setup list done`,
    owner: "shared",
    timing: msg`Weeks 1 to 3`,
    // The Setup Map is the configuration checklist this gate works through; it
    // deep-links each item to its ERP screen and hides what your answers ruled out.
    refSlug: "setup",
    gantt: { color: "#2FA350", startWeek: 0, weeks: 3 },
    desc: msg`Make Carbon look like your factory: company details, people, resources, and the five decisions that are expensive to change later.`,
    nested: [
      {
        key: "prod:basics-setup",
        label: msg`Work the tailored setup list`,
        detail: msg`Only what applies to you, grouped by area, with a reason for everything we hid.`,
        cta: msg`Open the Setup Map`,
        detect: null
      },
      {
        key: "prod:basics-resources",
        label: msg`Set up your work centers and processes`,
        detail: msg`Where work happens on your floor — proposed from your answers, approved by you.`,
        docsUrl: "https://docs.carbon.ms/docs/reference/work-centers",
        detect: "hasWorkCenter"
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
    key: "gate:load-data",
    n: 3,
    title: msg`Load Your Data`,
    gate: msg`Data loaded and spot-checked`,
    owner: "shared",
    timing: msg`Weeks 2 to 5`,
    refSlug: "load-data",
    gantt: { color: "#1574E0", startWeek: 1, weeks: 4 },
    desc: msg`Bring your lists in without retyping them: customers, suppliers, items, BOMs, and routings — messy files welcome.`,
    nested: [
      {
        key: "prod:load-customers",
        label: msg`Load your customers`,
        detail: msg`Upload the list you already have — we map the columns and you approve.`,
        detect: "hasCustomers"
      },
      {
        key: "prod:load-suppliers",
        label: msg`Load your suppliers`,
        detail: msg`Same file-in, clean-list-out flow as customers.`,
        detect: "hasSuppliers"
      },
      {
        key: "prod:load-items",
        label: msg`Load your items`,
        detail: msg`Parts, materials, tools — start with what was active in the last year.`,
        docsUrl: "https://docs.carbon.ms/docs/reference/items",
        videoKey: "bom",
        detect: "hasItems"
      },
      {
        key: "prod:load-boms",
        label: msg`Load your BOMs and routings`,
        detail: msg`Start with what you actually ship this quarter.`,
        docsUrl: "https://docs.carbon.ms/docs/reference/methods",
        detect: "hasBomLines"
      }
    ]
  },
  {
    key: "gate:pilot",
    n: 4,
    title: msg`Prove It Works`,
    gate: msg`One real order, end to end`,
    owner: "you",
    timing: msg`Week 5`,
    refSlug: "pilot",
    gantt: { color: "#5B6EE1", startWeek: 4, weeks: 1 },
    desc: msg`Run one real order through Carbon, start to finish. Every document it creates checks itself off as it appears.`,
    nested: [
      {
        key: "prod:pilot-order",
        label: msg`Enter the order`,
        detail: msg`A real, recently completed order — the one you make all the time, not the weird one.`,
        docsUrl: "https://docs.carbon.ms/docs/reference/sales-orders",
        videoKey: "salesOrders",
        detect: "hasSalesOrder"
      },
      {
        key: "prod:pilot-job",
        label: msg`Run it as a job`,
        detail: msg`Material demand, purchasing, and the floor — the whole chain on your real numbers.`,
        docsUrl: "https://docs.carbon.ms/docs/reference/jobs",
        videoKey: "jobs",
        detect: "hasJob"
      },
      {
        key: "prod:pilot-ship",
        label: msg`Ship and invoice it`,
        detail: msg`The trace completes when the last document appears. Invoices are previewed, never sent.`,
        detect: "hasShipment"
      }
    ]
  },
  {
    key: "gate:crew",
    n: 5,
    title: msg`Ready Your Team`,
    gate: msg`Champions signed off`,
    owner: "you",
    timing: msg`Weeks 5 to 7`,
    refSlug: "crew",
    gantt: { color: "#0E9C8A", startWeek: 4, weeks: 3 },
    desc: msg`One champion per area, each doing real tasks on your real data — and the first floor station running jobs.`,
    nested: [
      {
        key: "prod:crew-champions",
        label: msg`Name your crew`,
        detail: msg`The owner plus one champion per area. In a small team, one person wears several hats — that's fine.`,
        detect: null
      },
      {
        key: "prod:crew-floor",
        label: msg`Run the pilot floor station`,
        detail: msg`One work center, one shift, three jobs through the shop-floor app. Paper keeps printing — from Carbon.`,
        detect: "hasProductionEvent"
      }
    ]
  },
  {
    key: "gate:switch",
    n: 6,
    title: msg`Make the Switch`,
    gate: msg`Switched — old system frozen`,
    owner: "shared",
    timing: msg`Switch week`,
    refSlug: "switch",
    gantt: { color: "#1659B2", startWeek: 7, weeks: 1 },
    desc: msg`Load what's open, count what's on hand, sign the freeze plan, and leave the old system without falling.`
  },
  {
    key: "gate:live",
    n: 7,
    title: msg`Live on Carbon`,
    gate: msg`Activated`,
    owner: "you",
    timing: msg`First two weeks live`,
    refSlug: "live",
    gantt: { color: "#B58A2F", startWeek: 8, weeks: 2 },
    desc: msg`Ten straight business days of real usage. When the streak lands, you're activated — and this hub's job is done.`
  }
];

export const GATE_COUNT = SPINE.length;
