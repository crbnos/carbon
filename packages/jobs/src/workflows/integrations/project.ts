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
  response: unknown
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
        const rows = items
          .slice(0, MAX_LIST_ITEMS)
          .map((item) =>
            Object.fromEntries(
              Object.entries(where.items ?? {}).map(([field, path]) => [
                field,
                readPath(item, path)
              ])
            )
          );
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

/** How many items came back: a list's length, else 1 for a single response. */
function countOf(items: unknown[] | undefined): RuntimeValue {
  return {
    kind: "primitive",
    of: "number",
    value: items === undefined ? 1 : items.length
  };
}
