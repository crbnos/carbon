import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { sql } from "kysely";
import {
  cardTransactionFixture,
  databaseTest,
} from "./post-card-transaction-test-fixture.ts";
import { postCardTransactionTransaction } from "./post-card-transaction-transaction.ts";

databaseTest(
  "posting is atomic, dimension-complete, and idempotent",
  async () => {
    const f = await cardTransactionFixture();
    try {
      const first = await postCardTransactionTransaction(f.db, f.args);
      const second = await postCardTransactionTransaction(f.db, f.args);
      assertEquals(second, first);
      assertExists(first.journalId);
      const header = await f.db.selectFrom("cardTransaction").select([
        "status",
        "journalId",
        "postedAt",
        "postedBy",
      ]).where("id", "=", f.cardTransactionId).where(
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
      ).where("sourceType", "=", "Card Transaction").execute();
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
  const f = await cardTransactionFixture();
  try {
    await f.db.deleteFrom("sequence").where("table", "=", "journalEntry")
      .where("companyId", "=", f.companyId).execute();
    await assertRejects(
      () => postCardTransactionTransaction(f.db, f.args),
      Error,
      "no result",
    );
    const header = await f.db.selectFrom("cardTransaction").select([
      "status",
      "journalId",
    ]).where("id", "=", f.cardTransactionId).where(
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
      ).where("sourceType", "=", "Card Transaction").execute(),
      [],
    );
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a failure after journal creation rolls the entire post back",
  async () => {
    const f = await cardTransactionFixture();
    const triggerName = "test_fail_card_transaction_post_update";
    const functionName = "test_fail_card_transaction_post_update";
    try {
      await sql.raw(`
      CREATE OR REPLACE FUNCTION public.${functionName}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF NEW.status = 'Posted' THEN
          RAISE EXCEPTION 'forced mid-transaction failure';
        END IF;
        RETURN NEW;
      END;
      $function$;
      DROP TRIGGER IF EXISTS ${triggerName} ON public."cardTransaction";
      CREATE TRIGGER ${triggerName}
        BEFORE UPDATE ON public."cardTransaction"
        FOR EACH ROW
        EXECUTE FUNCTION public.${functionName}();
    `).execute(f.db);

      await assertRejects(
        () => postCardTransactionTransaction(f.db, f.args),
        Error,
        "forced mid-transaction failure",
      );
      const header = await f.db.selectFrom("cardTransaction").select([
        "status",
        "journalId",
      ]).where("id", "=", f.cardTransactionId).where(
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
        ).where("sourceType", "=", "Card Transaction").execute(),
        [],
      );
      assertEquals(
        await f.db.selectFrom("journalLine").select("id").where(
          "companyId",
          "=",
          f.companyId,
        ).where("documentType", "=", "Card Transaction").execute(),
        [],
      );
    } finally {
      await sql.raw(`
      DROP TRIGGER IF EXISTS ${triggerName} ON public."cardTransaction";
      DROP FUNCTION IF EXISTS public.${functionName}();
    `).execute(f.db);
      await f.cleanup();
    }
  },
);

databaseTest(
  "posting only changes the matching company when ids overlap",
  async () => {
    const cardTransactionId = `shared-${crypto.randomUUID()}`;
    const left = await cardTransactionFixture({ cardTransactionId });
    const right = await cardTransactionFixture({ cardTransactionId });
    try {
      await postCardTransactionTransaction(right.db, right.args);
      const leftHeader = await left.db.selectFrom("cardTransaction").select([
        "status",
        "journalId",
      ]).where("id", "=", cardTransactionId).where(
        "companyId",
        "=",
        left.companyId,
      ).executeTakeFirstOrThrow();
      const rightHeader = await right.db.selectFrom("cardTransaction").select([
        "status",
        "journalId",
      ]).where("id", "=", cardTransactionId).where(
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
    const f = await cardTransactionFixture();
    try {
      await f.db.deleteFrom("companySettings").where("id", "=", f.companyId)
        .execute();
      await assertRejects(
        () => postCardTransactionTransaction(f.db, f.args),
        Error,
        "settings",
      );
      assertEquals(
        (await f.db.selectFrom("cardTransaction").select("status").where(
          "id",
          "=",
          f.cardTransactionId,
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
    const f = await cardTransactionFixture();
    try {
      await f.db.updateTable("account").set({ class: "Asset" }).where(
        "id",
        "=",
        f.account("card"),
      ).execute();
      await assertRejects(
        () => postCardTransactionTransaction(f.db, f.args),
        Error,
        "account",
      );
      assertEquals(
        (await f.db.selectFrom("cardTransaction").select("status").where(
          "id",
          "=",
          f.cardTransactionId,
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
    const f = await cardTransactionFixture();
    try {
      await f.db.updateTable("accountingPeriod").set({ closeStatus: "Locked" })
        .where("companyId", "=", f.companyId).execute();
      await assertRejects(
        () => postCardTransactionTransaction(f.db, f.args),
        Error,
        "locked",
      );
      assertEquals(
        (await f.db.selectFrom("cardTransaction").select("status").where(
          "id",
          "=",
          f.cardTransactionId,
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
    const f = await cardTransactionFixture();
    try {
      const posted = await postCardTransactionTransaction(f.db, f.args);
      const voidArgs = { ...f.args, type: "void" as const };
      const first = await postCardTransactionTransaction(f.db, voidArgs);
      const second = await postCardTransactionTransaction(f.db, voidArgs);
      assertEquals(first, posted);
      assertEquals(second, posted);
      assertEquals(
        (await f.db.selectFrom("cardTransaction").select("status").where(
          "id",
          "=",
          f.cardTransactionId,
        ).where("companyId", "=", f.companyId).executeTakeFirstOrThrow())
          .status,
        "Voided",
      );
      const journals = await f.db.selectFrom("journal").select("id").where(
        "companyId",
        "=",
        f.companyId,
      ).where("sourceType", "=", "Card Transaction").execute();
      assertEquals(journals.length, 2);
      const lines = await f.db.selectFrom("journalLine").select("amount").where(
        "companyId",
        "=",
        f.companyId,
      ).where("documentType", "=", "Card Transaction").execute();
      assertEquals(lines.reduce((total, line) => total + line.amount, 0), 0);
      assertEquals(
        (await f.db.selectFrom("journalLineDimension").select("id").where(
          "companyId",
          "=",
          f.companyId,
        ).execute()).length,
        2,
      );
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest("void refuses a forged original journal", async () => {
  const f = await cardTransactionFixture();
  try {
    const posted = await postCardTransactionTransaction(f.db, f.args);
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
        postCardTransactionTransaction(f.db, {
          ...f.args,
          type: "void",
        }),
      Error,
      "Original card transaction journal",
    );
    assertEquals(
      (await f.db.selectFrom("cardTransaction").select("status").where(
        "id",
        "=",
        f.cardTransactionId,
      ).where("companyId", "=", f.companyId).executeTakeFirstOrThrow()).status,
      "Posted",
    );
  } finally {
    await f.cleanup();
  }
});
