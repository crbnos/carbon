// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Saving a document's edits, and carrying them to a quote revision.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.

import { expect } from "vitest";
import {
  type GetMethodResult,
  getMethod
} from "../../app/modules/production/production.service";
import { saveDocumentEditRow } from "../../app/modules/settings/settings.service";
import {
  alwaysPostFixture,
  jobFixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

const titled = (title: string) => ({
  blocks: {},
  settings: { text: { title } }
});

databaseTest("a locked record refuses a save and keeps what it had", async () => {
  const f = await alwaysPostFixture();
  try {
    const { jobId } = await jobFixture(f);
    const key = {
      companyId: f.companyId,
      documentType: "jobTraveler" as const,
      documentId: jobId,
      userId: USER
    };
    const notes = { type: "doc", content: [] };

    expect(
      await saveDocumentEditRow(f.db, { ...key, edit: titled("Open"), notes })
    ).toBe("saved");

    await seed(f, (trx) =>
      trx
        .updateTable("job")
        .set({ status: "Cancelled" })
        .where("id", "=", jobId)
        .execute()
    );
    expect(
      await saveDocumentEditRow(f.db, {
        ...key,
        edit: titled("After the lock"),
        notes: { type: "doc", content: [{ type: "paragraph" }] }
      })
    ).toBe("locked");

    const edit = await f.db
      .selectFrom("documentEdit")
      .select("settings")
      .where("companyId", "=", f.companyId)
      .where("documentId", "=", jobId)
      .executeTakeFirstOrThrow();
    const job = await f.db
      .selectFrom("job")
      .select("notes")
      .where("id", "=", jobId)
      .executeTakeFirstOrThrow();
    expect(edit.settings).toEqual({ text: { title: "Open" } });
    expect(job.notes).toEqual(notes);

    expect(
      await saveDocumentEditRow(f.db, {
        ...key,
        documentId: "no-such-job",
        edit: titled("Gone")
      })
    ).toBe("notFound");
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a revision keeps each line's changed values, even on identical lines",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const quoteId = `${f.prefix}-quote`;
      const lineIds = [`${f.prefix}-line-a`, `${f.prefix}-line-b`];
      await seed(f, async (trx) => {
        await trx
          .insertInto("sequence")
          .values({
            table: "quote",
            name: "Quote",
            prefix: "Q-",
            companyId: f.companyId
          })
          .execute();
        await trx
          .insertInto("quote")
          .values({
            id: quoteId,
            quoteId: "Q-1",
            customerId: f.customerId,
            status: "Draft",
            currencyCode: "USD",
            exchangeRate: 1,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("quotePayment")
          .values({ id: quoteId, companyId: f.companyId })
          .execute();
        await trx
          .insertInto("quoteShipment")
          .values({ id: quoteId, companyId: f.companyId })
          .execute();
        for (const id of lineIds) {
          await trx
            .insertInto("quoteLine")
            .values({
              id,
              quoteId,
              itemId: f.partId,
              itemType: "Part",
              description: "Same words on both lines",
              methodType: "Pull from Inventory",
              unitOfMeasureCode: "EA",
              quantity: [1],
              companyId: f.companyId,
              createdBy: USER
            })
            .execute();
        }
      });
      const valueEdits = {
        rows: {
          [`line:${lineIds[0]}`]: { "line.description": "First" },
          [`line:${lineIds[1]}`]: { "line.description": "Second" }
        }
      };
      await saveDocumentEditRow(f.db, {
        companyId: f.companyId,
        documentType: "quote",
        documentId: quoteId,
        userId: USER,
        edit: { blocks: {}, settings: { valueEdits } }
      });

      const copy = async (targetId: string) => {
        const copied = await getMethod(f.service, {
          sourceId: quoteId,
          targetId,
          type: "quoteToQuote"
        });
        return (copied as GetMethodResult).newQuoteId!;
      };

      const revision = await copy(quoteId);
      const lines = await f.db
        .selectFrom("quoteLine")
        .select("id")
        .where("quoteId", "=", revision)
        .execute();
      const edit = await f.db
        .selectFrom("documentEdit")
        .select("settings")
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "quote")
        .where("documentId", "=", revision)
        .executeTakeFirstOrThrow();
      const rows = (
        edit.settings as {
          valueEdits: { rows: Record<string, Record<string, string>> };
        }
      ).valueEdits.rows;
      expect(Object.keys(rows).sort()).toEqual(
        lines.map((line) => `line:${line.id}`).sort()
      );
      expect(
        Object.values(rows)
          .map((row) => row["line.description"])
          .sort()
      ).toEqual(["First", "Second"]);

      const newQuote = await copy("");
      expect(
        await f.db
          .selectFrom("documentEdit")
          .select("id")
          .where("companyId", "=", f.companyId)
          .where("documentId", "=", newQuote)
          .executeTakeFirst()
      ).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  }
);
