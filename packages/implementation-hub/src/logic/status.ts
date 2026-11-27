// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { StateKind } from "../types";

// Pure summaries behind the hub's setup counts. The hub shows them next to its
// steps as evidence, and an agent reads them over MCP
// (`shared_getOnboardingStatus`). `getSetupCounts` (`../server`) runs the
// queries; these decide what the results mean.

// The records the setup steps and the first live documents depend on. Carbon's
// onboarding playbook cites these names, so a rename here must be made there
// too.
export const ONBOARDING_COUNT_KEYS = [
  "locations",
  "processes",
  "workCenters",
  "supplierProcesses",
  "activeEmployees",
  "suppliers",
  "customers",
  "items",
  "parts",
  "materials",
  "tools",
  "consumables",
  "storageUnits",
  "bomLines",
  "routingOperations",
  "quotesSent",
  "salesOrders",
  "purchaseOrdersFinalized",
  "postedReceipts",
  "jobs",
  "jobsReleased",
  "operationsDone",
  "completedJobs"
] as const;

export type OnboardingCountKey = (typeof ONBOARDING_COUNT_KEYS)[number];

export type OnboardingCountResult = { count: number | null; error: unknown };

/** A failed read is null and listed in `unavailable`, so it is never mistaken
 *  for zero records. */
export function summarizeOnboardingCounts(
  results: Partial<Record<OnboardingCountKey, OnboardingCountResult>>
) {
  const counts = {} as Record<OnboardingCountKey, number | null>;
  const unavailable: OnboardingCountKey[] = [];
  for (const key of ONBOARDING_COUNT_KEYS) {
    const result = results[key];
    if (!result || result.error) {
      counts[key] = null;
      unavailable.push(key);
    } else {
      counts[key] = result.count ?? 0;
    }
  }
  return { counts, unavailable };
}

// Gates, tasks and product steps store "todo" | "prog" | "blocked" | "done";
// checks store "1" or "0". Scope flags and format rows also store "1", but they
// mark a requirement in scope or a row configured, not a step finished.
const STEP_KINDS: StateKind[] = ["gate", "task", "productStep"];

export function summarizeHubProgress(
  states: { kind: StateKind; value: string }[]
) {
  const steps = states.filter((state) => STEP_KINDS.includes(state.kind));
  const checks = states.filter((state) => state.kind === "check");
  return {
    stepsDone:
      steps.filter((state) => state.value === "done").length +
      checks.filter((state) => state.value === "1").length,
    stepsInProgress: steps.filter((state) => state.value === "prog").length,
    stepsBlocked: steps.filter((state) => state.value === "blocked").length
  };
}
