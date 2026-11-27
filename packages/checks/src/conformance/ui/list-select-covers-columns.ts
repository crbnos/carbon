// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type Violation } from "../../check";
import { LIST_TABLES, loadListSources } from "../../sources/list-tables";
import { lineOf } from "../../sources/text";

// Each list table's columns against the columns its endpoint selects, and each
// endpoint's select against the columns its cursor reads. Why, and the tables
// it compares: `LIST_TABLES` (`sources/list-tables.ts`).
export const listSelectCoversColumns = defineCheck({
  id: "list-select-covers-columns",
  description:
    "Every list table's accessorKeys, and the columns its cursor reads, are in the columns its endpoint selects.",
  reads: { sources: loadListSources },
  rule() {
    const listConstant = /const ([A-Z_]+_LIST_COLUMNS) =\s*"([^"]*)"/g;

    /** The list-order columns of an `X_PAGING` constant (embedded-table sorts
     *  excluded) and its id column, or null when the service has no such constant. */
    const pagingColumns = (
      contents: string,
      paging: string
    ): string[] | null => {
      const match = contents.match(
        new RegExp(`export const ${paging}: Paging = \\{([\\s\\S]*?)\\};`)
      );
      if (!match) return null;
      const body = match[1] ?? "";
      const sorts = [...body.matchAll(/\{([^{}]*)\}/g)]
        .map((m) => m[1] ?? "")
        .filter((sort) => !sort.includes("foreignTable"))
        .map((sort) => sort.match(/column:\s*"([^"]+)"/)?.[1])
        .filter((column): column is string => Boolean(column));
      const idColumn = body.match(/idColumn:\s*"([^"]+)"/)?.[1] ?? "id";
      return [...sorts, idColumn];
    };

    return ({ sources }) => {
      const { services, tables } = sources;
      const out: Violation[] = [];
      const tableByFile = new Map(tables.map((t) => [t.file, t]));
      const found = new Set<string>();

      for (const service of services) {
        for (const match of service.contents.matchAll(listConstant)) {
          const [, constant = "", list = ""] = match;
          found.add(constant);
          const selected = new Set(list.split(","));
          const paging = `${constant.replace(/_LIST_COLUMNS$/, "")}_PAGING`;
          const cursorColumns = pagingColumns(service.contents, paging);
          if (!cursorColumns) {
            out.push({
              file: service.file,
              line: lineOf(service.contents, match.index),
              snippet: `${constant} has no ${paging}`,
              message: `${paging} not found beside ${constant}, so its cursor columns cannot be checked`
            });
          }
          for (const column of cursorColumns ?? []) {
            if (selected.has(column)) continue;
            out.push({
              file: service.file,
              line: lineOf(service.contents, match.index),
              snippet: `${constant} lacks cursor column ${column}`,
              message: `${paging} sorts or pages on "${column}" but ${constant} does not select it, so the list ends after page 1`
            });
          }
          // Checked for its cursor columns only: its table reads embedded records
          // (`location.name`), not flat accessors.
          if (constant === "FIXED_ASSETS_LIST_COLUMNS") continue;
          const tablePath = LIST_TABLES[constant];
          const table = tablePath ? tableByFile.get(tablePath) : undefined;
          if (!table) {
            out.push({
              file: service.file,
              line: lineOf(service.contents, match.index),
              snippet: constant,
              message: tablePath
                ? `${tablePath} not found; update LIST_TABLES in list-tables.ts`
                : `Add ${constant} and the table that renders it to LIST_TABLES in list-tables.ts`
            });
            continue;
          }
          for (const key of table.contents.matchAll(
            /accessorKey:\s*"([^"]+)"/g
          )) {
            const column = key[1] ?? "";
            // Custom-field columns are keyed `customFields->>{id}`; the
            // `customFields` column itself is what has to be selected.
            if (column.startsWith("customFields->>") || selected.has(column))
              continue;
            out.push({
              file: table.file,
              line: lineOf(table.contents, key.index),
              snippet: `${constant} lacks ${column}`,
              message: `accessorKey "${column}" is not in ${constant}, so it exports blank in the CSV download`
            });
          }
          if (
            table.contents.includes("useCustomColumns") &&
            !selected.has("customFields")
          ) {
            out.push({
              file: table.file,
              line: lineOf(
                table.contents,
                table.contents.indexOf("useCustomColumns")
              ),
              snippet: `${constant} lacks customFields`,
              message: `The table renders custom columns but ${constant} does not select customFields`
            });
          }
        }
      }

      for (const constant of Object.keys(LIST_TABLES)) {
        if (found.has(constant)) continue;
        out.push({
          file: "packages/checks/src/sources/list-tables.ts",
          line: 0,
          snippet: constant,
          message: `${constant} is not defined in any module service; update LIST_TABLES`
        });
      }
      return out;
    };
  }
});
