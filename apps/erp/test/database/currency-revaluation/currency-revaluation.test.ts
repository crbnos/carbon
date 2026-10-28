// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The currency revaluation run's reads and Undo against a real database:
// what counts as an account's booked balance, which accounts are this
// company's exposures, when a posted run is stale, and when Undo refuses.
// Plus the CTA posting's refusal of a non-Equity account.

import { expect } from "vitest";
import {
  insertCurrencyTranslationJournal,
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
