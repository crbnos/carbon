// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SourceFile } from "../../check";
import { openRepo } from "../../repo";
import { listSelectCoversColumns } from "./list-select-covers-columns";

const PARTS_TABLE = "apps/erp/app/modules/items/ui/Parts/PartsTable.tsx";

const findUnselectedListColumns = (
  services: SourceFile[],
  tables: SourceFile[]
) =>
  listSelectCoversColumns.find({
    sources: {
      listTables: { PARTS_LIST_COLUMNS: PARTS_TABLE },
      services,
      tables
    }
  });

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

const snippets = (partsList: string | null, partsTable: string) =>
  findUnselectedListColumns(
    [service(partsList === null ? {} : { PARTS_LIST_COLUMNS: partsList })],
    [table(partsTable)]
  ).map((v) => v.snippet);

describe("listSelectCoversColumns", () => {
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
    expect(
      findUnselectedListColumns(
        [service({ PARTS_LIST_COLUMNS: "id", KITS_LIST_COLUMNS: "id" })],
        [table("")]
      ).map((v) => v.snippet)
    ).toEqual(["KITS_LIST_COLUMNS"]);
  });

  it("flags a mapped constant that no service defines any more", () => {
    expect(snippets(null, "")).toEqual(["PARTS_LIST_COLUMNS"]);
  });

  it("flags a sort or id column of X_PAGING the select dropped", () => {
    expect(
      findUnselectedListColumns(
        [
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
        [table("")]
      ).map((v) => v.snippet)
    ).toEqual([
      "PARTS_LIST_COLUMNS lacks cursor column createdAt",
      "PARTS_LIST_COLUMNS lacks cursor column readableIdWithRevision"
    ]);
  });

  it("flags a list constant with no X_PAGING beside it", () => {
    expect(
      findUnselectedListColumns(
        [
          {
            file: "apps/erp/app/modules/items/items.service.ts",
            contents: `const PARTS_LIST_COLUMNS = "id" as const;`
          }
        ],
        [table("")]
      ).map((v) => v.snippet)
    ).toEqual(["PARTS_LIST_COLUMNS has no PARTS_PAGING"]);
  });

  it("checks a sort-only list for its cursor columns but not its table", () => {
    expect(
      findUnselectedListColumns(
        [
          service(
            { PARTS_LIST_COLUMNS: "id", FIXED_ASSETS_LIST_COLUMNS: "id" },
            {
              FIXED_ASSETS_PAGING: `{ defaultSorts: [{ column: "fixedAssetId", ascending: true }] }`
            }
          )
        ],
        [table("")]
      ).map((v) => v.snippet)
    ).toEqual(["FIXED_ASSETS_LIST_COLUMNS lacks cursor column fixedAssetId"]);
  });

  it("reads each module's service file and the list tables that exist", () => {
    const root = mkdtempSync(join(tmpdir(), "lists-"));
    const write = (path: string, contents: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), contents);
    };
    write(
      "apps/erp/app/modules/items/items.service.ts",
      service({ PARTS_LIST_COLUMNS: "id" }).contents
    );
    mkdirSync(join(root, "apps/erp/app/modules/shared"));
    write(PARTS_TABLE, `accessorKey: "id", accessorKey: "mpn"`);
    expect(
      listSelectCoversColumns.run(openRepo(root)).map((v) => v.snippet)
    ).toContain("PARTS_LIST_COLUMNS lacks mpn");
  });
});
