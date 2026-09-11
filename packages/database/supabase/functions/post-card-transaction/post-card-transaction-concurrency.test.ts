import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { sql } from "kysely";
import {
  cardTransactionFixture,
  databaseTest,
} from "./post-card-transaction-test-fixture.ts";
import { postCardTransactionTransaction } from "./post-card-transaction-transaction.ts";

databaseTest("concurrent posting retries create one journal", async () => {
  const f = await cardTransactionFixture();
  const left = await f.connect();
  const right = await f.connect();
  try {
    const results = await Promise.all([
      postCardTransactionTransaction(left, f.args),
      postCardTransactionTransaction(right, f.args),
    ]);
    assertEquals(results[0], results[1]);
    assertEquals(
      (await f.db.selectFrom("journal").select("id").where(
        "companyId",
        "=",
        f.companyId,
      ).where("sourceType", "=", "Card Transaction").execute()).length,
      1,
    );
  } finally {
    await left.destroy();
    await right.destroy();
    await f.cleanup();
  }
});

databaseTest(
  "concurrent void retries create one reversal journal",
  async () => {
    const f = await cardTransactionFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      const posted = await postCardTransactionTransaction(f.db, f.args);
      const args = { ...f.args, type: "void" as const };
      const results = await Promise.all([
        postCardTransactionTransaction(left, args),
        postCardTransactionTransaction(right, args),
      ]);
      assertEquals(results, [posted, posted]);
      assertEquals(
        (await f.db.selectFrom("journal").select("id").where(
          "companyId",
          "=",
          f.companyId,
        ).where("sourceType", "=", "Card Transaction").execute()).length,
        2,
      );
      assertEquals(
        (await f.db.selectFrom("cardTransaction").select("status").where(
          "id",
          "=",
          f.cardTransactionId,
        ).where("companyId", "=", f.companyId).executeTakeFirstOrThrow())
          .status,
        "Voided",
      );
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  },
);

databaseTest("a line mutation holds the parent lock until commit", async () => {
  const f = await cardTransactionFixture();
  const writer = await f.connect();
  const poster = await f.connect();
  let releaseWriter!: () => void;
  let reportWriterReady!: () => void;
  const writerReady = new Promise<void>((resolve) => {
    reportWriterReady = resolve;
  });
  const writerRelease = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  let heldMutation: Promise<void> | undefined;
  try {
    heldMutation = writer.transaction().execute(async (trx) => {
      await trx.updateTable("cardTransactionLine").set({
        description: "Committed before posting",
      }).where("id", "=", f.lineId).where(
        "companyId",
        "=",
        f.companyId,
      ).execute();
      reportWriterReady();
      await writerRelease;
    });
    await writerReady;
    await sql`SET lock_timeout = '250ms'`.execute(poster);
    await assertRejects(
      () => postCardTransactionTransaction(poster, f.args),
      Error,
      "lock timeout",
    );
    releaseWriter();
    await heldMutation;
    await sql`SET lock_timeout = '0'`.execute(poster);
    const result = await postCardTransactionTransaction(poster, f.args);
    const descriptions = await f.db.selectFrom("journalLine").select(
      "description",
    ).where("journalId", "=", result.journalId!).execute();
    assertEquals(
      descriptions.some((line) =>
        line.description === "Committed before posting"
      ),
      true,
    );
  } finally {
    releaseWriter?.();
    await heldMutation?.catch(() => undefined);
    await writer.destroy();
    await poster.destroy();
    await f.cleanup();
  }
});
