// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const WORKFLOWS_PAGES = [
  {
    id: "workflows.workflows",
    label: "Workflows",
    maxLevel: "Full",
    tables: [
      "workflow",
      "workflowVersion",
      "workflowTriggerEvent",
      "eventSystemSubscription"
    ],
    paths: ["/x/workflows", "/x/workflow/"]
  },
  {
    id: "workflows.runs",
    label: "Runs",
    maxLevel: "View",
    tables: ["workflowRun", "workflowStepRun"],
    readers: ["workflow", "workflowVersion"],
    paths: ["/x/workflows/runs"]
  }
] as const satisfies readonly Page[];
