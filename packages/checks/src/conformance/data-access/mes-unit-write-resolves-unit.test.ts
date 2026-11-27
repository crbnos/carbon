// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { mesUnitWriteResolvesUnit } from "./mes-unit-write-resolves-unit";

const ROUTE = "apps/mes/app/routes/x+/complete.tsx";
const unitScan = (contents: string, file = ROUTE) =>
  mesUnitWriteResolvesUnit
    .scan(file, contents)
    .map((v) => `${v.line}:${v.snippet}`);

/** A top-level function with the given body lines, as oxfmt formats it. */
const fn = (name: string, ...body: string[]) =>
  [`export async function ${name}(args) {`, ...body.map((l) => `  ${l}`), "}"]
    .join("\n")
    .concat("\n");

const RESOLVE = 'const work = await resolveWorkUnit({ mode: "require" });';
const SCRAP =
  'await erpPosting("issue", caller, { type: "jobOperationScrap" });';

describe("mes-unit-write-resolves-unit", () => {
  it("passes a write in the function that resolves the unit, nested callbacks included", () => {
    expect(
      unitScan(
        fn(
          "action",
          RESOLVE,
          "await Promise.all(ids.map(async (id) => {",
          '  await erpPosting("issue", c, { type: "jobOperationSerialComplete" });',
          "}));"
        )
      )
    ).toEqual([]);
  });

  it("flags a write when resolveWorkUnit appears only in a comment or a string", () => {
    expect(
      unitScan(
        fn(
          "action",
          "// resolveWorkUnit({ mode: 'require' }) runs upstream",
          'const note = "resolveWorkUnit(";',
          SCRAP
        )
      )
    ).toEqual(['4:type:"jobOperationScrap"']);
  });

  it("flags a write whose resolver is in a different function", () => {
    expect(unitScan(fn("loader", RESOLVE) + fn("action", SCRAP))).toEqual([
      '5:type:"jobOperationScrap"'
    ]);
  });

  it.each([
    [
      'await client.from("jobOperationStepRecord").upsert(row);',
      '2:.from("jobOperationStepRecord").upsert'
    ],
    [
      'await client\n    .from("productionEvent")\n    .insert(event);',
      '3:.from("productionEvent").insert'
    ],
    [
      'await trx.insertInto("trackedActivity").values(row).execute();',
      '2:insertInto("trackedActivity"'
    ]
  ])(
    "flags a direct unit-table write without the resolver: %s",
    (write, finding) => {
      expect(unitScan(fn("action", write))).toEqual([finding]);
    }
  );

  it("flags an issue posting whose type is not a literal", () => {
    expect(
      unitScan(
        fn("action", 'await deps.post("issue", caller, { type, quantity });')
      )
    ).toEqual(['2:post("issue"']);
    expect(
      unitScan(
        fn(
          "action",
          'await erpPosting("issue", caller, { type: "jobOperation" });'
        )
      )
    ).toEqual([]);
  });

  it.each([
    ['throw new Error("insertScrapQuantity(job) failed");'],
    ["const hint = 'erpPosting(\"issue\", caller, { type, quantity })';"]
  ])("does not take text inside a string for a write: %s", (line) => {
    expect(unitScan(fn("action", line))).toEqual([]);
  });

  it("checks the callers of a writer, not its definition", () => {
    expect(
      unitScan(
        fn(
          "insertAttributeRecord",
          'await client.from("jobOperationStepRecord").upsert(d);'
        ) + fn("action", "await insertAttributeRecord(client, data);"),
        "apps/mes/app/services/operations.service.ts"
      )
    ).toEqual(["5:insertAttributeRecord("]);
  });

  it("allows only the listed function of an allow-listed file", () => {
    const file = "apps/mes/app/services/quality.server.ts";
    expect(unitScan(fn("postSerialCompletions", SCRAP), file)).toEqual([]);
    expect(
      unitScan(fn("postSerialCompletions", "") + fn("postAnother", SCRAP), file)
    ).toEqual(['5:type:"jobOperationScrap"']);
  });

  it("flags a server pick of a unit outside the resolver, whatever the call shape", () => {
    expect(
      unitScan(
        [
          'import { isSerialEntityIncompleteForOperation } from "./operations.service";',
          fn(
            "action",
            RESOLVE,
            "const next = units.find(isSerialEntityIncompleteForOperation);",
            "const other = getNextIncompleteSerialEntity(units, id);"
          )
        ].join("\n")
      )
    ).toEqual([
      "4:isSerialEntityIncompleteForOperation",
      "5:getNextIncompleteSerialEntity"
    ]);
  });

  it("allows a pick only in the listed function of an allow-listed file", () => {
    const file = "apps/mes/app/routes/x+/operation.$operationId.tsx";
    const pick = "const next = getNextIncompleteSerialEntity(units, id);";
    expect(unitScan(fn("loader", pick), file)).toEqual([]);
    expect(unitScan(fn("action", pick), file)).toEqual([
      "2:getNextIncompleteSerialEntity"
    ]);
  });

  it("lets the resolver pick, and leaves the predicate's definition alone", () => {
    expect(
      unitScan(
        "getNextIncompleteSerialEntity(units, id)",
        "apps/mes/app/services/work-unit.server.ts"
      )
    ).toEqual([]);
    expect(
      unitScan(
        "export function isSerialEntityIncompleteForOperation(entity, id) {}",
        "apps/mes/app/services/operations.service.ts"
      )
    ).toEqual([]);
  });

  it("only scans MES routes and services", () => {
    expect(
      unitScan(
        fn("action", SCRAP),
        "apps/erp/app/modules/production/production.service.ts"
      )
    ).toEqual([]);
  });
});
