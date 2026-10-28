// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  findUnselectedListColumns,
  LIST_TABLES
} from "./list-select-covers-columns";

const PARTS_TABLE = LIST_TABLES.PARTS_LIST_COLUMNS as string;

const ID_PAGING = `{ defaultSorts: [{ column: "id", ascending: true }] }`;

// Each constant with an `X_PAGING` beside it; `paging` overrides its body.
const service = (
  constants: Record<string, string>,
  paging: Record<string, string> = {}
) => ({
  file: "apps/erp/app/modules/items/items.service.ts",
  contents: Object.entries(constants)
    .map(([name, list]) => {
      const pagingName = name.replace(/_LIST_COLUMNS$/, "_PAGING");
      const body = paging[pagingName] ?? ID_PAGING;
      return `const ${name} =\n  "${list}" as const;\nexport const ${pagingName}: Paging = ${body};`;
    })
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

  it("flags a sort or id column of X_PAGING the select dropped", () => {
    const { services, tables } = others();
    expect(
      findUnselectedListColumns(
        [
          ...services,
          service(
            { PARTS_LIST_COLUMNS: "id,name" },
            {
              PARTS_PAGING: `{
                defaultSorts: [
                  { column: "createdAt", ascending: false },
                  { column: "name", foreignTable: "supplier", ascending: true }
                ],
                idColumn: "readableIdWithRevision"
              }`
            }
          )
        ],
        [...tables, table("")]
      ).map((v) => v.snippet)
    ).toEqual([
      "PARTS_LIST_COLUMNS lacks cursor column createdAt",
      "PARTS_LIST_COLUMNS lacks cursor column readableIdWithRevision"
    ]);
  });

  it("flags a list constant with no X_PAGING beside it", () => {
    const { services, tables } = others();
    expect(
      findUnselectedListColumns(
        [
          ...services,
          {
            file: "apps/erp/app/modules/items/items.service.ts",
            contents: `const PARTS_LIST_COLUMNS = "id" as const;`
          }
        ],
        [...tables, table("")]
      ).map((v) => v.snippet)
    ).toEqual(["PARTS_LIST_COLUMNS has no PARTS_PAGING"]);
  });

  it("checks a sort-only list for its cursor columns but not its table", () => {
    const { services, tables } = others();
    expect(
      findUnselectedListColumns(
        [
          ...services,
          service(
            { PARTS_LIST_COLUMNS: "id", FIXED_ASSETS_LIST_COLUMNS: "id" },
            {
              FIXED_ASSETS_PAGING: `{ defaultSorts: [{ column: "fixedAssetId", ascending: true }] }`
            }
          )
        ],
        [...tables, table("")]
      ).map((v) => v.snippet)
    ).toEqual(["FIXED_ASSETS_LIST_COLUMNS lacks cursor column fixedAssetId"]);
  });
});
