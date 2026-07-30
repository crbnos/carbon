import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  planInventoryCountPost,
  type PlannableLine,
} from "./plan-post.ts";

// Unit tests for the pure planning core: the reconciliation delta math
// (`counted - systemQuantity`). The FOR UPDATE lock, status flip, and serial 0/1
// validation are DB-level and exercised in the browser/integration verification.

type Line = PlannableLine & { postedItemLedgerId: string | null };

const line = (overrides: Partial<Line>): Line => ({
  id: "icl_1",
  itemId: "item_1",
  systemQuantity: 10,
  countedQuantity: 10,
  postedItemLedgerId: null,
  ...overrides,
});

Deno.test("delta = counted - snapshot (positive)", () => {
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: 8, countedQuantity: 10 }),
  ]);
  assertEquals(planned[0].delta, 2);
});

Deno.test("delta is negative when counted is below snapshot", () => {
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: 5, countedQuantity: 3 }),
  ]);
  assertEquals(planned[0].delta, -2);
});

Deno.test("delta is 0 when counted matches the snapshot", () => {
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: 7, countedQuantity: 7 }),
  ]);
  assertEquals(planned[0].delta, 0);
});

Deno.test("reconciliation posts the reviewed variance, not counted - live", () => {
  // Snapshot 10, counter found 8 (−2). A +5 receipt landed since the snapshot;
  // the delta must still be −2 (applied on top of the receipt), NOT 8 − 15.
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: 10, countedQuantity: 8 }),
  ]);
  assertEquals(planned[0].delta, -2);
});

Deno.test("string NUMERIC quantities are coerced", () => {
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: "8", countedQuantity: "10.5" }),
  ]);
  assertEquals(planned[0].delta, 2.5);
});

Deno.test("the full line is preserved on the plan (e.g. postedItemLedgerId)", () => {
  const { planned } = planInventoryCountPost([
    line({ systemQuantity: 12, countedQuantity: 8, postedItemLedgerId: "il_orig" }),
  ]);
  assertEquals(planned[0].delta, -4);
  assertEquals(planned[0].line.postedItemLedgerId, "il_orig");
});

Deno.test("plans every line", () => {
  const { planned } = planInventoryCountPost([
    line({ id: "a", systemQuantity: 5, countedQuantity: 5 }),
    line({ id: "b", systemQuantity: 5, countedQuantity: 9 }),
    line({ id: "c", systemQuantity: 5, countedQuantity: 1 }),
  ]);
  assertEquals(planned.map((p) => p.delta), [0, 4, -4]);
});
