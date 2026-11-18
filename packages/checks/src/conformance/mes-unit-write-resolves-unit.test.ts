// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { repoRoot } from "../sources/migrations";
import { loadTypescriptFiles } from "../sources/typescript";
import {
  mesUnitWriteResolvesUnit,
  UNIT_PICK_ALLOW_LIST,
  UNIT_WRITE_ALLOW_LIST,
  unitPickers,
  unitWriters
} from "./mes-unit-write-resolves-unit";

const ROUTE = "apps/mes/app/routes/x+/complete.tsx";
const scan = (contents: string, file = ROUTE) =>
  mesUnitWriteResolvesUnit
    .scan(file, contents)
    .map((v) => `${v.line}:${v.snippet}`);

/** A top-level function with the given body lines, as Biome formats it. */
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
      scan(
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
      scan(
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
    expect(scan(fn("loader", RESOLVE) + fn("action", SCRAP))).toEqual([
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
      expect(scan(fn("action", write))).toEqual([finding]);
    }
  );

  it("flags an issue posting whose type is not a literal", () => {
    expect(
      scan(
        fn("action", 'await deps.post("issue", caller, { type, quantity });')
      )
    ).toEqual(['2:post("issue"']);
    expect(
      scan(
        fn(
          "action",
          'await erpPosting("issue", caller, { type: "jobOperation" });'
        )
      )
    ).toEqual([]);
  });

  it("checks the callers of a writer, not its definition", () => {
    expect(
      scan(
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
    expect(scan(fn("postSerialCompletions", SCRAP), file)).toEqual([]);
    expect(
      scan(fn("postSerialCompletions", "") + fn("postAnother", SCRAP), file)
    ).toEqual(['5:type:"jobOperationScrap"']);
  });

  it("flags a server pick of a unit outside the resolver, whatever the call shape", () => {
    expect(
      scan(
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

  it("lets the resolver pick, and leaves the predicate's definition alone", () => {
    expect(
      scan(
        "getNextIncompleteSerialEntity(units, id)",
        "apps/mes/app/services/work-unit.server.ts"
      )
    ).toEqual([]);
    expect(
      scan(
        "export function isSerialEntityIncompleteForOperation(entity, id) {}",
        "apps/mes/app/services/operations.service.ts"
      )
    ).toEqual([]);
  });

  it("only scans MES routes and services", () => {
    expect(
      scan(
        fn("action", SCRAP),
        "apps/erp/app/modules/production/production.service.ts"
      )
    ).toEqual([]);
  });
});

describe("the MES unit writers", () => {
  const files = loadTypescriptFiles(repoRoot());

  // A new writer lands here and must be reviewed: does it resolve its unit,
  // or does it belong on the allow-list (with its reason)?
  it("are exactly these functions", () => {
    expect(unitWriters(files)).toEqual([
      "apps/mes/app/routes/x+/entity+/$materialId.$trackedEntityId.scrap.tsx#action",
      "apps/mes/app/routes/x+/inspection-lot.$id.disposition.tsx#action",
      "apps/mes/app/routes/x+/issue-tracked-entity.tsx#action",
      "apps/mes/app/routes/x+/quality-issue.new.tsx#action",
      "apps/mes/app/routes/x+/rework.tsx#action",
      "apps/mes/app/routes/x+/trigger-correction.tsx#action",
      "apps/mes/app/routes/x+/trigger-rework.tsx#action",
      "apps/mes/app/services/complete.server.ts#completeOperationQuantity",
      "apps/mes/app/services/complete.server.ts#scrapOperationQuantity",
      "apps/mes/app/services/issue.server.ts#issueScannedItem",
      "apps/mes/app/services/issue.server.ts#unconsumeFromUnit",
      "apps/mes/app/services/kanban-scan.server.ts#endOperationByScan",
      "apps/mes/app/services/kanban-scan.server.ts#startOperationByScan",
      "apps/mes/app/services/operations.service.ts#insertBatchStepRecords",
      "apps/mes/app/services/production-event.server.ts#productionEventAction",
      "apps/mes/app/services/quality.server.ts#createInspectionRejectionIssue",
      "apps/mes/app/services/quality.server.ts#postBulkCompletion",
      "apps/mes/app/services/quality.server.ts#postSerialCompletions",
      "apps/mes/app/services/step-record.server.ts#completeAllSteps",
      "apps/mes/app/services/step-record.server.ts#recordStep",
      "apps/mes/app/services/traveler.server.ts#issueTravelerUnit"
    ]);
  });

  it("resolve their unit, or are allowed with a reason", () => {
    const findings = files.flatMap(({ file, contents }) =>
      mesUnitWriteResolvesUnit.scan(file, contents)
    );
    expect(findings).toEqual([]);
    // A stale entry would pre-approve the next writer added under its name.
    expect(unitWriters(files)).toEqual(
      expect.arrayContaining(Object.keys(UNIT_WRITE_ALLOW_LIST))
    );
    expect(unitPickers(files)).toEqual(
      Object.keys(UNIT_PICK_ALLOW_LIST).sort()
    );
  });
});
