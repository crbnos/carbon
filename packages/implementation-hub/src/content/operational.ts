// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { OnboardingCountKey } from "../logic/status";
import type { BoardTask, ReadinessRule, Tier } from "../types";

// Operational tasks: the first live documents, each run with the company's own
// setup data. A task shows on the Plan only once the records it needs exist
// (`ready`, see logic/readiness.ts), so setup always comes first. Each one
// shows the count of the documents it creates as evidence, and is still ticked
// by hand (kind "task", itemKey taskKey(key)).
interface OperationalTask {
  key: string;
  label: MessageDescriptor;
  ready: ReadinessRule;
  evidence: OnboardingCountKey;
}

const FIRST_DOCUMENTS: OperationalTask[] = [
  {
    key: "first-quote",
    label: msg`Send your first quote`,
    ready: [
      { count: "customers", min: 1 },
      { count: "items", min: 1 }
    ],
    evidence: "quotesSent"
  },
  {
    key: "first-purchase-order",
    label: msg`Send your first purchase order`,
    ready: [
      { count: "suppliers", min: 1 },
      { count: "items", min: 1 }
    ],
    evidence: "purchaseOrdersFinalized"
  },
  {
    key: "first-receipt",
    label: msg`Receive your first purchase order`,
    ready: [{ count: "purchaseOrdersFinalized", min: 1 }],
    evidence: "postedReceipts"
  },
  {
    key: "first-sales-order",
    label: msg`Confirm your first sales order`,
    ready: [
      { count: "customers", min: 1 },
      { count: "items", min: 1 }
    ],
    evidence: "salesOrders"
  },
  {
    key: "first-job",
    label: msg`Release your first production job`,
    ready: [
      { count: "routingOperations", min: 1 },
      { count: "workCenters", min: 1 }
    ],
    evidence: "jobsReleased"
  }
];

const PAID_TIERS: Tier[] = ["guided", "enterprise"];

// The first documents sit in Acceptance on the paid tiers, where running them
// is part of the acceptance checklist. Self-serve has no Acceptance gate, so
// there they sit in Go-Live. Both entries share the key, so the tick is the
// same whichever gate shows it, and tier filtering shows exactly one.
//
// A completed first production job is the Time to Production benchmark and the
// finish line of a self-serve hub, so it sits in Go-Live on every tier.
export const OPERATIONAL_TASKS: BoardTask[] = [
  ...FIRST_DOCUMENTS.flatMap((task): BoardTask[] => [
    { ...task, stepKey: "gate:acceptance", owner: "you", tiers: PAID_TIERS },
    { ...task, stepKey: "gate:golive", owner: "you", tiers: ["self_serve"] }
  ]),
  {
    key: "first-job-completed",
    label: msg`Complete your first production job on the shop floor`,
    stepKey: "gate:golive",
    owner: "you",
    ready: [{ count: "jobsReleased", min: 1 }],
    evidence: "completedJobs"
  }
];
