// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { allocateJournalLineIds } from "./journal-line-ids";
import { chargeFixture } from "./post-charge-test-fixture";
import { postChargeTransaction } from "./post-charge-transaction";

databaseTest(
  "posting creates a missing month from the stored transaction date",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db
        .deleteFrom("accountingPeriod")
        .where("companyId", "=", f.companyId)
        .execute();
      const result = await postChargeTransaction(f.db, f.args);
      expect(result.journalId).toBeDefined();
      const period = await f.db
        .selectFrom("accountingPeriod")
        .select([
          sql<string>`"startDate"::text`.as("startDate"),
          sql<string>`"endDate"::text`.as("endDate")
        ])
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(period).toEqual({
        startDate: "2026-09-01",
        endDate: "2026-09-30"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "journal line ids are allocated before a bulk insert",
  async () => {
    const f = await chargeFixture();
    try {
      const ids = await f.db
        .transaction()
        .execute((trx) => allocateJournalLineIds(trx, 3));
      expect(ids.length).toEqual(3);
      expect(new Set(ids).size).toEqual(3);
      expect(ids.every((id) => id.startsWith("jl_"))).toEqual(true);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "posting shifts a locked month to the next open period",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db
        .updateTable("accountingPeriod")
        .set({
          startDate: "2026-09-01",
          endDate: "2026-09-30",
          closeStatus: "Locked"
        })
        .where("companyId", "=", f.companyId)
        .execute();
      const nextPeriod = await f.db
        .insertInto("accountingPeriod")
        .values({
          companyId: f.companyId,
          startDate: "2026-10-01",
          endDate: "2026-10-31",
          fiscalYear: 2026,
          periodNumber: 10,
          closeStatus: "Open",
          status: "Inactive",
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const result = await postChargeTransaction(f.db, f.args);
      expect(result.journalId).toBeDefined();
      const journal = await f.db
        .selectFrom("journal")
        .select([
          "accountingPeriodId",
          sql<string>`"postingDate"::text`.as("postingDate")
        ])
        .where("id", "=", result.journalId)
        .executeTakeFirstOrThrow();
      expect(journal).toEqual({
        accountingPeriodId: nextPeriod.id,
        postingDate: "2026-10-01"
      });
      const header = await f.db
        .selectFrom("charge")
        .select(sql<string>`"postingDate"::text`.as("postingDate"))
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header.postingDate).toEqual(journal.postingDate);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "posting is atomic, dimension-complete, and idempotent",
  async () => {
    const f = await chargeFixture();
    try {
      const first = await postChargeTransaction(f.db, f.args);
      const second = await postChargeTransaction(f.db, f.args);
      expect(second).toEqual(first);
      expect(first.journalId).toBeDefined();
      const header = await f.db
        .selectFrom("charge")
        .select(["status", "journalId", "postedAt", "postedBy"])
        .where("id", "=", f.chargeId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header.status).toEqual("Posted");
      expect(header.journalId).toEqual(first.journalId);
      expect(header.postedAt !== null).toEqual(true);
      expect(header.postedBy).toEqual("system");
      const journals = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Charge")
        .execute();
      expect(journals.length).toEqual(1);
      const journalLines = await f.db
        .selectFrom("journalLine")
        .select("id")
        .where("journalId", "=", first.journalId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(journalLines.length).toEqual(2);
      const dimensions = await f.db
        .selectFrom("journalLineDimension")
        .select(["dimensionId", "valueId"])
        .where("companyId", "=", f.companyId)
        .execute();
      expect(dimensions).toEqual([
        {
          dimensionId: f.dimensionId,
          valueId: f.costCenterId
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a sequence failure rolls the entire post back", async () => {
  const f = await chargeFixture();
  try {
    await f.db
      .deleteFrom("sequence")
      .where("table", "=", "journalEntry")
      .where("companyId", "=", f.companyId)
      .execute();
    await expect((() => postChargeTransaction(f.db, f.args))()).rejects.toThrow(
      "no result"
    );
    const header = await f.db
      .selectFrom("charge")
      .select(["status", "journalId"])
      .where("id", "=", f.chargeId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    expect(header).toEqual({ status: "Draft", journalId: null });
    expect(
      await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Charge")
        .execute()
    ).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a failure after journal creation rolls the entire post back",
  async () => {
    const f = await chargeFixture();
    let unrelated: Awaited<ReturnType<typeof chargeFixture>> | undefined;
    const triggerName = `test_fail_post_${f.lineId.replaceAll("-", "_")}`;
    const functionName = triggerName;
    try {
      unrelated = await chargeFixture();
      await sql`
      CREATE FUNCTION ${sql.id("public", functionName)}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF NEW.status = 'Posted'
           AND NEW."companyId" = TG_ARGV[0]
           AND NEW.id = TG_ARGV[1] THEN
          RAISE EXCEPTION 'forced mid-transaction failure';
        END IF;
        RETURN NEW;
      END;
      $function$;
      CREATE TRIGGER ${sql.id(triggerName)}
        BEFORE UPDATE ON public."charge"
        FOR EACH ROW
        EXECUTE FUNCTION ${sql.id("public", functionName)}(${sql.lit(
          f.companyId
        )}, ${sql.lit(f.chargeId)});
    `.execute(f.db);

      // Failure injection must never affect other companies sharing this DB.
      await postChargeTransaction(unrelated.db, unrelated.args);
      await expect(
        (() => postChargeTransaction(f.db, f.args))()
      ).rejects.toThrow("forced mid-transaction failure");
      const header = await f.db
        .selectFrom("charge")
        .select(["status", "journalId"])
        .where("id", "=", f.chargeId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header).toEqual({ status: "Draft", journalId: null });
      expect(
        await f.db
          .selectFrom("journal")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where("sourceType", "=", "Charge")
          .execute()
      ).toEqual([]);
      expect(
        await f.db
          .selectFrom("journalLine")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where("documentType", "=", "Charge")
          .execute()
      ).toEqual([]);
    } finally {
      try {
        await sql`
          DROP TRIGGER IF EXISTS ${sql.id(triggerName)} ON public."charge";
          DROP FUNCTION IF EXISTS ${sql.id("public", functionName)}();
        `.execute(f.db);
      } finally {
        try {
          await unrelated?.cleanup();
        } finally {
          await f.cleanup();
        }
      }
    }
  }
);

databaseTest(
  "posting only changes the matching company when ids overlap",
  async () => {
    const chargeId = `shared-${crypto.randomUUID()}`;
    const left = await chargeFixture({ chargeId });
    const right = await chargeFixture({ chargeId });
    try {
      await postChargeTransaction(right.db, right.args);
      const leftHeader = await left.db
        .selectFrom("charge")
        .select(["status", "journalId"])
        .where("id", "=", chargeId)
        .where("companyId", "=", left.companyId)
        .executeTakeFirstOrThrow();
      const rightHeader = await right.db
        .selectFrom("charge")
        .select(["status", "journalId"])
        .where("id", "=", chargeId)
        .where("companyId", "=", right.companyId)
        .executeTakeFirstOrThrow();
      expect(leftHeader).toEqual({ status: "Draft", journalId: null });
      expect(rightHeader.status).toEqual("Posted");
      expect(rightHeader.journalId).toBeDefined();
    } finally {
      await right.cleanup();
      await left.cleanup();
    }
  }
);

databaseTest(
  "posting fails closed when company settings are missing",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db
        .deleteFrom("companySettings")
        .where("id", "=", f.companyId)
        .execute();
      await expect(
        (() => postChargeTransaction(f.db, f.args))()
      ).rejects.toThrow("settings");
      expect(
        (
          await f.db
            .selectFrom("charge")
            .select("status")
            .where("id", "=", f.chargeId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "posting rejects an account whose class contradicts its role",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db
        .updateTable("account")
        .set({ class: "Asset" })
        .where("id", "=", f.account("card"))
        .execute();
      await expect(
        (() => postChargeTransaction(f.db, f.args))()
      ).rejects.toThrow("account");
      expect(
        (
          await f.db
            .selectFrom("charge")
            .select("status")
            .where("id", "=", f.chargeId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "posting rejects a locked period without an open successor",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db
        .updateTable("accountingPeriod")
        .set({ closeStatus: "Locked" })
        .where("companyId", "=", f.companyId)
        .execute();
      await expect(
        (() => postChargeTransaction(f.db, f.args))()
      ).rejects.toThrow("locked");
      expect(
        (
          await f.db
            .selectFrom("charge")
            .select("status")
            .where("id", "=", f.chargeId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "void validates provenance, reverses once, and is idempotent",
  async () => {
    const f = await chargeFixture();
    try {
      const posted = await postChargeTransaction(f.db, f.args);
      const voidArgs = { ...f.args, type: "void" as const };
      // PostgreSQL does not promise INSERT ... RETURNING order. Simulate a
      // driver returning the two inserted ids in reverse; explicit preallocated
      // ids must keep the CostCenter bound to the expense line regardless.
      const returningId = f.db
        .insertInto("journalLine")
        .returning("id")
        .toOperationNode().returning!;
      const targeted = new WeakSet<object>();
      let reversedReturning = 0;
      const reverseBulkIdResults = f.db.withPlugin({
        transformQuery: ({ node, queryId }) => {
          if (
            node.kind === "InsertQueryNode" &&
            node.into?.table.identifier.name === "journalLine"
          ) {
            targeted.add(queryId);
            return { ...node, returning: returningId };
          }
          return node;
        },
        async transformResult({ queryId, result }) {
          if (targeted.has(queryId) && result.rows.length > 1) {
            reversedReturning++;
            return { ...result, rows: [...result.rows].reverse() };
          }
          return result;
        }
      });
      const first = await postChargeTransaction(reverseBulkIdResults, voidArgs);
      const second = await postChargeTransaction(
        reverseBulkIdResults,
        voidArgs
      );
      expect(reversedReturning).toEqual(1);
      expect(first).toEqual(posted);
      expect(second).toEqual(posted);
      expect(
        (
          await f.db
            .selectFrom("charge")
            .select("status")
            .where("id", "=", f.chargeId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).status
      ).toEqual("Voided");
      const journals = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Charge")
        .execute();
      expect(journals.length).toEqual(2);
      const lines = await f.db
        .selectFrom("journalLine")
        .select("amount")
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Charge")
        .execute();
      expect(lines.reduce((total, line) => total + line.amount, 0)).toEqual(0);
      const dimensions = await f.db
        .selectFrom("journalLineDimension as dimension")
        .innerJoin("journalLine as line", (join) =>
          join
            .onRef("line.id", "=", "dimension.journalLineId")
            .onRef("line.companyId", "=", "dimension.companyId")
        )
        .innerJoin("journal", "journal.id", "line.journalId")
        .select([
          "journal.description as journalDescription",
          "line.accountId",
          "dimension.dimensionId",
          "dimension.valueId"
        ])
        .where("dimension.companyId", "=", f.companyId)
        .orderBy("journal.description")
        .execute();
      expect(dimensions).toEqual([
        {
          journalDescription: `Charge cardtest-${f.chargeId.split("-")[1]}-readable`,
          accountId: f.account("expense"),
          dimensionId: f.dimensionId,
          valueId: f.costCenterId
        },
        {
          journalDescription: `VOID Charge cardtest-${f.chargeId.split("-")[1]}-readable`,
          accountId: f.account("expense"),
          dimensionId: f.dimensionId,
          valueId: f.costCenterId
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("void refuses a forged original journal", async () => {
  const f = await chargeFixture();
  try {
    const posted = await postChargeTransaction(f.db, f.args);
    expect(posted.journalId).toBeDefined();
    await f.db.transaction().execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      await trx
        .updateTable("journal")
        .set({ sourceType: "Payment" })
        .where("id", "=", posted.journalId)
        .execute();
    });
    await expect(
      (() =>
        postChargeTransaction(f.db, {
          ...f.args,
          type: "void"
        }))()
    ).rejects.toThrow("Original charge journal");
    expect(
      (
        await f.db
          .selectFrom("charge")
          .select("status")
          .where("id", "=", f.chargeId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      ).status
    ).toEqual("Posted");
  } finally {
    await f.cleanup();
  }
});
