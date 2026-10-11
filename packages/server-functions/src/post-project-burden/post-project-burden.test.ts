// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { projectPostingFixture } from "../lib/project-posting-test-fixture";
import { databaseTest } from "../local-database-test-fixture";
import postProjectBurden, { ACCOUNTING_PERIOD_CLOSED } from "./index";

async function burdenFixture() {
  const f = await projectPostingFixture({ costTreatment: "Contract" });
  const periodId = `${f.prefix}-period`;
  const appliedAccountId = f.account("applied-burden");
  await f.db
    .insertInto("account")
    .values({
      id: appliedAccountId,
      name: "Applied overhead",
      class: "Expense",
      incomeBalance: "Income Statement",
      companyGroupId: f.groupId,
      createdBy: "system"
    })
    .execute();
  const pool = await f.db
    .insertInto("indirectPool")
    .values({
      name: "Overhead",
      poolType: "Overhead",
      sequence: 1,
      baseType: "Direct Labor Dollars",
      appliedAccountId,
      companyId: f.companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const run = await f.db
    .insertInto("indirectRateRun")
    .values({
      accountingPeriodId: periodId,
      fiscalYear: 2099,
      periodNumber: 1,
      companyId: f.companyId,
      createdBy: "system"
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const row = (amount: number, unallowable = false) => ({
    projectId: f.projectId,
    projectElementId: f.elementId,
    indirectPoolId: pool.id,
    indirectRateType: "Provisional" as const,
    burdenFiscalYear: 2026,
    amount,
    unallowable
  });
  const setCloseStatus = (closeStatus: "Locked" | "Closed") =>
    f.db
      .updateTable("accountingPeriod")
      .set({ closeStatus })
      .where("id", "=", periodId)
      .where("companyId", "=", f.companyId)
      .execute();

  return {
    f,
    periodId,
    appliedAccountId,
    poolId: pool.id,
    runId: run.id,
    row,
    setCloseStatus
  };
}

databaseTest(
  "two memo rows write two Burden ledger rows and no journal",
  async () => {
    const b = await burdenFixture();
    try {
      const result = await postProjectBurden(b.f.ctx, {
        indirectRateRunId: b.runId,
        accountingPeriodId: b.periodId,
        postingDate: "2026-10-31",
        postApplied: false,
        rows: [b.row(500), b.row(100, true)]
      });
      expect(result.error).toBeNull();
      expect(result.data?.journalId).toBeNull();

      const ledger = await b.f.db
        .selectFrom("projectLedger")
        .select([
          "costType",
          "documentType",
          "documentId",
          "indirectPoolId",
          "indirectRateType",
          "burdenFiscalYear",
          "unallowable",
          "amount",
          "journalLineId"
        ])
        .where("companyId", "=", b.f.companyId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        ledger.map((row) => ({ ...row, amount: Number(row.amount) }))
      ).toEqual([
        {
          costType: "Burden",
          documentType: "Indirect Burden",
          documentId: b.runId,
          indirectPoolId: b.poolId,
          indirectRateType: "Provisional",
          burdenFiscalYear: 2026,
          unallowable: false,
          amount: 500,
          journalLineId: null
        },
        {
          costType: "Burden",
          documentType: "Indirect Burden",
          documentId: b.runId,
          indirectPoolId: b.poolId,
          indirectRateType: "Provisional",
          burdenFiscalYear: 2026,
          unallowable: true,
          amount: 100,
          journalLineId: null
        }
      ]);

      const journals = await b.f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", b.f.companyId)
        .execute();
      expect(journals).toEqual([]);
      const items = await b.f.db
        .selectFrom("projectBillableItem")
        .select("id")
        .where("companyId", "=", b.f.companyId)
        .execute();
      expect(items).toEqual([]);
    } finally {
      await b.f.cleanup();
    }
  }
);

databaseTest(
  "applied burden on a Contract project posts one balanced journal, Dr Project WIP / Cr the applied account",
  async () => {
    const b = await burdenFixture();
    try {
      const result = await postProjectBurden(b.f.ctx, {
        indirectRateRunId: b.runId,
        accountingPeriodId: b.periodId,
        postingDate: "2026-10-31",
        postApplied: true,
        rows: [b.row(500)]
      });
      expect(result.error).toBeNull();
      const journalId = result.data!.journalId!;
      expect(journalId).toBeTruthy();

      const journal = await b.f.db
        .selectFrom("journal")
        .select(["sourceType", "status", "accountingPeriodId"])
        .where("id", "=", journalId)
        .where("companyId", "=", b.f.companyId)
        .executeTakeFirstOrThrow();
      expect(journal).toEqual({
        sourceType: "Burden",
        status: "Posted",
        accountingPeriodId: b.periodId
      });

      const lines = await b.f.db
        .selectFrom("journalLine")
        .select(["id", "accountId", "amount", "documentType", "documentId"])
        .where("journalId", "=", journalId)
        .where("companyId", "=", b.f.companyId)
        .orderBy("accountId")
        .execute();
      expect(
        lines.map((line) => [
          line.accountId,
          Number(line.amount),
          line.documentType,
          line.documentId
        ])
      ).toEqual([
        [b.appliedAccountId, -500, "Burden", b.runId],
        [b.f.account("project-wip"), 500, "Burden", b.runId]
      ]);

      const ledger = await b.f.db
        .selectFrom("projectLedger")
        .select("journalLineId")
        .where("companyId", "=", b.f.companyId)
        .executeTakeFirstOrThrow();
      const debitLine = lines.find(
        (line) => line.accountId === b.f.account("project-wip")
      );
      expect(ledger.journalLineId).toEqual(debitLine?.id);

      const projectTag = await b.f.db
        .selectFrom("journalLineDimension")
        .select("valueId")
        .where("journalLineId", "=", debitLine!.id)
        .where("dimensionId", "=", b.f.dimension("Project"))
        .where("companyId", "=", b.f.companyId)
        .executeTakeFirst();
      expect(projectTag?.valueId).toEqual(b.f.projectId);
    } finally {
      await b.f.cleanup();
    }
  }
);

databaseTest("a Locked period accepts the burden", async () => {
  const b = await burdenFixture();
  try {
    await b.setCloseStatus("Locked");
    const result = await postProjectBurden(b.f.ctx, {
      indirectRateRunId: b.runId,
      accountingPeriodId: b.periodId,
      postingDate: "2026-10-31",
      postApplied: true,
      rows: [b.row(250)]
    });
    expect(result.error).toBeNull();
    expect(result.data?.projectLedgerIds).toHaveLength(1);
    expect(result.data?.journalId).toBeTruthy();
  } finally {
    await b.f.cleanup();
  }
});

databaseTest("a Closed period refuses the burden", async () => {
  const b = await burdenFixture();
  try {
    await b.setCloseStatus("Closed");
    const result = await postProjectBurden(b.f.ctx, {
      indirectRateRunId: b.runId,
      accountingPeriodId: b.periodId,
      postingDate: "2026-10-31",
      postApplied: false,
      rows: [b.row(250)]
    });
    expect(result.data).toBeNull();
    expect(result.error?.message).toEqual(ACCOUNTING_PERIOD_CLOSED);

    const ledger = await b.f.db
      .selectFrom("projectLedger")
      .select("id")
      .where("companyId", "=", b.f.companyId)
      .execute();
    expect(ledger).toEqual([]);
  } finally {
    await b.f.cleanup();
  }
});

databaseTest(
  "before the accounting cutover the applied burden journal is Provisional with no period",
  async () => {
    const b = await burdenFixture();
    try {
      await b.f.db
        .updateTable("companySettings")
        .set({ accountingCutoverDate: null })
        .where("id", "=", b.f.companyId)
        .execute();
      const result = await postProjectBurden(b.f.ctx, {
        indirectRateRunId: b.runId,
        accountingPeriodId: b.periodId,
        postingDate: "2026-10-31",
        postApplied: true,
        rows: [b.row(500)]
      });
      expect(result.error).toBeNull();
      const journal = await b.f.db
        .selectFrom("journal")
        .select(["status", "accountingPeriodId"])
        .where("id", "=", result.data!.journalId!)
        .where("companyId", "=", b.f.companyId)
        .executeTakeFirstOrThrow();
      expect(journal).toEqual({
        status: "Provisional",
        accountingPeriodId: null
      });
    } finally {
      await b.f.cleanup();
    }
  }
);
