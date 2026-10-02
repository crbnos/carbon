// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../local-database-test-fixture";
import { selectRow, selectRows } from "./rows";

databaseTest(
  "selectRows returns rows the way PostgREST does, with embeds",
  async () => {
    const db = await connectLocalTestDatabase();
    try {
      const companies = await db
        .selectFrom("company")
        .select(["id"])
        .orderBy("id")
        .limit(2)
        .execute();
      const ids = companies.map((company) => company.id);
      if (ids.length === 0) return;

      type Row = Record<string, unknown> & { id: string; location: Row[] };
      const rows = await selectRows<"company", Row>(
        db,
        "company",
        { id: ids },
        {
          orderBy: ["id"],
          embed: { location: { table: "location", on: "companyId" } }
        }
      );

      expect(rows.map((row) => row.id)).toEqual(ids);
      for (const row of rows) {
        expect(row.location.every((l) => l.companyId === row.id)).toBe(true);
        // A timestamp is a string, never a Date cut to the millisecond.
        for (const record of [row, ...row.location]) {
          for (const [column, value] of Object.entries(record)) {
            if (column.endsWith("At") && value !== null) {
              expect(typeof value, column).toBe("string");
            }
          }
        }
      }

      expect(await selectRow(db, "company", { id: ids[0]! })).toMatchObject({
        id: ids[0]
      });
      expect(await selectRows(db, "company", { id: [] })).toEqual([]);
      expect(await selectRow(db, "company", { id: "no-such-company" })).toBe(
        undefined
      );
    } finally {
      await db.destroy();
    }
  }
);
