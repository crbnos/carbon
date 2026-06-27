import { msg } from "@lingui/core/macro";
import type { BoardTask } from "../types";

// Starter Project Board tasks, grouped under the six spine steps. Keys match the
// prototype's boardKeys. Each task's status lives in implementationCheckState
// (kind "task", itemKey = taskKey(key)); the Plan page derives its checklist
// from the same rows.
export const BOARD_TASKS: BoardTask[] = [
  {
    key: "kickoff",
    label: msg`Agree who owns what and set a working rhythm`,
    stepKey: "gate:discovery",
    owner: "shared"
  },
  {
    key: "process-mapped",
    label: msg`Walk your current process, systems, and data`,
    stepKey: "gate:discovery",
    owner: "shared"
  },
  {
    key: "scope-signed",
    label: msg`Confirm and sign the scope`,
    stepKey: "gate:discovery",
    owner: "shared"
  },
  {
    key: "sites-users",
    label: msg`Set up sites, users, and roles`,
    stepKey: "gate:configure",
    owner: "carbon"
  },
  {
    key: "parts-boms",
    label: msg`Load parts, BOMs, Bill of Process, and costing`,
    stepKey: "gate:configure",
    owner: "carbon"
  },
  {
    key: "cto-options",
    label: msg`Configure-to-order options and pricing`,
    stepKey: "gate:configure",
    owner: "carbon"
  },
  {
    key: "purchase-planning",
    label: msg`Turn on automated purchase planning`,
    stepKey: "gate:configure",
    owner: "carbon"
  },
  {
    key: "shopfloor-stations",
    label: msg`Set up the shop-floor app and stations`,
    stepKey: "gate:configure",
    owner: "carbon"
  },
  {
    key: "integrations",
    label: msg`Build any net-new integrations or customizations`,
    stepKey: "gate:configure",
    owner: "carbon",
    // Paid-tier only — self-serve uses standard cloud Carbon, no custom build
    // (mirrors the gated prod:configure-netnew spine step).
    tiers: ["guided", "enterprise"]
  },
  {
    key: "hosting",
    label: msg`Stand up hosting (cloud or self-hosted)`,
    stepKey: "gate:configure",
    owner: "carbon",
    // Paid-tier only — self-serve is managed cloud, nothing to stand up
    // (mirrors the gated prod:configure-hosting spine step).
    tiers: ["guided", "enterprise"]
  },
  {
    key: "data-loaded",
    label: msg`Pull, map, and load your data`,
    stepKey: "gate:migrate",
    owner: "carbon",
    // Paid-tier only — self-serve has no data-migration gate (see spine).
    tiers: ["guided", "enterprise"]
  },
  {
    key: "data-validated",
    label: msg`Validate a sample and approve the migrated data`,
    stepKey: "gate:migrate",
    owner: "you",
    tiers: ["guided", "enterprise"]
  },
  {
    key: "training-materials",
    label: msg`Build role-based training materials`,
    stepKey: "gate:train",
    owner: "carbon"
  },
  {
    key: "champions-trained",
    label: msg`Run hands-on sessions and sign off your team`,
    stepKey: "gate:train",
    owner: "you"
  },
  {
    key: "acceptance-passed",
    label: msg`Run the acceptance checklist to a pass`,
    stepKey: "gate:acceptance",
    owner: "shared",
    // Paid-tier only — self-serve has no formal acceptance gate (see spine).
    tiers: ["guided", "enterprise"]
  },
  {
    key: "cutover",
    label: msg`Cut over to Carbon and freeze the old system`,
    stepKey: "gate:golive",
    owner: "shared"
  },
  {
    key: "hypercare",
    label: msg`Hypercare: intense support for the first weeks`,
    stepKey: "gate:golive",
    owner: "shared",
    // Paid-tier only — self-serve has no Carbon team for post-launch hypercare.
    tiers: ["guided", "enterprise"]
  }
];
