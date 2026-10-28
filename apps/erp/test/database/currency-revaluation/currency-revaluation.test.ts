// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The currency revaluation run's reads and Undo against a real database:
// what counts as an account's booked balance, which accounts are this
// company's exposures, when a posted run is stale, and when Undo refuses.
// Posting a run end to end, and the CTA posting: what counts as posted, and
// its refusal of a non-Equity account.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  insertCurrencyTranslationJournal,
  postCurrencyRevaluationRun,
  previewCurrencyRevaluation,
  RunReversalError,
  readRevaluationExposures,
  reverseCurrencyRevaluationRun
} from "../../../app/modules/accounting/accounting.service";
import { currencyRevaluationFixture } from "../fixtures/currency-revaluation";
import { databaseTest } from "../fixtures/local-database";

const PERIOD_END = "2026-10-31";

databaseTest(
  "an EUR bank account is booked at its ledger balance without revaluation, and a sibling's EUR account is not an exposure",
  async () => {
    const f = await currencyRevaluationFixture();
    try {
      const { db, companyId, accounts } = f;
      // Cash of $100 into the EUR bank account on Oct 15.
      await f.postJournal({
        sourceType: "Manual",
        postingDate: "2026-10-15",
        lines: [
          { accountId: accounts.eurBank, amount: 100 },
          { accountId: accounts.misc, amount: -100 }
        ]
      });
      // A revaluation alone on the sibling's account is not activity.
      await f.postJournal({
        sourceType: "Currency Revaluation",
        postingDate: PERIOD_END,
        lines: [
          { accountId: accounts.siblingEurBank, amount: 5 },
          { accountId: accounts.gain, amount: 5 }
        ]
      });
      // The run's own valuation: +20 straight onto the account at period end.
      await f.postJournal({
        sourceType: "Currency Revaluation",
        postingDate: PERIOD_END,
        lines: [
          { accountId: accounts.eurBank, amount: 20 },
          { accountId: accounts.gain, amount: 20 }
        ]
      });

      const { exposures } = await readRevaluationExposures(db, {
        companyId,
        periodEnd: PERIOD_END,
        defaults: {
          arRevaluationAccount: accounts.arRevaluation,
          apRevaluationAccount: accounts.apRevaluation
        }
      });

      expect(
        exposures.map((e) => [e.exposureType, e.accountId, e.bookedBaseAmount])
      ).toEqual([["Account Balance", accounts.eurBank, 100]]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a posted run whose only item is no longer open still fails the close check",
  async () => {
    const f = await currencyRevaluationFixture();
    try {
      const { db, companyId, accounts } = f;
      // Posted at period end for an invoice a back-dated payment later paid:
      // nothing is open any more, but the posted unrealized gain remains.
      const run = await db
        .insertInto("currencyRevaluationRun")
        .values({
          currencyRevaluationRunId: "FXR-TEST-1",
          companyId,
          periodEnd: PERIOD_END,
          status: "Posted",
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .insertInto("currencyRevaluationRate")
        .values({
          companyId,
          runId: run.id,
          currencyCode: "EUR",
          rate: 0.85,
          rateSource: "Market",
          createdBy: "system"
        })
        .execute();
      await db
        .insertInto("currencyRevaluationLine")
        .values({
          companyId,
          runId: run.id,
          exposureType: "Receivable",
          documentType: "Invoice",
          documentId: "paid-invoice",
          accountId: accounts.arRevaluation,
          currencyCode: "EUR",
          openAmount: 1000,
          bookedBaseAmount: 1111.11,
          revaluedBaseAmount: 1176.47059,
          differenceAmount: 65.36059,
          createdBy: "system"
        })
        .execute();

      expect(
        await previewCurrencyRevaluation(db, {
          companyId,
          periodEnd: PERIOD_END
        })
      ).toEqual({ count: 1, amount: 0, error: null });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "Undo refuses a posted run once its period is closed",
  async () => {
    const f = await currencyRevaluationFixture();
    try {
      const { db, companyId, periodId } = f;
      const run = await db
        .insertInto("currencyRevaluationRun")
        .values({
          currencyRevaluationRunId: "FXR-TEST-2",
          companyId,
          periodEnd: PERIOD_END,
          status: "Posted",
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .updateTable("accountingPeriod")
        .set({ closeStatus: "Closed" })
        .where("id", "=", periodId)
        .where("companyId", "=", companyId)
        .execute();

      await expect(
        reverseCurrencyRevaluationRun(db, {
          runId: run.id,
          periods: new Map(),
          companyId,
          userId: "system"
        })
      ).rejects.toThrow(RunReversalError);
      const after = await db
        .selectFrom("currencyRevaluationRun")
        .select("status")
        .where("id", "=", run.id)
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow();
      expect(after.status).toBe("Posted");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "revaluation does not apply to a company with nothing in a foreign currency",
  async () => {
    const f = await currencyRevaluationFixture();
    try {
      expect(
        await previewCurrencyRevaluation(f.db, {
          companyId: f.companyId,
          periodEnd: PERIOD_END
        })
      ).toEqual({ count: 0, amount: 0, error: null, applicable: false });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the CTA posting refuses a non-Equity offset account and writes nothing",
  async () => {
    const f = await currencyRevaluationFixture();
    try {
      const { db, companyId, companyGroupId, accounts } = f;
      // A credit-natural CTA account with an Asset offset: +50 and -50 would
      // both credit, and the journal would post unbalanced.
      await expect(
        insertCurrencyTranslationJournal(db, {
          companyGroupId,
          eliminationCompanyId: companyId,
          periodEnd: PERIOD_END,
          liveCta: 50,
          ctaAccountId: accounts.gain,
          offsetAccountId: accounts.misc,
          userId: "system"
        })
      ).rejects.toThrow("must be two different Equity accounts");

      const journals = await db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", companyId)
        .where("sourceType", "=", "Currency Translation")
        .execute();
      expect(journals).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

/** A November period, for the reversal a revaluation dates the next day. */
async function addNovemberPeriod(
  f: Awaited<ReturnType<typeof currencyRevaluationFixture>>
) {
  const period = await f.db
    .insertInto("accountingPeriod")
    .values({
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      companyId: f.companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return period.id;
}

async function draftRun(
  f: Awaited<ReturnType<typeof currencyRevaluationFixture>>,
  readableId: string
) {
  const run = await f.db
    .insertInto("currencyRevaluationRun")
    .values({
      currencyRevaluationRunId: readableId,
      companyId: f.companyId,
      periodEnd: PERIOD_END,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return run.id;
}

databaseTest(
  "a run with nothing to revalue posts without writing empty journals",
  async () => {
    const f = await currencyRevaluationFixture();
    try {
      const { db, companyId, periodId, accounts } = f;
      const novemberId = await addNovemberPeriod(f);
      const runId = await draftRun(f, "FXR-TEST-EMPTY");

      const result = await postCurrencyRevaluationRun(db, {
        runId,
        valuationPeriod: { accountingPeriodId: periodId, postingDate: PERIOD_END },
        reversalPeriod: {
          accountingPeriodId: novemberId,
          postingDate: "2026-11-01"
        },
        gainAccountId: accounts.gain,
        lossAccountId: accounts.loss,
        companyId,
        userId: "system"
      });

      expect(result).toEqual({ journalId: null, reversalJournalId: null });
      const run = await db
        .selectFrom("currencyRevaluationRun")
        .select(["status", "journalId", "reversalJournalId"])
        .where("id", "=", runId)
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow();
      expect(run).toEqual({
        status: "Posted",
        journalId: null,
        reversalJournalId: null
      });
      const journals = await db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", companyId)
        .where("sourceType", "=", "Currency Revaluation")
        .execute();
      expect(journals).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "posting a run books the gain at period end and reverses it the next day; Undo nets both away",
  async () => {
    const f = await currencyRevaluationFixture();
    try {
      const { db, companyId, periodId, accounts } = f;
      const novemberId = await addNovemberPeriod(f);
      // EUR 100 booked at $100. At 0.8 EUR per USD it is worth $125.
      await f.postJournal({
        sourceType: "Manual",
        postingDate: "2026-10-15",
        lines: [
          { accountId: accounts.eurBank, amount: 100 },
          { accountId: accounts.misc, amount: -100 }
        ]
      });
      const runId = await draftRun(f, "FXR-TEST-POST");
      await db
        .insertInto("currencyRevaluationRate")
        .values({
          companyId,
          runId,
          currencyCode: "EUR",
          rate: 0.8,
          rateSource: "Manual",
          createdBy: "system"
        })
        .execute();
      await db
        .insertInto("currencyRevaluationLine")
        .values({
          companyId,
          runId,
          exposureType: "Account Balance",
          accountId: accounts.eurBank,
          currencyCode: "EUR",
          openAmount: 100,
          bookedBaseAmount: 100,
          revaluedBaseAmount: 125,
          differenceAmount: 25,
          createdBy: "system"
        })
        .execute();

      const posted = await postCurrencyRevaluationRun(db, {
        runId,
        valuationPeriod: { accountingPeriodId: periodId, postingDate: PERIOD_END },
        reversalPeriod: {
          accountingPeriodId: novemberId,
          postingDate: "2026-11-01"
        },
        gainAccountId: accounts.gain,
        lossAccountId: accounts.loss,
        companyId,
        userId: "system"
      });
      if (!posted.journalId || !posted.reversalJournalId) {
        throw new Error("Expected both journals");
      }

      const lines = await db
        .selectFrom("journalLine as l")
        .innerJoin("journal as j", "j.id", "l.journalId")
        .select([
          "j.id as journalId",
          sql<string>`j."postingDate"::text`.as("postingDate"),
          "l.accountId",
          "l.amount"
        ])
        .where("j.id", "in", [posted.journalId, posted.reversalJournalId])
        .orderBy("j.postingDate")
        .orderBy("l.accountId")
        .execute();
      // Natural-signed: +25 debits the bank (Asset) and credits the gain.
      expect(
        lines.map((l) => [l.postingDate, l.accountId, Number(l.amount)])
      ).toEqual(
        [
          [PERIOD_END, accounts.eurBank, 25],
          [PERIOD_END, accounts.gain, 25],
          ["2026-11-01", accounts.eurBank, -25],
          ["2026-11-01", accounts.gain, -25]
        ].sort((a, b) =>
          `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`)
        )
      );

      await reverseCurrencyRevaluationRun(db, {
        runId,
        periods: new Map([
          [PERIOD_END, { accountingPeriodId: periodId, postingDate: PERIOD_END }],
          [
            "2026-11-01",
            { accountingPeriodId: novemberId, postingDate: "2026-11-01" }
          ]
        ]),
        companyId,
        userId: "system"
      });
      const net = await db
        .selectFrom("journalLine as l")
        .innerJoin("journal as j", "j.id", "l.journalId")
        .select(sql<number>`SUM(l."amount")`.as("total"))
        .where("j.companyId", "=", companyId)
        .where("j.sourceType", "=", "Currency Revaluation")
        .where("l.accountId", "=", accounts.eurBank)
        .executeTakeFirstOrThrow();
      expect(Number(net.total)).toBe(0);
      const run = await db
        .selectFrom("currencyRevaluationRun")
        .select("status")
        .where("id", "=", runId)
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow();
      expect(run.status).toBe("Draft");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the CTA posts the movement once, reading what is posted from its own journals",
  async () => {
    const f = await currencyRevaluationFixture();
    try {
      const { db, companyId, companyGroupId, accounts } = f;
      const post = (liveCta: number) =>
        insertCurrencyTranslationJournal(db, {
          companyGroupId,
          eliminationCompanyId: companyId,
          periodEnd: PERIOD_END,
          liveCta,
          ctaAccountId: accounts.cta,
          offsetAccountId: accounts.ctaOffset,
          userId: "system"
        });

      const first = await post(50);
      expect(first?.movement).toBe(50);
      const lines = await db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("journalId", "=", first!.journalId)
        .where("companyId", "=", companyId)
        .orderBy("amount", "desc")
        .execute();
      // Cr CTA 50, Dr offset 50 (both Equity, natural-signed).
      expect(lines.map((l) => [l.accountId, Number(l.amount)])).toEqual([
        [accounts.cta, 50],
        [accounts.ctaOffset, -50]
      ]);

      // Posted again with nothing new: no movement.
      expect(await post(50)).toBeNull();

      // A manual entry on the offset account does not change what is posted.
      await f.postJournal({
        sourceType: "Manual",
        postingDate: "2026-10-20",
        lines: [
          { accountId: accounts.ctaOffset, amount: -7 },
          { accountId: accounts.cta, amount: 7 }
        ]
      });
      expect(await post(50)).toBeNull();

      // The consolidated CTA grows by 10: only the 10 posts.
      expect((await post(60))?.movement).toBe(10);
    } finally {
      await f.cleanup();
    }
  }
);

