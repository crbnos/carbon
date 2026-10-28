// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { OnboardingCountKey } from "../logic/status";

// The setup count shown as evidence next to a Setup Map row (its key in
// content/setup.ts). Evidence never completes a row: the customer still ticks
// it. Rows whose table company seeding always fills (units, payment terms,
// sequences, the chart of accounts) have no entry, because their count would
// read as done before anyone did anything.
export const SETUP_ROW_EVIDENCE: Partial<Record<string, OnboardingCountKey>> = {
  locations: "locations",
  "work-centers": "workCenters",
  processes: "processes",
  employees: "activeEmployees",
  parts: "parts",
  materials: "materials",
  tools: "tools",
  consumables: "consumables",
  customers: "customers",
  suppliers: "suppliers",
  "storage-units": "storageUnits"
};

// The setup counts shown on a nested product step (content/spine.ts), in order.
export const PRODUCT_STEP_EVIDENCE: Partial<
  Record<string, OnboardingCountKey[]>
> = {
  "prod:configure-bom": ["parts", "bomLines", "routingOperations"],
  "prod:purchase-make": ["purchaseOrdersFinalized", "jobsReleased"],
  "prod:serialize-sell": ["salesOrders"]
};

// How an operational task's evidence reads next to it ("2 sent"). Shown on the
// Plan and on Gate Review.
export const TASK_EVIDENCE_LABEL: Partial<
  Record<OnboardingCountKey, MessageDescriptor>
> = {
  quotesSent: msg`sent`,
  purchaseOrdersFinalized: msg`sent`,
  postedReceipts: msg`received`,
  salesOrders: msg`confirmed`,
  jobsReleased: msg`released`,
  completedJobs: msg`completed`
};

// How a product step's evidence counts read ("12 parts"). Shown on the next
// step card and on Gate Review.
export const PRODUCT_STEP_EVIDENCE_LABEL: Partial<
  Record<OnboardingCountKey, MessageDescriptor>
> = {
  parts: msg`parts`,
  bomLines: msg`BOM lines`,
  routingOperations: msg`operations`,
  purchaseOrdersFinalized: msg`purchase orders`,
  jobsReleased: msg`jobs released`,
  salesOrders: msg`sales orders`
};
