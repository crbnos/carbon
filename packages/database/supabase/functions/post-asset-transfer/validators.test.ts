import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  CLOSED_JOB_STATUSES,
  payloadValidator,
  resolveCapitalizationStock,
  RETURNABLE_ASSET_STATUSES,
} from "./validators.ts";

const scope = { companyId: "company_1", userId: "user_1" };

Deno.test("capitalize accepts the inventory payload with its optional fields absent", () => {
  const parsed = payloadValidator.parse({
    type: "capitalize",
    fixedAssetClassId: "class_fleet",
    itemId: "item_1",
    trackedEntityId: "te_1",
    locationId: "loc_1",
    transferDate: "2026-09-22",
    ...scope,
  });
  assertEquals(parsed.type, "capitalize");
  if (parsed.type === "capitalize") {
    assertEquals(parsed.storageUnitId, undefined);
    assertEquals(parsed.name, undefined);
    assertEquals(parsed.fixedAssetId, undefined);
  }
});

Deno.test("capitalize carries an existing Draft asset id and a name when given", () => {
  const parsed = payloadValidator.parse({
    type: "capitalize",
    fixedAssetClassId: "class_fleet",
    itemId: "item_1",
    trackedEntityId: "te_1",
    locationId: "loc_1",
    storageUnitId: "bin_1",
    transferDate: "2026-09-22",
    name: "Van VIN-001",
    fixedAssetId: "fa_draft",
    ...scope,
  });
  if (parsed.type !== "capitalize") throw new Error("wrong variant");
  assertEquals(parsed.fixedAssetId, "fa_draft");
  assertEquals(parsed.name, "Van VIN-001");
  assertEquals(parsed.storageUnitId, "bin_1");
});

Deno.test("return needs the asset, the location and the transfer date", () => {
  const parsed = payloadValidator.parse({
    type: "return",
    fixedAssetId: "fa_1",
    locationId: "loc_1",
    transferDate: "2027-01-15",
    ...scope,
  });
  assertEquals(parsed.type, "return");
  assertThrows(() =>
    payloadValidator.parse({
      type: "return",
      fixedAssetId: "fa_1",
      transferDate: "2027-01-15",
      ...scope,
    })
  );
});

Deno.test("attachJob needs only the asset and the job", () => {
  const parsed = payloadValidator.parse({
    type: "attachJob",
    fixedAssetId: "fa_cip",
    jobId: "job_1",
    ...scope,
  });
  assertEquals(parsed.type, "attachJob");
  assertThrows(() =>
    payloadValidator.parse({
      type: "attachJob",
      fixedAssetId: "fa_cip",
      ...scope,
    })
  );
});

Deno.test("capitalizeCip needs the target class and an in-service date", () => {
  const parsed = payloadValidator.parse({
    type: "capitalizeCip",
    fixedAssetId: "fa_cip",
    toClassId: "class_machinery",
    inServiceDate: "2026-11-01",
    ...scope,
  });
  assertEquals(parsed.type, "capitalizeCip");
  assertThrows(() =>
    payloadValidator.parse({
      type: "capitalizeCip",
      fixedAssetId: "fa_cip",
      toClassId: "class_machinery",
      ...scope,
    })
  );
});

Deno.test("dates must be YYYY-MM-DD text, never a timestamp", () => {
  assertThrows(() =>
    payloadValidator.parse({
      type: "return",
      fixedAssetId: "fa_1",
      locationId: "loc_1",
      transferDate: "2027-01-15T00:00:00.000Z",
      ...scope,
    })
  );
  assertThrows(() =>
    payloadValidator.parse({
      type: "capitalizeCip",
      fixedAssetId: "fa_cip",
      toClassId: "class_machinery",
      inServiceDate: "11/01/2026",
      ...scope,
    })
  );
});

Deno.test("every variant requires companyId and userId; unknown types are refused", () => {
  assertThrows(() =>
    payloadValidator.parse({
      type: "attachJob",
      fixedAssetId: "fa_cip",
      jobId: "job_1",
      companyId: "company_1",
    })
  );
  assertThrows(() =>
    payloadValidator.parse({
      type: "attachJob",
      fixedAssetId: "fa_cip",
      jobId: "job_1",
      companyId: "",
      userId: "user_1",
    })
  );
  assertThrows(() =>
    payloadValidator.parse({
      type: "reclassify",
      fixedAssetId: "fa_1",
      ...scope,
    })
  );
});

Deno.test("stock resolution sums every bin and picks the bin holding the unit", () => {
  // A picked unit: −1 in the warehouse bin, +1 at lineside — the warehouse
  // row comes first, and must not win.
  const stock = resolveCapitalizationStock([
    { storageUnitId: "bin_warehouse", onHand: 0 },
    { storageUnitId: "bin_lineside", onHand: 1 },
  ]);
  assertEquals(stock, { onHand: 1, storageUnitId: "bin_lineside" });
});

Deno.test("stock resolution reads NUMERIC strings and unassigned bins", () => {
  const stock = resolveCapitalizationStock([
    { storageUnitId: null, onHand: "1" },
    { storageUnitId: "bin_2", onHand: "0" },
  ]);
  assertEquals(stock.onHand, 1);
  assertEquals(stock.storageUnitId, null);
});

Deno.test("stock resolution falls back to the caller's bin only when nothing nets positive", () => {
  assertEquals(resolveCapitalizationStock([], "bin_caller"), {
    onHand: 0,
    storageUnitId: "bin_caller",
  });
  assertEquals(
    resolveCapitalizationStock(
      [{ storageUnitId: "bin_actual", onHand: 1 }],
      "bin_caller",
    ).storageUnitId,
    "bin_actual",
  );
});

Deno.test("stock resolution reports a unit that is no longer on hand", () => {
  const stock = resolveCapitalizationStock([
    { storageUnitId: "bin_1", onHand: 1 },
    { storageUnitId: "bin_1", onHand: -1 },
  ]);
  assertEquals(stock.onHand, 0);
});

Deno.test("status sets match the plan", () => {
  assertEquals([...CLOSED_JOB_STATUSES], ["Completed", "Cancelled", "Closed"]);
  assertEquals([...RETURNABLE_ASSET_STATUSES], ["Active", "Fully Depreciated"]);
  assertEquals(RETURNABLE_ASSET_STATUSES.has("Under Construction"), false);
  assertEquals(CLOSED_JOB_STATUSES.has("Paused"), false);
});
