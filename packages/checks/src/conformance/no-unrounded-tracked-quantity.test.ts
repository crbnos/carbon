import { describe, expect, it } from "vitest";
import { noUnroundedTrackedQuantity } from "./no-unrounded-tracked-quantity";

const scan = (src: string, file = "a.ts") =>
  noUnroundedTrackedQuantity.scan(file, src);

describe("no-unrounded-tracked-quantity — the write", () => {
  it("flags inline arithmetic in a trackedEntity quantity set", () => {
    const src = [
      "await trx",
      '  .updateTable("trackedEntity")',
      "  .set({ quantity: Number(parent.quantity) + unpickQuantity })",
      '  .where("id", "=", parent.id)',
      "  .execute();"
    ].join("\n");
    const violations = scan(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(3);
    expect(violations[0]?.message).toMatch(/settleQuantity/);
  });

  it("accepts a statement that rounds, wherever the round sits", () => {
    const rounded = [
      "await trx",
      '  .updateTable("trackedEntity")',
      "  .set({ quantity: round(Number(parent.quantity) + unpickQuantity) })",
      "  .execute();"
    ].join("\n");
    expect(scan(rounded)).toHaveLength(0);

    // The common real shape: the arithmetic is an argument to settleQuantity on
    // an earlier line than the `quantity:` property it produces.
    const settled = [
      "await trx",
      '  .updateTable("trackedEntity")',
      "  .set(",
      "    settleQuantity({",
      "      quantity: targetQty - adjustmentQuantity,",
      "      status: currentStatus",
      "    })",
      "  )",
      "  .execute();"
    ].join("\n");
    expect(scan(settled)).toHaveLength(0);
  });

  it("accepts a quantity taken from a variable or the split builder", () => {
    const src = [
      "await trx",
      '  .updateTable("trackedEntity")',
      "  .set(split.parentUpdate)",
      "  .execute();",
      "await trx",
      '  .updateTable("trackedEntity")',
      "  .set({ quantity: drainedQty, status: settledStatus })",
      "  .execute();"
    ].join("\n");
    expect(scan(src)).toHaveLength(0);
  });

  it("does not read a quoted operator as arithmetic", () => {
    // eb("quantity", "+", delta) delegates the arithmetic to SQL; the operand
    // is a variable the caller rounded, and the "+" is a string literal.
    const src = [
      "await trx",
      '  .updateTable("trackedEntity")',
      '  .set((eb) => ({ quantity: eb("quantity", "+", delta) }))',
      "  .execute();"
    ].join("\n");
    expect(scan(src)).toHaveLength(0);
  });

  it("stops at the statement's own execute, so a later ledger insert is not blamed", () => {
    const src = [
      "await trx",
      '  .updateTable("trackedEntity")',
      "  .set({ quantity: drainedQty })",
      "  .execute();",
      "itemLedgerInserts.push({",
      "  quantity: -Math.abs(adjustmentQuantity),",
      "});"
    ].join("\n");
    expect(scan(src)).toHaveLength(0);
  });

  it("ignores commented-out arithmetic", () => {
    const src = [
      "await trx",
      '  .updateTable("trackedEntity")',
      "  // was: quantity: a - b",
      "  .set({ quantity: settled })",
      "  .execute();"
    ].join("\n");
    expect(scan(src)).toHaveLength(0);
  });

  it("does not scan the modules that implement the standard", () => {
    const src = [
      "await trx",
      '  .updateTable("trackedEntity")',
      "  .set({ quantity: a - b })",
      "  .execute();"
    ].join("\n");
    expect(
      scan(src, "packages/database/supabase/functions/shared/entity-drain.ts")
    ).toHaveLength(0);
  });
});

describe("no-unrounded-tracked-quantity — the split gate", () => {
  it("flags a raw compare on a stored entity quantity, either operand order", () => {
    const src = [
      "if (entityQuantity !== transferQuantity) {",
      "if (trackedEntity.quantity < quantity) {",
      "if (shipmentLine.shippedQuantity < trackedEntity.quantity) {"
    ].join("\n");
    const violations = scan(src);
    // Line 1 compares two locals — presumed rounded where they were defined.
    expect(violations.map((v) => v.line)).toEqual([2, 3]);
    expect(violations[0]?.message).toMatch(/isFullDraw/);
  });

  it("accepts the sanctioned gates", () => {
    const src = [
      "if (!isFullDraw(entityQuantity, transferQuantity)) {",
      "if (equals(Number(trackedEntity.quantity), quantity)) {",
      "if (round(onHand) <= round(Number(entity.quantity))) {"
    ].join("\n");
    expect(scan(src)).toHaveLength(0);
  });

  it("does not flag literal or nullish tests", () => {
    // "has any stock", "is this a serial", "was it selected" — not split gates.
    const src = [
      "if (entity.quantity > 0) {",
      "if (entity.quantity !== 1) {",
      "if (newEntityQuantity <= 0) {",
      "if (trackedEntity.quantity !== undefined) {",
      "if (entity.quantity === null) {"
    ].join("\n");
    expect(scan(src)).toHaveLength(0);
  });

  it("does not flag a non-entity row that happens to have a quantity", () => {
    // costLedger children, BOM lines, shipment lines — same property name,
    // different shape, and none of them are lots on a shelf.
    const src = [
      "if (Number(child.remainingQuantity ?? 0) === Number(child.quantity)) {",
      "if (!(parent.quantity > 0)) {",
      "if (line.quantity < required) {"
    ].join("\n");
    expect(scan(src)).toHaveLength(0);
  });
});

describe("no-unrounded-tracked-quantity — shapes that only look like compares", () => {
  it("does not read an arrow function's => as a > comparison", () => {
    const src = [
      "receivable.some((entity) => entity.quantity !== 1 || !entity.readableId)",
      "const qty = (entity) => entity.quantity;"
    ].join("\n");
    expect(scan(src)).toHaveLength(0);
  });

  it("still flags a real compare inside an arrow body", () => {
    const src = "entities.filter((e) => e.quantity < required)";
    // `e.quantity` is not entity-shaped; the entity-named one is.
    expect(scan(src)).toHaveLength(0);
    expect(
      scan("entities.filter((x) => x.entityQuantity > threshold)")
    ).toHaveLength(0);
    expect(
      scan("entities.filter((x) => x.trackedEntity.quantity > threshold)")
    ).toHaveLength(1);
  });
});
