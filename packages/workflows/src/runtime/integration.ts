import { integrationStepId } from "../definition/catalog";
import { linkState } from "../definition/links";
import {
  FAILURE_HANDLE,
  type IntegrationNode,
  SUCCESS_HANDLE
} from "../definition/schema";
import { renderTemplate, resolveValue } from "./resolve";
import type { NodeExecutor, RuntimeValue } from "./types";

const GONE = "This integration step is no longer available.";

/**
 * One step of a third-party integration. Deliberately separate from the action
 * executor: which piece it runs comes off its own catalog entry, so neither the
 * action path nor this one has to ask what the other kind is.
 *
 * One item only — batching belongs to the engine, which calls this once per item.
 * A record in prose becomes a link only where the catalog declares `links` (and
 * its gate holds — see `linkState`); everything else renders as plain text, so a
 * link can never ship to a vendor field that would show it as literal markup.
 */
export const integrationExecutor: NodeExecutor<IntegrationNode> = {
  permission: (node, catalog) =>
    catalog.getIntegration(integrationStepId(node.data.piece, node.data.action))
      ?.permission,

  execute: async (node, ctx) => {
    const id = integrationStepId(node.data.piece, node.data.action);
    const step = ctx.catalog.getIntegration(id);
    if (step === undefined) return { status: "Skipped", reason: GONE };

    const declared = { ...step.inputs, ...step.advancedInputs };
    const inputs: Record<string, RuntimeValue> = {};
    for (const [name, value] of Object.entries(node.data.inputs)) {
      const link = linkState(node, declared, name);
      const resolved =
        link.kind === "linked" && value.kind === "template"
          ? await renderTemplate(value, ctx, {
              linkFor: ctx.linkFor,
              format: link.format
            })
          : await resolveValue(value, ctx);
      if (!resolved.ok) return { status: "Skipped", reason: resolved.reason };
      // In a batch the one list input stands for the item this turn is on. Only a
      // slot declared single-valued can be that input (`batchCandidates`); a slot
      // declared as a list keeps its list, or a real list input on the same step
      // would be replaced by the item on every turn.
      inputs[name] =
        ctx.item !== undefined &&
        resolved.value.kind === "list" &&
        declared[name]?.type.kind !== "list"
          ? ctx.item
          : resolved.value;
      ctx.record?.(name, inputs[name]);
    }

    const outcome = await ctx.services.runIntegration(step.piece, inputs);
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
