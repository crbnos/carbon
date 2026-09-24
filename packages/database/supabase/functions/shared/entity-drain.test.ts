import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  settleQuantity,
  statusAfterQuantityChange
} from "./entity-drain.ts";
import { assertThrows } from "https://deno.land/std@0.175.0/testing/asserts.ts";

Deno.test("draining to zero Consumes the lot", () => {
  assertEquals(statusAfterQuantityChange(0, "Available"), "Consumed");
});

Deno.test("a positive quantity keeps the current status", () => {
  assertEquals(statusAfterQuantityChange(3, "Available"), "Available");
  assertEquals(statusAfterQuantityChange(3, "On Hold"), "On Hold");
  assertEquals(statusAfterQuantityChange(3, "Reserved"), "Reserved");
});

Deno.test("a Scrapped lot stays Scrapped even at zero", () => {
  assertEquals(statusAfterQuantityChange(0, "Scrapped"), "Scrapped");
  assertEquals(statusAfterQuantityChange(5, "Scrapped"), "Scrapped");
});

Deno.test("a float-residue zero still Consumes", () => {
  // round(1 - 0.98 - 0.02) is exactly 0 → Consumed.
  assertEquals(
    statusAfterQuantityChange(1 - 0.98 - 0.02, "Available"),
    "Consumed"
  );
});

Deno.test("settleQuantity: rounds and Consumes a residue drain in one step", () => {
  // The unpick residue case: a child holding 0.020000000000000018 gives back
  // 0.02 — the settled quantity is an exact 0, so the lot is Consumed, not an
  // Available husk holding 1.8e-17.
  assertEquals(
    settleQuantity({ quantity: 0.020000000000000018 - 0.02, status: "Available" }),
    { quantity: 0, status: "Consumed" }
  );
});

Deno.test("settleQuantity: a surviving remainder keeps its status", () => {
  assertEquals(settleQuantity({ quantity: 1 - 0.98, status: "Available" }), {
    quantity: 0.02,
    status: "Available"
  });
});

Deno.test("settleQuantity: a Scrapped lot stays Scrapped at zero", () => {
  assertEquals(settleQuantity({ quantity: 0, status: "Scrapped" }), {
    quantity: 0,
    status: "Scrapped"
  });
});

Deno.test("settleQuantity: refuses a negative settle rather than clamping", () => {
  assertThrows(
    () => settleQuantity({ quantity: -0.5, status: "Available" }),
    Error,
    "refusing to write a negative tracked quantity"
  );
  // A caller-supplied refusal wins, so each writer explains its own divergence.
  assertThrows(
    () =>
      settleQuantity({
        quantity: -1,
        status: "Available",
        refusal: "partial consumption must be unconsumed first"
      }),
    Error,
    "partial consumption must be unconsumed first"
  );
});

Deno.test("settleQuantity: float noise below a minor unit is not negative", () => {
  // round(-1e-17) is 0, so this settles instead of refusing.
  assertEquals(settleQuantity({ quantity: -1e-17, status: "Available" }), {
    quantity: 0,
    status: "Consumed"
  });
});
