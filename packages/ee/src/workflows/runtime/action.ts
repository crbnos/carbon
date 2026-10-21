// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  type ActionNode,
  FAILURE_HANDLE,
  SUCCESS_HANDLE
} from "../definition/schema";
import { resolveStepInputs } from "./resolve";
import type { NodeExecutor } from "./types";

const GONE = "This step is no longer available.";

// One item only. Batching belongs to the engine, which calls this once per item —
// a loop here would make one step row stand for many effects.
export const actionExecutor: NodeExecutor<ActionNode> = {
  permission: (node, catalog) =>
    catalog.getAction(node.data.action)?.permission,

  execute: async (node, ctx) => {
    const action = ctx.catalog.getAction(node.data.action);
    if (action === undefined) return { status: "Skipped", reason: GONE };

    const resolved = await resolveStepInputs(
      node.data.inputs,
      action.inputs,
      ctx
    );
    if (!resolved.ok) return { status: "Skipped", reason: resolved.reason };

    const outcome = await ctx.services.runAction(
      node.data.action,
      resolved.inputs
    );
    if (!outcome.ok) {
      return { status: "Failed", error: outcome.error, handle: FAILURE_HANDLE };
    }

    return {
      status: "Succeeded",
      outputs: outcome.outputs,
      handle: SUCCESS_HANDLE,
      ...(outcome.summary === undefined ? {} : { summary: outcome.summary })
    };
  }
};
