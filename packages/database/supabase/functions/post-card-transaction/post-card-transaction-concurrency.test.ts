import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { sql } from "kysely";
import {
  cardTransactionFixture,
  databaseTest,
} from "./post-card-transaction-test-fixture.ts";
import { postCardTransactionTransaction } from "./post-card-transaction-transaction.ts";

databaseTest(
  "an edit started after posting's parent lock waits and then refuses",
  async () => {
    const f = await cardTransactionFixture();
    const poster = await f.connect();
    const writer = await f.connect();
    const posterPid =
      (await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
        poster,
      )).rows[0]!.pid;
    const writerPid =
      (await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
        writer,
      )).rows[0]!.pid;
    const headerLocked = Promise.withResolvers<void>();
    const resumePosting = Promise.withResolvers<void>();
    let paused = false;
    const postingDb = poster.withPlugin({
      transformQuery: ({ node }) => node,
      async transformResult({ result }) {
        if (
          !paused &&
          result.rows.some((row) =>
            row.id === f.cardTransactionId && row.status === "Draft"
          )
        ) {
          paused = true;
          headerLocked.resolve();
          await resumePosting.promise;
        }
        return result;
      },
    });
    let posting:
      | Promise<PromiseSettledResult<{ journalId: string | null }>>
      | undefined;
    let edit: Promise<PromiseSettledResult<unknown>> | undefined;
    try {
      await sql`SET statement_timeout = '5s'`.execute(poster);
      await sql`SET statement_timeout = '5s'`.execute(writer);
      posting = postCardTransactionTransaction(postingDb, f.args).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
      await Promise.race([
        headerLocked.promise,
        posting.then((result) => {
          if (result.status === "rejected") throw result.reason;
          throw new Error(
            "Posting completed without acquiring the header lock",
          );
        }),
      ]);
      edit = writer.updateTable("cardTransactionLine").set({
        description: "Too late",
      })
        .where("id", "=", f.lineId).where("companyId", "=", f.companyId)
        .execute().then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason) => ({ status: "rejected" as const, reason }),
        );
      // Observe the actual lock wait before allowing posting to read its lines.
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const observed = await sql<
          { blocked: boolean }
        >`SELECT ${posterPid} = ANY(pg_blocking_pids(${writerPid})) AS blocked`
          .execute(f.db);
        if (observed.rows[0]?.blocked) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert(
        blocked,
        "The edit must reach the parent lock before posting resumes",
      );
      resumePosting.resolve();
      const result = await posting;
      assertEquals(result.status, "fulfilled");
      const mutation = await edit;
      assertEquals(mutation.status, "rejected");
      if (mutation.status === "rejected") {
        assert(
          String(mutation.reason).includes("immutable"),
          String(mutation.reason),
        );
      }
    } finally {
      resumePosting.resolve();
      await posting;
      await edit;
      await writer.destroy();
      await poster.destroy();
      await f.cleanup();
    }
  },
);

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
