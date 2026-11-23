// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { expect, it } from "vitest";
import type { WorkflowNode, WorkflowNodeType } from "../definition/schema";
import { executorFor } from "./executors";

const nodeOf = (type: WorkflowNodeType) =>
  ({ id: "n1", type, position: { x: 0, y: 0 }, data: {} }) as WorkflowNode;

// The walk starts from the trigger rather than running it; every other kind must run.
it.each<[WorkflowNodeType, boolean]>([
  ["trigger", false],
  ["condition", true],
  ["filter", true],
  ["lookup", true],
  ["compute", true],
  ["action", true]
])("a %s node has an executor: %s", (type, runs) => {
  expect(executorFor(nodeOf(type)) !== undefined).toBe(runs);
});
