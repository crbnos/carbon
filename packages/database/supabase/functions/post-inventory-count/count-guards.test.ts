import {
  assertEquals,
  assertThrows
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { resolveCountedEntity } from "./count-guards.ts";

Deno.test("applies the delta to the live quantity", () => {
  assertEquals(
    resolveCountedEntity({
      currentQuantity: 10,
      delta: -3,
      currentStatus: "Available"
    }),
    { quantity: 7, status: "Available" }
  );
});

Deno.test("landing on exactly zero Consumes the lot", () => {
  assertEquals(
    resolveCountedEntity({
      currentQuantity: 4,
      delta: -4,
      currentStatus: "Available"
    }),
    { quantity: 0, status: "Consumed" }
  );
});

Deno.test("a delta that would drive the quantity negative is refused", () => {
  // Stock moved since the snapshot — recount rather than clamp/desync.
  assertThrows(() =>
    resolveCountedEntity({
      currentQuantity: 2,
      delta: -5,
      currentStatus: "Available"
    })
  );
});

Deno.test("a Scrapped lot counted to zero stays Scrapped", () => {
  assertEquals(
    resolveCountedEntity({
      currentQuantity: 1,
      delta: -1,
      currentStatus: "Scrapped"
    }),
    { quantity: 0, status: "Scrapped" }
  );
});
