import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { statusAfterQuantityChange } from "./entity-drain.ts";

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
