import { getLogger } from "@carbon/logger";
import {
  fromColumn,
  MAX_LIST_ITEMS,
  type RuntimeValue
} from "@carbon/workflows";
import { readPath, toOutputPaths, toOutputTypes } from "./outputs";
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
    const types = toOutputTypes(schema);
    const paths = toOutputPaths(schema);
    const outputs: Record<string, RuntimeValue> = {};
    let listed: unknown[] | undefined;

    for (const [name, type] of Object.entries(types)) {
      const where = paths[name];
      if (where === undefined) continue;
      const raw = readPath(response, where.path);

      if (where.items !== undefined) {
        // A list field: read each element's own declared paths, so a remapped
        // `start.dateTime` lands on the element rather than the response root.
        const items = Array.isArray(raw) ? raw : [];
        // The BIGGEST declared list, not whichever the schema happened to name
        // first: a response with an empty `warnings` beside ten real `items`
        // reported zero purely because of key order.
        if (listed === undefined || items.length > listed.length)
          listed = items;
        const rows = sortRows(
          items.map((item) =>
            Object.fromEntries(
              Object.entries(where.items ?? {}).map(([field, path]) => [
                field,
                readPath(item, path)
              ])
            )
          ),
          options.sortItemsBy
        ).slice(0, MAX_LIST_ITEMS);
        outputs[name] = fromColumn(type, rows);
        continue;
      }

      outputs[name] = fromColumn(type, raw);
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
function sortRows(
  rows: Record<string, unknown>[],
  by: string | undefined
): Record<string, unknown>[] {
  if (by === undefined) return rows;
  return [...rows].sort((a, b) => {
    const left = a[by];
    const right = b[by];
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
