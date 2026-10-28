// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { integrationStepId } from "../definition/catalog";
import {
  FAILURE_HANDLE,
  type IntegrationNode,
  SUCCESS_HANDLE
} from "../definition/schema";
import { resolveStepInputs } from "./resolve";
import type { NodeExecutor } from "./types";

const GONE = "This integration step is no longer available.";

/**
 * One step of a third-party integration. Deliberately separate from the action
 * executor: which piece it runs comes off its own catalog entry, so neither the
 * action path nor this one has to ask what the other kind is.
 *
 * One item only — batching belongs to the engine, which calls this once per item.
 */
export const integrationExecutor: NodeExecutor<IntegrationNode> = {
  permission: (node, catalog) =>
    catalog.getIntegration(integrationStepId(node.data.piece, node.data.action))
      ?.permission,

  execute: async (node, ctx) => {
    const id = integrationStepId(node.data.piece, node.data.action);
    const step = ctx.catalog.getIntegration(id);
    if (step === undefined) return { status: "Skipped", reason: GONE };

    const resolved = await resolveStepInputs(
      node.data.inputs,
      { ...step.inputs, ...step.advancedInputs },
      ctx
    );
    if (!resolved.ok) return { status: "Skipped", reason: resolved.reason };

    const outcome = await ctx.services.runIntegration(
      step.piece,
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
