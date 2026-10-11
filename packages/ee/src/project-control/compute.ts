// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { equals, round } from "@carbon/utils";

// The pure project control engine (Phase 5c): budget availability now, earned
// value in the functions below it. No database access, so the client-safe
// barrel can export it.

/** The element fields the budget check reads. */
export type ElementNode = {
  id: string;
  parentId: string | null;
  budget: number | null;
};

/**
 * The element itself, else its nearest ancestor with a budget. Null when none
 * has one. A budget of 0 is a budget. A parent loop stops the walk.
 */
export function nearestBudgetedAncestor(
  elementId: string,
  elements: ElementNode[]
): string | null {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const seen = new Set<string>();
  let current = byId.get(elementId);
  while (current && !seen.has(current.id)) {
    if (current.budget !== null) return current.id;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

/** The root and every descendant. */
export function subtreeIds(rootId: string, elements: ElementNode[]): string[] {
  const children = new Map<string, string[]>();
  for (const element of elements) {
    if (!element.parentId) continue;
    const siblings = children.get(element.parentId) ?? [];
    siblings.push(element.id);
    children.set(element.parentId, siblings);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return ids;
}

/**
 * Compares a budget with its committed and actual cost plus a new amount.
 * The limit is the budget plus the tolerance, a fraction of the budget.
 */
export function budgetAvailability(input: {
  budget: number;
  committed: number;
  actual: number;
  newAmount: number;
  tolerancePercent: number;
}): { limit: number; projected: number; overBy: number; over: boolean } {
  const limit = input.budget * (1 + input.tolerancePercent);
  const projected = input.committed + input.actual + input.newAmount;
  const over = projected > limit && !equals(projected, limit);
  const overBy = Math.max(0, round(projected - limit));
  return { limit, projected, overBy, over };
}
