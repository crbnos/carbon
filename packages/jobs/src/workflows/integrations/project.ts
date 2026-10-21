// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { fromJson, type RuntimeValue } from "@carbon/ee/workflows";
import { getLogger } from "@carbon/logger";
import { describeOutputs, readField } from "./outputs";
import type { PieceOutputSchema } from "./types";

const logger = getLogger("jobs", "workflows", "integrations");

/** Shapes a vendor's response into the outputs the catalog declared for the step.
 *
 * Deliberately forgiving. `outputSchema` is vendor-authored and validated by nobody
 * — upstream's own `run()` returns `Promise<unknown | void>` — so a response that
 * disagrees with it must degrade field by field, never fail a step that really did
 * call the vendor. The raw JSON stays available on `result` regardless.
 */
export function projectOutputs(
  schema: PieceOutputSchema | undefined,
  response: unknown,
  options: {
    /** Sort each projected list's rows by this field, ascending, BEFORE the
     * size cap — so the cap cuts the tail of the ordering, never a whole
     * category the vendor happened to return last. */
    sortItemsBy?: string;
  } = {}
): Record<string, RuntimeValue> {
  if (schema === undefined) return { count: countOf(undefined) };

  try {
    const outputs: Record<string, RuntimeValue> = {};
    let listed: unknown[] | undefined;

    for (const [name, { type, field }] of Object.entries(
      describeOutputs(schema)
    )) {
      // Every level is read from its own declared path, so a remapped
      // `start.dateTime` lands on the element rather than the response root.
      const value = readField(field, response);

      if (type.kind === "list") {
        const items = Array.isArray(value) ? value : [];
        // The BIGGEST declared list, not whichever the schema happened to name
        // first: a response with an empty `warnings` beside ten real `items`
        // reported zero purely because of key order.
        if (listed === undefined || items.length > listed.length)
          listed = items;
        // `fromJson` caps the list, after the sort.
        outputs[name] = fromJson(type, sortRows(items, options.sortItemsBy));
        continue;
      }

      outputs[name] = fromJson(type, value);
    }

    outputs.count = countOf(listed);
    return outputs;
  } catch (cause) {
    // Shaping is a convenience over the raw result; losing it must never lose the
    // call that already happened.
    logger.warn("Could not project an integration response", {
      message: cause instanceof Error ? cause.message : ""
    });
    // Nothing was shaped, so nothing is known to have come back.
    return { count: countOf([]) };
  }
}

/** Ascending by one projected field; rows without it sink to the end. ISO
 * datetimes compare correctly as strings, which is what the field holds for
 * every sort the allowlist declares. Copied then sorted, so equal keys keep
 * vendor order only as far as the engine's sort is stable (V8's is). */
function sortRows(rows: unknown[], by: string | undefined): unknown[] {
  if (by === undefined) return rows;
  const keyOf = (row: unknown) =>
    row !== null && typeof row === "object"
      ? (row as Record<string, unknown>)[by]
      : undefined;
  return [...rows].sort((a, b) => {
    const left = keyOf(a);
    const right = keyOf(b);
    if (left === right) return 0;
    if (left === undefined || left === null) return 1;
    if (right === undefined || right === null) return -1;
    return String(left) < String(right) ? -1 : 1;
  });
}

/** How many items came back: a list's length, else 1 for a single response. */
function countOf(items: unknown[] | undefined): RuntimeValue {
  return {
    kind: "primitive",
    of: "number",
    value: items === undefined ? 1 : items.length
  };
}
