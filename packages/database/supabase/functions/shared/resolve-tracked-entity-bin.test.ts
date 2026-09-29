import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { resolveTrackedEntityBin } from "./resolve-tracked-entity-bin.ts";

const row = (
  trackedEntityId: string | null,
  storageUnitId: string | null,
  quantity: number
) => ({ trackedEntityId, storageUnitId, quantity });

Deno.test("returns the bin with the highest positive net on-hand", () => {
  // te has 3 at lineside (net), 0 at source (picked and moved).
  const ledgers = [
    row("te", "source", 5),
    row("te", "source", -5),
    row("te", "lineside", 3)
  ];
  assertEquals(resolveTrackedEntityBin(ledgers, "te"), "lineside");
});

Deno.test("ignores other entities' rows", () => {
  const ledgers = [row("other", "binX", 10), row("te", "binY", 2)];
  assertEquals(resolveTrackedEntityBin(ledgers, "te"), "binY");
});

Deno.test("nets multiple rows per bin before choosing", () => {
  const ledgers = [
    row("te", "a", 4),
    row("te", "a", -3), // a nets to 1
    row("te", "b", 2) // b nets to 2 → wins
  ];
  assertEquals(resolveTrackedEntityBin(ledgers, "te"), "b");
});

Deno.test("falls back to first bin seen when nothing nets positive", () => {
  const ledgers = [row("te", "a", 5), row("te", "a", -5)];
  assertEquals(resolveTrackedEntityBin(ledgers, "te"), "a");
});

Deno.test("returns null when the entity has no bins", () => {
  assertEquals(resolveTrackedEntityBin([row("other", "a", 1)], "te"), null);
  assertEquals(resolveTrackedEntityBin([row("te", null, 1)], "te"), null);
});
