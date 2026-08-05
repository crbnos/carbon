import {
  DEFAULT_OUTPUT,
  FAILURE_HANDLE,
  type LookupNode,
  SUCCESS_HANDLE
} from "../definition/schema";
import { resolveValue } from "./resolve";
import type { NodeExecutor, SearchCriterion } from "./types";

const NOTHING_MATCHED = "Nothing matched this search.";

function summarise(matched: number, dropped: number): string {
  return dropped === 0
    ? `Found ${matched} of ${matched}.`
    : `Found ${matched} of ${matched + dropped}; ${dropped} were not used.`;
}

export const lookupExecutor: NodeExecutor<LookupNode> = {
  permission: (node, catalog) =>
    catalog.getEntity(node.data.entity)?.permission,

  execute: async (node, ctx) => {
    // An entity with no declared permission would make `permission()` return
    // undefined, which the engine reads as "checks nothing". Refuse instead.
    if (ctx.catalog.getEntity(node.data.entity)?.permission === undefined) {
      return {
        status: "Failed",
        error: `We no longer know how to look up a ${node.data.entity}.`,
        handle: FAILURE_HANDLE
      };
    }

    const criteria: SearchCriterion[] = [];
    for (const rule of node.data.match) {
      // Publishing blocks a half-filled rule; a draft that reached here skips.
      if (rule.field === "" || rule.value === undefined) {
        return {
          status: "Skipped",
          reason: "This lookup has a match rule that was never filled in."
        };
      }
      const resolved = await resolveValue(rule.value, ctx);
      if (!resolved.ok) return { status: "Skipped", reason: resolved.reason };
      criteria.push({
        field: rule.field,
        operator: rule.operator,
        value: resolved.value
      });
      // `field` is not unique across rules (two rules may bracket one date), so the
      // index disambiguates without hiding either value.
      ctx.record?.(
        criteria.filter((c) => c.field === rule.field).length > 1
          ? `${rule.field} #${criteria.length}`
          : rule.field,
        resolved.value
      );
    }

    const outcome = await ctx.services.search({
      entity: node.data.entity,
      returns: node.data.returns,
      criteria
    });
    if (!outcome.ok) {
      return {
        status: "Failed",
        error: outcome.error,
        handle: FAILURE_HANDLE
      };
    }

    // A list that matched nothing is an empty list; a single record that matched
    // nothing has no value to hand on, so that path fails instead.
    if (outcome.matched === 0 && node.data.returns === "one") {
      return {
        status: "Failed",
        error: NOTHING_MATCHED,
        handle: FAILURE_HANDLE
      };
    }

    return {
      status: "Succeeded",
      outputs: { [DEFAULT_OUTPUT]: outcome.value },
      handle: SUCCESS_HANDLE,
      summary: summarise(outcome.matched, outcome.dropped)
    };
  }
};
