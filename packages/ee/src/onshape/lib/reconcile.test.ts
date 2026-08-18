import { describe, expect, it } from "vitest";
import {
  type ExistingMaterial,
  isNoOpPlan,
  reconcileMethodMaterials
} from "./reconcile";

// Reconciling instead of delete-and-rebuild is the ONLY reason "Carbon keeps
// the BOP" is achievable: a surviving methodMaterial row keeps its
// methodOperationId, scrap, kit flag, sourcing, storage units, tags and its
// methodMaterialStep children. These pin that surviving rows are identified
// correctly, because a row wrongly classified as removed takes all of that
// with it.

const row = (
  id: string,
  itemId: string,
  quantity: number,
  order: number
): ExistingMaterial => ({ id, itemId, quantity, order });

describe("reconcileMethodMaterials", () => {
  it("leaves an identical list completely untouched", () => {
    const existing = [row("m1", "item_a", 1, 1), row("m2", "item_b", 2, 2)];
    const plan = reconcileMethodMaterials(existing, [
      { itemId: "item_a", quantity: 1, order: 1 },
      { itemId: "item_b", quantity: 2, order: 2 }
    ]);

    expect(plan.insert).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.unchanged).toHaveLength(2);
    expect(isNoOpPlan(plan)).toBe(true);
  });

  it("updates a changed quantity in place rather than replacing the row", () => {
    const plan = reconcileMethodMaterials(
      [row("m1", "item_a", 1, 1)],
      [{ itemId: "item_a", quantity: 4, order: 1 }]
    );

    // The row id survives — which is what keeps everything hanging off it.
    expect(plan.update).toEqual([
      { id: "m1", itemId: "item_a", quantity: 4, order: 1 }
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.insert).toEqual([]);
  });

  it("updates a reordered row without removing it", () => {
    const plan = reconcileMethodMaterials(
      [row("m1", "item_a", 1, 1)],
      [{ itemId: "item_a", quantity: 1, order: 5 }]
    );
    expect(plan.update).toHaveLength(1);
    expect(plan.remove).toEqual([]);
  });

  it("inserts a component Onshape added", () => {
    const plan = reconcileMethodMaterials(
      [row("m1", "item_a", 1, 1)],
      [
        { itemId: "item_a", quantity: 1, order: 1 },
        { itemId: "item_new", quantity: 3, order: 2 }
      ]
    );
    expect(plan.insert).toEqual([
      { itemId: "item_new", quantity: 3, order: 2 }
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.unchanged).toHaveLength(1);
  });

  it("removes a component Onshape dropped", () => {
    const plan = reconcileMethodMaterials(
      [row("m1", "item_a", 1, 1), row("m2", "item_gone", 1, 2)],
      [{ itemId: "item_a", quantity: 1, order: 1 }]
    );
    expect(plan.remove.map((r) => r.id)).toEqual(["m2"]);
    expect(plan.unchanged).toHaveLength(1);
  });

  it("handles a wholesale swap", () => {
    const plan = reconcileMethodMaterials(
      [row("m1", "old_a", 1, 1), row("m2", "old_b", 1, 2)],
      [
        { itemId: "new_a", quantity: 1, order: 1 },
        { itemId: "new_b", quantity: 1, order: 2 }
      ]
    );
    expect(plan.insert).toHaveLength(2);
    expect(plan.remove).toHaveLength(2);
    expect(plan.unchanged).toEqual([]);
  });

  it("empties the list when Onshape reports no children", () => {
    const plan = reconcileMethodMaterials([row("m1", "item_a", 1, 1)], []);
    expect(plan.remove).toHaveLength(1);
    expect(plan.insert).toEqual([]);
  });

  it("inserts everything into an empty method", () => {
    const plan = reconcileMethodMaterials(
      [],
      [{ itemId: "item_a", quantity: 1, order: 1 }]
    );
    expect(plan.insert).toHaveLength(1);
    expect(plan.remove).toEqual([]);
  });

  it("keeps the first of pre-existing duplicate rows and removes the rest", () => {
    // Carbon does not forbid two lines for one component; converging on
    // Onshape's single aggregated row means one has to go.
    const plan = reconcileMethodMaterials(
      [row("m1", "item_a", 1, 1), row("m2", "item_a", 1, 2)],
      [{ itemId: "item_a", quantity: 1, order: 1 }]
    );
    expect(plan.remove.map((r) => r.id)).toEqual(["m2"]);
    expect(plan.unchanged.map((r) => r.id)).toEqual(["m1"]);
  });

  it("ignores a repeated desired component rather than duplicating a row", () => {
    const plan = reconcileMethodMaterials(
      [],
      [
        { itemId: "item_a", quantity: 1, order: 1 },
        { itemId: "item_a", quantity: 9, order: 2 }
      ]
    );
    expect(plan.insert).toEqual([{ itemId: "item_a", quantity: 1, order: 1 }]);
  });

  it("reports a real change as not a no-op", () => {
    const plan = reconcileMethodMaterials(
      [row("m1", "item_a", 1, 1)],
      [{ itemId: "item_a", quantity: 2, order: 1 }]
    );
    expect(isNoOpPlan(plan)).toBe(false);
  });
});

describe("reconcileMethodMaterials — refused rows are protected", () => {
  // The worst defect found in review, reported independently by three audit
  // lenses: a row the import REFUSES (revision missing, ambiguous, failed mint)
  // is absent from `desired`, so without protection reconciliation reads it as
  // "Onshape dropped this" and DELETES the line — while the user is told the
  // row was merely skipped. Refusing and deleting are opposite outcomes.

  it("keeps a line whose component the import refused to resolve", () => {
    const plan = reconcileMethodMaterials(
      [row("m1", "item_a", 1, 1), row("m2", "item_refused", 3, 2)],
      [{ itemId: "item_a", quantity: 1, order: 1 }],
      { protectedItemIds: ["item_refused"] }
    );

    expect(plan.remove).toEqual([]);
    expect(plan.protected.map((r) => r.id)).toEqual(["m2"]);
    // ...and its quantity is untouched, not reset.
    expect(plan.protected[0]!.quantity).toBe(3);
  });

  it("still removes a component Onshape genuinely dropped", () => {
    const plan = reconcileMethodMaterials(
      [row("m1", "item_a", 1, 1), row("m2", "item_gone", 1, 2)],
      [{ itemId: "item_a", quantity: 1, order: 1 }],
      { protectedItemIds: ["item_refused"] }
    );
    expect(plan.remove.map((r) => r.id)).toEqual(["m2"]);
    expect(plan.protected).toEqual([]);
  });

  it("protects a refused component even when the method would otherwise empty", () => {
    const plan = reconcileMethodMaterials(
      [row("m1", "item_refused", 2, 1)],
      [],
      { protectedItemIds: ["item_refused"] }
    );
    expect(plan.remove).toEqual([]);
    expect(plan.protected).toHaveLength(1);
    expect(isNoOpPlan(plan)).toBe(true);
  });

  it("prefers the desired line when a component is both protected and resolved", () => {
    // A component can be refused on one row and resolved on another; the
    // resolution wins, since we now know what it should be.
    const plan = reconcileMethodMaterials(
      [row("m1", "item_a", 1, 1)],
      [{ itemId: "item_a", quantity: 5, order: 1 }],
      { protectedItemIds: ["item_a"] }
    );
    expect(plan.update).toHaveLength(1);
    expect(plan.protected).toEqual([]);
  });

  it("behaves exactly as before when nothing is protected", () => {
    const plan = reconcileMethodMaterials(
      [row("m1", "item_a", 1, 1), row("m2", "item_gone", 1, 2)],
      [{ itemId: "item_a", quantity: 1, order: 1 }]
    );
    expect(plan.remove.map((r) => r.id)).toEqual(["m2"]);
    expect(plan.protected).toEqual([]);
  });
});
