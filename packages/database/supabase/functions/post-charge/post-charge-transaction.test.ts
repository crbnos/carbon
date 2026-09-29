import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { sql } from "kysely";
import {
  chargeFixture,
  databaseTest,
} from "./post-charge-test-fixture.ts";
import { postChargeTransaction } from "./post-charge-transaction.ts";
import { allocateJournalLineIds } from "./journal-line-ids.ts";

databaseTest(
  "posting creates a missing month from the stored transaction date",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db.deleteFrom("accountingPeriod").where(
        "companyId",
        "=",
        f.companyId,
      ).execute();
      const result = await postChargeTransaction(f.db, f.args);
      assertExists(result.journalId);
      const period = await f.db.selectFrom("accountingPeriod").select([
        sql<string>`"startDate"::text`.as("startDate"),
        sql<string>`"endDate"::text`.as("endDate"),
      ]).where("companyId", "=", f.companyId).executeTakeFirstOrThrow();
      assertEquals(period, { startDate: "2026-09-01", endDate: "2026-09-30" });
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest("journal line ids are allocated before a bulk insert", async () => {
  const f = await chargeFixture();
  try {
    const ids = await f.db.transaction().execute((trx) =>
      allocateJournalLineIds(trx, 3)
    );
    assertEquals(ids.length, 3);
    assertEquals(new Set(ids).size, 3);
    assertEquals(ids.every((id) => id.startsWith("jl_")), true);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "posting shifts a locked month to the next open period",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db.updateTable("accountingPeriod").set({
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        closeStatus: "Locked",
      }).where("companyId", "=", f.companyId).execute();
      const nextPeriod = await f.db.insertInto("accountingPeriod").values({
        companyId: f.companyId,
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        fiscalYear: 2026,
        periodNumber: 10,
        closeStatus: "Open",
        status: "Inactive",
        createdBy: "system",
      }).returning("id").executeTakeFirstOrThrow();
      const result = await postChargeTransaction(f.db, f.args);
      assertExists(result.journalId);
      const journal = await f.db.selectFrom("journal").select([
        "accountingPeriodId",
        sql<string>`"postingDate"::text`.as("postingDate"),
      ]).where("id", "=", result.journalId).executeTakeFirstOrThrow();
      assertEquals(journal, {
        accountingPeriodId: nextPeriod.id,
        postingDate: "2026-10-01",
      });
      const header = await f.db.selectFrom("charge").select(
        sql<string>`"postingDate"::text`.as("postingDate"),
      ).where("companyId", "=", f.companyId).executeTakeFirstOrThrow();
      assertEquals(header.postingDate, journal.postingDate);
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest(
  "posting is atomic, dimension-complete, and idempotent",
  async () => {
    const f = await chargeFixture();
    try {
      const first = await postChargeTransaction(f.db, f.args);
      const second = await postChargeTransaction(f.db, f.args);
      assertEquals(second, first);
      assertExists(first.journalId);
      const header = await f.db.selectFrom("charge").select([
        "status",
        "journalId",
        "postedAt",
        "postedBy",
      ]).where("id", "=", f.chargeId).where(
        "companyId",
        "=",
        f.companyId,
      ).executeTakeFirstOrThrow();
      assertEquals(header.status, "Posted");
      assertEquals(header.journalId, first.journalId);
      assertEquals(header.postedAt !== null, true);
      assertEquals(header.postedBy, "system");
      const journals = await f.db.selectFrom("journal").select("id").where(
        "companyId",
        "=",
        f.companyId,
      ).where("sourceType", "=", "Charge").execute();
      assertEquals(journals.length, 1);
      const journalLines = await f.db.selectFrom("journalLine").select("id")
        .where("journalId", "=", first.journalId).where(
          "companyId",
          "=",
          f.companyId,
        ).execute();
      assertEquals(journalLines.length, 2);
      const dimensions = await f.db.selectFrom("journalLineDimension").select([
        "dimensionId",
        "valueId",
      ]).where("companyId", "=", f.companyId).execute();
      assertEquals(dimensions, [{
        dimensionId: f.dimensionId,
        valueId: f.costCenterId,
      }]);
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest("a sequence failure rolls the entire post back", async () => {
  const f = await chargeFixture();
  try {
    await f.db.deleteFrom("sequence").where("table", "=", "journalEntry")
      .where("companyId", "=", f.companyId).execute();
    await assertRejects(
      () => postChargeTransaction(f.db, f.args),
      Error,
      "no result",
    );
    const header = await f.db.selectFrom("charge").select([
      "status",
      "journalId",
    ]).where("id", "=", f.chargeId).where(
      "companyId",
      "=",
      f.companyId,
    ).executeTakeFirstOrThrow();
    assertEquals(header, { status: "Draft", journalId: null });
    assertEquals(
      await f.db.selectFrom("journal").select("id").where(
        "companyId",
        "=",
        f.companyId,
      ).where("sourceType", "=", "Charge").execute(),
      [],
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a failure after journal creation rolls the entire post back",
  async () => {
    const f = await chargeFixture();
    let unrelated:
      | Awaited<ReturnType<typeof chargeFixture>>
      | undefined;
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
        EXECUTE FUNCTION ${sql.id("public", functionName)}(${
        sql.lit(f.companyId)
      }, ${sql.lit(f.chargeId)});
    `.execute(f.db);

      // Failure injection must never affect other companies sharing this DB.
      await postChargeTransaction(unrelated.db, unrelated.args);
      await assertRejects(
        () => postChargeTransaction(f.db, f.args),
        Error,
        "forced mid-transaction failure",
      );
      const header = await f.db.selectFrom("charge").select([
        "status",
        "journalId",
      ]).where("id", "=", f.chargeId).where(
        "companyId",
        "=",
        f.companyId,
      ).executeTakeFirstOrThrow();
      assertEquals(header, { status: "Draft", journalId: null });
      assertEquals(
        await f.db.selectFrom("journal").select("id").where(
          "companyId",
          "=",
          f.companyId,
        ).where("sourceType", "=", "Charge").execute(),
        [],
      );
      assertEquals(
        await f.db.selectFrom("journalLine").select("id").where(
          "companyId",
          "=",
          f.companyId,
        ).where("documentType", "=", "Charge").execute(),
        [],
      );
    } finally {
      try {
        await sql`
          DROP TRIGGER IF EXISTS ${
          sql.id(triggerName)
        } ON public."charge";
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
  },
);

databaseTest(
  "posting only changes the matching company when ids overlap",
  async () => {
    const chargeId = `shared-${crypto.randomUUID()}`;
    const left = await chargeFixture({ chargeId });
    const right = await chargeFixture({ chargeId });
    try {
      await postChargeTransaction(right.db, right.args);
      const leftHeader = await left.db.selectFrom("charge").select([
        "status",
        "journalId",
      ]).where("id", "=", chargeId).where(
        "companyId",
        "=",
        left.companyId,
      ).executeTakeFirstOrThrow();
      const rightHeader = await right.db.selectFrom("charge").select([
        "status",
        "journalId",
      ]).where("id", "=", chargeId).where(
        "companyId",
        "=",
        right.companyId,
      ).executeTakeFirstOrThrow();
      assertEquals(leftHeader, { status: "Draft", journalId: null });
      assertEquals(rightHeader.status, "Posted");
      assertExists(rightHeader.journalId);
    } finally {
      await right.cleanup();
      await left.cleanup();
    }
  },
);

databaseTest(
  "posting fails closed when company settings are missing",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db.deleteFrom("companySettings").where("id", "=", f.companyId)
        .execute();
      await assertRejects(
        () => postChargeTransaction(f.db, f.args),
        Error,
        "settings",
      );
      assertEquals(
        (await f.db.selectFrom("charge").select("status").where(
          "id",
          "=",
          f.chargeId,
        ).where("companyId", "=", f.companyId).executeTakeFirstOrThrow())
          .status,
        "Draft",
      );
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest(
  "posting rejects an account whose class contradicts its role",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db.updateTable("account").set({ class: "Asset" }).where(
        "id",
        "=",
        f.account("card"),
      ).execute();
      await assertRejects(
        () => postChargeTransaction(f.db, f.args),
        Error,
        "account",
      );
      assertEquals(
        (await f.db.selectFrom("charge").select("status").where(
          "id",
          "=",
          f.chargeId,
        ).where("companyId", "=", f.companyId).executeTakeFirstOrThrow())
          .status,
        "Draft",
      );
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest(
  "posting rejects a locked period without an open successor",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db.updateTable("accountingPeriod").set({ closeStatus: "Locked" })
        .where("companyId", "=", f.companyId).execute();
      await assertRejects(
        () => postChargeTransaction(f.db, f.args),
        Error,
        "locked",
      );
      assertEquals(
        (await f.db.selectFrom("charge").select("status").where(
          "id",
          "=",
          f.chargeId,
        ).where("companyId", "=", f.companyId).executeTakeFirstOrThrow())
          .status,
        "Draft",
      );
    } finally {
      await f.cleanup();
    }
  },
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
      const returningId = f.db.insertInto("journalLine").returning("id")
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
        transformResult({ queryId, result }) {
          if (targeted.has(queryId) && result.rows.length > 1) {
            reversedReturning++;
            return { ...result, rows: [...result.rows].reverse() };
          }
          return result;
        },
      });
      const first = await postChargeTransaction(
        reverseBulkIdResults,
        voidArgs,
      );
      const second = await postChargeTransaction(
        reverseBulkIdResults,
        voidArgs,
      );
      assertEquals(reversedReturning, 1);
      assertEquals(first, posted);
      assertEquals(second, posted);
      assertEquals(
        (await f.db.selectFrom("charge").select("status").where(
          "id",
          "=",
          f.chargeId,
        ).where("companyId", "=", f.companyId).executeTakeFirstOrThrow())
          .status,
        "Voided",
      );
      const journals = await f.db.selectFrom("journal").select("id").where(
        "companyId",
        "=",
        f.companyId,
      ).where("sourceType", "=", "Charge").execute();
      assertEquals(journals.length, 2);
      const lines = await f.db.selectFrom("journalLine").select("amount").where(
        "companyId",
        "=",
        f.companyId,
      ).where("documentType", "=", "Charge").execute();
      assertEquals(lines.reduce((total, line) => total + line.amount, 0), 0);
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
          "dimension.valueId",
        ])
        .where("dimension.companyId", "=", f.companyId)
        .orderBy("journal.description")
        .execute();
      assertEquals(dimensions, [
        {
          journalDescription:
            `Charge cardtest-${f.chargeId.split("-")[1]}-readable`,
          accountId: f.account("expense"),
          dimensionId: f.dimensionId,
          valueId: f.costCenterId,
        },
        {
          journalDescription:
            `VOID Charge cardtest-${f.chargeId.split("-")[1]}-readable`,
          accountId: f.account("expense"),
          dimensionId: f.dimensionId,
          valueId: f.costCenterId,
        },
      ]);
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest("void refuses a forged original journal", async () => {
  const f = await chargeFixture();
  try {
    const posted = await postChargeTransaction(f.db, f.args);
    assertExists(posted.journalId);
    await f.db.transaction().execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      await trx.updateTable("journal").set({ sourceType: "Payment" }).where(
        "id",
        "=",
        posted.journalId,
      ).execute();
    });
    await assertRejects(
      () =>
        postChargeTransaction(f.db, {
          ...f.args,
          type: "void",
        }),
      Error,
      "Original charge journal",
    );
    assertEquals(
      (await f.db.selectFrom("charge").select("status").where(
        "id",
        "=",
        f.chargeId,
      ).where("companyId", "=", f.companyId).executeTakeFirstOrThrow()).status,
      "Posted",
    );
  } finally {
    await f.cleanup();
  }
});
