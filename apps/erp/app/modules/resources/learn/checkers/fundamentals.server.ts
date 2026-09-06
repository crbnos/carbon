/**
 * Carbon Learn — Fundamentals challenge checkers.
 *
 * Server-only: never import this from the module barrel. Each checker returns
 * the FIRST unmet requirement in the order the curriculum lists it, so the
 * learner is told the next thing to do rather than everything at once.
 */

import type { LearnCheckResult } from "../types";
import type { CheckerContext } from "./shared.server";
import { fail } from "./shared.server";

/**
 * `fundamentals-create-item` — requirements, in curriculum order:
 * `item-exists`, `item-is-part`, `item-named`.
 */
export async function checkCreateItem({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const items = await reader.itemsCreatedBy(scope);

  if (items.length === 0) {
    return fail(
      "item-exists",
      "No item created by you since you started this challenge. Create a Part and check again."
    );
  }

  const parts = items.filter((item) => item.type === "Part");
  if (parts.length === 0) {
    const newest = items[0];
    return fail(
      "item-is-part",
      `${newest.readableId || "Your new item"} is a ${newest.type || "different type"}, not a Part — create an item of type Part`
    );
  }

  const named = parts.find((part) => part.name.trim().length > 0);
  if (!named) {
    return fail(
      "item-named",
      `${parts[0].readableId || "Your new part"} has no name — give it one you would recognise on a shelf`
    );
  }

  return {
    passed: true,
    evidence: { itemId: named.id, readableId: named.readableId }
  };
}
