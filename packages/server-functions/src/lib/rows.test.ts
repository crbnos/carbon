// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  deleteRows,
  insertRows,
  isNull,
  neq,
  selectRow,
  selectRows,
  updateRows
} from "@carbon/database/rows";
import { expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../local-database-test-fixture";

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
      // A missing value matches nothing, as PostgREST's eq does; only isNull
      // asks for the rows where the column is empty.
      expect(await selectRows(db, "company", { id: null })).toEqual([]);
      expect(await selectRows(db, "company", { id: isNull })).toEqual([]);
      const named = await selectRows(
        db,
        "company",
        { id: ids },
        { columns: ["id"] }
      );
      expect(named.map((row) => Object.keys(row))).toEqual(
        ids.map(() => ["id"])
      );
      expect(await selectRow(db, "company", { id: "no-such-company" })).toBe(
        undefined
      );
    } finally {
      await db.destroy();
    }
  }
);

databaseTest(
  "insertRows / updateRows / deleteRows cast a JSON body the way PostgREST does",
  async () => {
    const db = await connectLocalTestDatabase();
    const rollback = new Error("rollback");
    try {
      const owner = await db
        .selectFrom("userToCompany")
        .select(["companyId", "userId"])
        .limit(1)
        .executeTakeFirst();
      if (!owner) return;
      await db
        .transaction()
        .execute(async (trx) => {
          const attributes = { "Receipt Line": "rl_1", Tags: ["a", "b"] };
          const inserted = await insertRows(trx, "trackedEntity", {
            quantity: 2.5,
            sourceDocument: "Item",
            sourceDocumentId: "doc_rows_test",
            attributes,
            companyId: owner.companyId,
            createdBy: owner.userId
          });
          const row = inserted.data[0]!;
          // A jsonb array stays an array; the defaults fill what was left out.
          expect(row.attributes).toEqual(attributes);
          expect(row.quantity).toBe(2.5);
          expect(row.status).toBe("Available");
          expect(typeof row.createdAt).toBe("string");

          await updateRows(
            trx,
            "trackedEntity",
            { quantity: 4, readableId: null, expirationDate: undefined },
            {
              id: row.id,
              companyId: owner.companyId,
              status: neq("Consumed")
            }
          );
          const updated = await selectRow(trx, "trackedEntity", { id: row.id });
          expect(updated?.quantity).toBe(4);
          expect(updated?.readableId).toBeNull();

          // Several rows: a key one row lacks is NULL for it, not its default.
          const pair = await insertRows(trx, "trackedEntity", [
            {
              quantity: 1,
              sourceDocument: "Item",
              sourceDocumentId: "doc_rows_test",
              companyId: owner.companyId,
              createdBy: owner.userId,
              readableId: "R-1"
            },
            {
              quantity: 1,
              sourceDocument: "Item",
              sourceDocumentId: "doc_rows_test",
              companyId: owner.companyId,
              createdBy: owner.userId
            }
          ]);
          expect(pair.data.map((r) => r.readableId).sort()).toEqual([
            "R-1",
            null
          ]);

          await deleteRows(trx, "trackedEntity", {
            sourceDocumentId: "doc_rows_test",
            companyId: owner.companyId
          });
          expect(
            await selectRows(trx, "trackedEntity", {
              sourceDocumentId: "doc_rows_test"
            })
          ).toEqual([]);
          throw rollback;
        })
        .catch((error) => {
          if (error !== rollback) throw error;
        });
    } finally {
      await db.destroy();
    }
  }
);

databaseTest(
  "a filter value shaped like a comparison is a value, not SQL",
  async () => {
    const db = await connectLocalTestDatabase();
    try {
      const everyone = await selectRows(db, "company", {});
      if (everyone.length === 0) return;
      // If the object's `op` reached the statement this would match every row.
      const lookalike = { op: "= name OR TRUE --", value: "x" } as never;
      const matched = await selectRows(db, "company", {
        name: lookalike
      }).catch(() => []);
      expect(matched).toEqual([]);
      expect(
        (await selectRows(db, "company", { id: neq("no-such-company") })).length
      ).toBe(everyone.length);
    } finally {
      await db.destroy();
    }
  }
);
