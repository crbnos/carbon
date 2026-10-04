// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  REALTIME_ANCESTOR_COLUMNS,
  REALTIME_REFERENCE_TABLES,
  REALTIME_TABLES,
  REALTIME_USER_TABLES
} from "./realtime-tables";

it("names each table once, in one list", () => {
  const all = [
    ...REALTIME_TABLES,
    ...REALTIME_REFERENCE_TABLES,
    ...REALTIME_USER_TABLES
  ];
  expect(new Set(all).size).toBe(all.length);
});

it("derives each list from the attached broadcast handler", () => {
  expect(REALTIME_TABLES).toContain("jobOperation");
  expect(REALTIME_REFERENCE_TABLES).toContain("customerType");
  expect(REALTIME_USER_TABLES).toEqual(["notification"]);
});

it("lists the ancestor columns broadcast_table_changes adds", () => {
  const sql = readFileSync(
    new URL(
      "./event-system/functions/broadcast_table_changes.sql",
      import.meta.url
    ),
    "utf8"
  );
  const declared = /ancestors CONSTANT JSONB := '([^']+)'/.exec(sql)?.[1];
  const hops: Record<string, [string, string, string][]> = JSON.parse(
    declared ?? "{}"
  );
  expect(
    Object.fromEntries(
      Object.entries(hops).map(([table, path]) => [
        table,
        path.map(([, , column]) => column)
      ])
    )
  ).toEqual(REALTIME_ANCESTOR_COLUMNS);
});
