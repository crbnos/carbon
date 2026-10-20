// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JOB_LIST_EXPORT_VALUES } from "../app/modules/production/ui/Jobs/job-list-export";
import { SUPPLIER_CONTACT_VALUES } from "../app/modules/purchasing/ui/Supplier/supplier-list-export";
import { WORKFLOW_LIST_EXPORT_VALUES } from "../app/modules/workflows/ui/workflow-list-export";
import { withExportValues } from "../app/utils/list-registry/export-values";

/**
 * A list whose loader adds per-row values (`mapRows`) exports them in the
 * browser through each column's `meta.exportValue`. The background export
 * (over 1,000 rows) runs no column code: it reads `row[key]`. So the list's
 * `exportRows` runs the same lookup and writes the same values under the
 * column keys, from one shared map per table.
 */

const APP = join(__dirname, "..", "app");
const read = (path: string) => readFileSync(join(APP, path), "utf8");

const LISTS = [
  {
    route: "routes/x+/production+/jobs.tsx",
    registry: "utils/list-registry/production.server.ts",
    table: "modules/production/ui/Jobs/JobsTable.tsx",
    values: JOB_LIST_EXPORT_VALUES
  },
  {
    route: "routes/x+/purchasing+/suppliers.tsx",
    registry: "utils/list-registry/purchasing.server.ts",
    table: "modules/purchasing/ui/Supplier/SuppliersTable.tsx",
    values: SUPPLIER_CONTACT_VALUES
  },
  {
    route: "routes/x+/workflows+/_index.tsx",
    registry: "utils/list-registry/workflows.server.ts",
    table: "modules/workflows/ui/WorkflowsTable.tsx",
    values: WORKFLOW_LIST_EXPORT_VALUES
  }
];

describe("withExportValues", () => {
  it("writes each column's value under its key", () => {
    const rows = withExportValues(
      [{ id: "j1", batchReadableIds: ["BAT-1", "BAT-2"] }],
      JOB_LIST_EXPORT_VALUES
    );
    expect(rows).toEqual([
      {
        id: "j1",
        batchReadableIds: ["BAT-1", "BAT-2"],
        batches: "BAT-1, BAT-2",
        trackedEntityId: null
      }
    ]);
  });
});

describe("the shared export values", () => {
  it("reads the job extras the loader adds", () => {
    const row = { batchReadableIds: ["BAT-7"], trackedEntityReadableId: "L-9" };
    expect(JOB_LIST_EXPORT_VALUES.batches(row)).toBe("BAT-7");
    expect(JOB_LIST_EXPORT_VALUES.trackedEntityId(row)).toBe("L-9");
  });

  it("reads the supplier report contacts the loader adds", () => {
    const row = {
      reportContacts: {
        purchasingContact: {
          contact: { fullName: "Ada Park", email: "ada@example.com" }
        },
        payment: null,
        shipping: null
      }
    } as unknown as Parameters<
      typeof SUPPLIER_CONTACT_VALUES.purchasingContactName
    >[0];
    expect(SUPPLIER_CONTACT_VALUES.purchasingContactName(row)).toBe("Ada Park");
    expect(SUPPLIER_CONTACT_VALUES.purchasingContactEmail(row)).toBe(
      "ada@example.com"
    );
    expect(SUPPLIER_CONTACT_VALUES.invoiceAddress(row)).toBeNull();
  });

  it("reads the workflow last run the loader adds", () => {
    expect(
      WORKFLOW_LIST_EXPORT_VALUES.lastRun({ lastRun: { status: "Succeeded" } })
    ).toBe("Succeeded");
    expect(WORKFLOW_LIST_EXPORT_VALUES.lastRun({ lastRun: null })).toBe("");
  });
});

describe("lists with per-page extras", () => {
  it.each(LISTS)("$route exports its extras in the background", (list) => {
    // The loader and the export run the same lookup from the registry.
    const lookup = /mapRows:\s*(with\w+)/.exec(read(list.route))?.[1];
    expect(lookup).toBeDefined();
    const registry = read(list.registry);
    expect(registry).toContain(`export async function ${lookup}`);
    expect(registry).toMatch(
      new RegExp(String.raw`exportRows:[\s\S]*?${lookup}\(rows, context\)`)
    );
  });

  it.each(LISTS)("$table has a column for every export value", (list) => {
    const table = read(list.table);
    for (const key of Object.keys(list.values)) {
      expect(table, key).toMatch(
        new RegExp(String.raw`(?:id|accessorKey): "${key}"`)
      );
    }
  });
});
