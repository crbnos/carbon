// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  findUnselectedListColumns,
  LIST_TABLES
} from "./list-select-covers-columns";

const PARTS_TABLE = LIST_TABLES.PARTS_LIST_COLUMNS as string;

const service = (constants: Record<string, string>) => ({
  file: "apps/erp/app/modules/items/items.service.ts",
  contents: Object.entries(constants)
    .map(([name, list]) => `const ${name} =\n  "${list}" as const;`)
    .join("\n")
});

const table = (body: string) => ({ file: PARTS_TABLE, contents: body });

// Every other mapped constant, defined and with an empty table, so a case
// only reports what it is about.
const others = () => {
  const rest = Object.entries(LIST_TABLES).filter(
    ([name]) => name !== "PARTS_LIST_COLUMNS"
  );
  return {
    services: [service(Object.fromEntries(rest.map(([name]) => [name, "id"])))],
    tables: rest.map(([, file]) => ({ file, contents: "" }))
  };
};

const snippets = (partsList: string | null, partsTable: string) => {
  const { services, tables } = others();
  const constants: Record<string, string> =
    partsList === null ? {} : { PARTS_LIST_COLUMNS: partsList };
  return findUnselectedListColumns(
    [...services, service(constants)],
    [...tables, table(partsTable)]
  ).map((v) => v.snippet);
};

describe("findUnselectedListColumns", () => {
  it("accepts a table whose accessorKeys are all selected", () => {
    expect(
      snippets(
        "id,name,customFields",
        `accessorKey: "id", accessorKey: "name", accessorKey: "customFields->>abc", useCustomColumns`
      )
    ).toEqual([]);
  });

  it("flags an accessorKey the select dropped", () => {
    expect(snippets("id", `accessorKey: "id", accessorKey: "mpn"`)).toEqual([
      "PARTS_LIST_COLUMNS lacks mpn"
    ]);
  });

  it("flags custom columns rendered without selecting customFields", () => {
    expect(snippets("id", `accessorKey: "id", useCustomColumns`)).toEqual([
      "PARTS_LIST_COLUMNS lacks customFields"
    ]);
  });

  it("flags a new list constant with no table mapped", () => {
    const { services, tables } = others();
    expect(
      findUnselectedListColumns(
        [
          ...services,
          service({ PARTS_LIST_COLUMNS: "id", KITS_LIST_COLUMNS: "id" })
        ],
        [...tables, table("")]
      ).map((v) => v.snippet)
    ).toEqual(["KITS_LIST_COLUMNS"]);
  });

  it("flags a mapped constant that no service defines any more", () => {
    expect(snippets(null, "")).toEqual(["PARTS_LIST_COLUMNS"]);
  });
});
