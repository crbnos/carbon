// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getPath } from "@carbon/ee/integrations/secrets";
import {
  fromJson,
  MAX_LIST_ITEMS,
  type RuntimeValue
} from "@carbon/ee/workflows";
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
    /** Sort each list's rows, earliest first, BEFORE the size cap — so the cap
     * cuts the tail of the ordering, never a whole category the vendor happened
     * to return last. Paths into the vendor's own element, first present wins
     * (Google: `start.dateTime`, else an all-day event's `start.date`). */
    sortItemsBy?: readonly string[];
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
        // `fromJson` caps the list, after the sort. The sort reads the vendor's
        // elements, which line up one to one with the projected rows.
        const raw = getPath(response, field.value ?? field.key);
        outputs[name] = fromJson(
          type,
          sortRows(items, Array.isArray(raw) ? raw : [], options.sortItemsBy)
        );
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

/** Earliest first by the moment each vendor element names at `paths`; rows with
 * none sink to the end. Compared as instants, not as text: `09:00+05:30` is
 * before `08:00-07:00`, and an all-day `2026-09-05` reads as that day's start.
 * Equal keys keep vendor order (the sort is stable). */
function sortRows(
  rows: unknown[],
  raw: unknown[],
  paths: readonly string[] | undefined
): unknown[] {
  if (paths === undefined || paths.length === 0) return rows;
  const momentOf = (index: number) => {
    for (const path of paths) {
      const value = getPath(raw[index], path);
      if (typeof value !== "string" || value === "") continue;
      const moment = Date.parse(value);
      if (!Number.isNaN(moment)) return moment;
    }
    return null;
  };
  const moments = rows.map((_, index) => momentOf(index));
  return rows
    .map((row, index) => ({ row, moment: moments[index] ?? null }))
    .sort((a, b) => {
      if (a.moment === b.moment) return 0;
      if (a.moment === null) return 1;
      if (b.moment === null) return -1;
      return a.moment - b.moment;
    })
    .map(({ row }) => row);
}

/** How many items came back that a later step will never see: `count` is what the
 * vendor returned, but a list keeps only the first `MAX_LIST_ITEMS`. */
export function droppedItems(outputs: Record<string, RuntimeValue>): number {
  const count = outputs.count;
  if (count?.kind !== "primitive" || typeof count.value !== "number") return 0;
  return Math.max(0, count.value - MAX_LIST_ITEMS);
}

/** How many items came back: a list's length, else 1 for a single response. */
function countOf(items: unknown[] | undefined): RuntimeValue {
  return {
    kind: "primitive",
    of: "number",
    value: items === undefined ? 1 : items.length
  };
}
