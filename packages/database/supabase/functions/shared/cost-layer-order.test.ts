import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  leavingTrackedEntityIds,
  orderLayersForConsumption,
} from "./cost-layer-order.ts";

const layer = (id: string, trackedEntityId: string | null = null) => ({
  id,
  trackedEntityId,
});
const ids = (layers: { id: string }[]) => layers.map((l) => l.id);

Deno.test("with no serial leaving, stamped layers go after every unstamped one", () => {
  // FIFO order: a returned unit's layer (r1) sits between two receipts.
  const layers = [layer("a"), layer("r1", "unit-1"), layer("b")];
  assertEquals(ids(orderLayersForConsumption(layers)), ["a", "b", "r1"]);
});

Deno.test("the serial leaving is relieved from its own layer first", () => {
  const layers = [layer("a"), layer("r1", "unit-1"), layer("b")];
  assertEquals(
    ids(orderLayersForConsumption(layers, ["unit-1"])),
    ["r1", "a", "b"]
  );
});

Deno.test("another unit's layer is the last resort", () => {
  const layers = [
    layer("r2", "unit-2"),
    layer("a"),
    layer("r1", "unit-1"),
  ];
  assertEquals(
    ids(orderLayersForConsumption(layers, ["unit-1"])),
    ["r1", "a", "r2"]
  );
});

Deno.test("several units leaving keep their layers in the incoming order", () => {
  const layers = [
    layer("r3", "unit-3"),
    layer("a"),
    layer("r1", "unit-1"),
    layer("r2", "unit-2"),
  ];
  assertEquals(
    ids(orderLayersForConsumption(layers, ["unit-2", "unit-3"])),
    ["r3", "r2", "a", "r1"]
  );
});

Deno.test("the ids leaving are the item's outgoing tracked rows", () => {
  const rows = [
    { itemId: "item", trackedEntityId: "unit-1", quantity: -1 },
    { itemId: "item", trackedEntityId: "unit-2", quantity: -1 },
    { itemId: "item", trackedEntityId: "unit-2", quantity: -1 },
    { itemId: "item", trackedEntityId: null, quantity: -3 },
    { itemId: "item", trackedEntityId: "unit-9", quantity: 1 },
    { itemId: "other", trackedEntityId: "unit-5", quantity: -1 },
  ];
  assertEquals(leavingTrackedEntityIds(rows, "item"), ["unit-1", "unit-2"]);
});
