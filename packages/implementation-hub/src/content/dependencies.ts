// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The dependency map: for each board task (content/board.ts key), the tasks it
// holds up. It drives the overdue cascade (logic/cascade.ts): an overdue task
// holds up everything reachable from it here, directly or through other tasks.
// The readiness rules of the operational tasks (content/operational.ts) and
// STEP_ORDER below follow the same order; keep the three in step. The hub
// owner reviews this map.
export const DEPENDENCIES: Record<string, string[]> = {
  // Discovery: nothing is configured before the scope is signed.
  kickoff: ["process-mapped"],
  "process-mapped": ["scope-signed"],
  "scope-signed": [
    "setup-settings",
    "setup-resources",
    "setup-people",
    "setup-purchasing",
    "setup-items",
    "setup-inventory",
    "setup-sales",
    "setup-production",
    "setup-accounting",
    "integrations",
    "hosting"
  ],

  // Configure. Company settings (document templates, numbering) go on every
  // document sent out.
  "setup-settings": [
    "first-quote",
    "first-purchase-order",
    "first-sales-order"
  ],
  // Locations, work centers and processes: people and shifts work at a
  // location, routings name processes and work centers, storage units sit at a
  // location, and a job runs at a work center.
  "setup-resources": [
    "setup-people",
    "setup-items",
    "setup-inventory",
    "first-job"
  ],
  // People need an account before they are trained, and an operator runs the
  // first job on the shop floor.
  "setup-people": ["champions-trained", "first-job-completed"],
  // Suppliers come before the items bought from them.
  "setup-purchasing": ["setup-items", "first-purchase-order"],
  "setup-items": [
    "first-quote",
    "first-purchase-order",
    "first-sales-order",
    "first-job",
    "data-loaded"
  ],
  // Storage units: there is nowhere to receive stock or load it into without
  // them.
  "setup-inventory": ["first-receipt", "data-loaded"],
  "setup-sales": ["first-quote", "first-sales-order"],
  // Shop-floor configuration, such as scrap reasons.
  "setup-production": ["first-job-completed"],
  // The books must be ready before the company runs on Carbon.
  "setup-accounting": ["cutover"],
  integrations: ["acceptance-passed"],
  hosting: ["data-loaded"],

  // Migrate and train.
  "data-loaded": ["data-validated"],
  "data-validated": ["acceptance-passed", "cutover"],
  "training-materials": ["champions-trained"],
  "champions-trained": ["acceptance-passed", "cutover"],

  // Acceptance and go-live. On the paid tiers the first documents are part of
  // the acceptance checklist.
  "acceptance-passed": ["cutover"],
  cutover: ["hypercare"],
  hypercare: [],

  // The first documents. A receipt needs a sent purchase order, and the first
  // job is completed with its material received and the job released.
  "first-quote": ["acceptance-passed"],
  "first-purchase-order": ["first-receipt", "acceptance-passed"],
  "first-receipt": ["first-job-completed", "acceptance-passed"],
  "first-sales-order": ["acceptance-passed"],
  "first-job": ["first-job-completed", "acceptance-passed"],
  "first-job-completed": []
};

// The setup steps in dependency order, from the first location to the first
// completed job. An agent connected over MCP reads it in Carbon's onboarding
// playbook, which is English markdown, so the labels are plain strings rather
// than translated copy. The last four keys are operational task keys.
export const STEP_ORDER: { key: string; label: string }[] = [
  { key: "location", label: "Location" },
  { key: "units-and-currency", label: "Units and currency" },
  { key: "suppliers", label: "Suppliers" },
  { key: "processes-and-work-centers", label: "Processes and work centers" },
  { key: "people", label: "People" },
  { key: "parts-and-materials", label: "Parts and materials" },
  { key: "bom-and-routing", label: "Bill of materials and routing" },
  { key: "storage-and-opening-stock", label: "Storage and opening stock" },
  { key: "customers", label: "Customers" },
  { key: "first-purchase-order", label: "First purchase order" },
  { key: "first-receipt", label: "First receipt" },
  { key: "first-job", label: "First production job" },
  { key: "first-job-completed", label: "First production job completed" }
];
