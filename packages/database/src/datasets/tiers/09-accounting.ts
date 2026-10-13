// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "../../precision.ts";
import {
  PROJECT_BASELINE_FORMAT_VERSION,
  toPlanSnapshot
} from "../../project-plan.ts";
import {
  CLOSED_PERIOD_MONTHS_BACK,
  LABOR_RATE_EFFECTIVE_OFFSET,
  LOCKED_PERIOD_MONTHS_BACK,
  monthBack,
  previousMonthEnd,
  resolveDate,
  resolveTimesheetDay,
  resolveTimestamp,
  SEEDED_PERIOD_MONTHS
} from "../dates.ts";
import { insertMemo } from "../helpers/memo.ts";
import {
  type AccountingPeriodRange,
  loadPostingContext,
  type PostingContext,
  periodFor,
  postInventoryDocuments,
  postMemos,
  postPayment,
  postPurchaseInvoices,
  postSalesInvoices
} from "../helpers/post-documents.ts";
import {
  insertId,
  insertMaybe,
  insertRow,
  maybeOne,
  need,
  nextSequence,
  one,
  RICH,
  rows
} from "../sql.ts";
import type {
  AccountClass,
  BillingAddressSpec,
  Ctx,
  DayOffset,
  JournalEntrySpec,
  JournalLineSpec,
  ProjectElementSpec,
  ProjectStateName,
  ServiceTemplateNodeSpec
} from "../types.ts";

// Mirrors get-accounting-period.ts so seeded periods get the same (fiscalYear,
// periodNumber) key the app computes.
const MONTH_NUMBER: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12
};

export async function runTier9(ctx: Ctx): Promise<void> {
  const { client, companyId, companyGroupId } = ctx;
  const data = ctx.dataset.accounting;

  // account is scoped by companyGroupId, not companyId. The client bypasses RLS,
  // so an unscoped pick would post this company's lines to another tenant's account.
  const acctAR = await maybeOne<{ id: string }>(
    client,
    `SELECT id FROM account WHERE class = 'Asset' AND "companyGroupId" = $1 ORDER BY number LIMIT 1`,
    [companyGroupId]
  );
  const acctSales = await maybeOne<{ id: string }>(
    client,
    `SELECT id FROM account WHERE class = 'Revenue' AND "companyGroupId" = $1 ORDER BY number LIMIT 1`,
    [companyGroupId]
  );
  if (!acctAR || !acctSales) {
    throw new Error(
      "Seed: no GL accounts found for this company group — bootstrap must seed the chart of accounts before datasets apply"
    );
  }
  const accountIdByClass = new Map<AccountClass, string>([
    ["Asset", acctAR.id],
    ["Revenue", acctSales.id]
  ]);
  const accountIdByNumber: Record<string, string> = Object.fromEntries(
    (
      await rows<{ id: string; number: string }>(
        client,
        `SELECT id, number FROM account
         WHERE "companyGroupId" = $1 AND number IS NOT NULL AND "isGroup" = false`,
        [companyGroupId]
      )
    ).map((a) => [a.number, a.id])
  );
  const resolveAccount = async (line: JournalLineSpec): Promise<string> => {
    if (line.account !== undefined) {
      return need(accountIdByNumber, line.account, "GL account");
    }
    const cached = accountIdByClass.get(line.accountClass);
    if (cached) return cached;
    const row = await one<{ id: string }>(
      client,
      `SELECT id FROM account WHERE class = $1 AND "companyGroupId" = $2 ORDER BY number LIMIT 1`,
      [line.accountClass, companyGroupId]
    );
    accountIdByClass.set(line.accountClass, row.id);
    return row.id;
  };

  const defaults = await one<{ bankCashAccount: string | null }>(
    client,
    `SELECT "bankCashAccount" FROM "accountDefault" WHERE "companyId" = $1`,
    [companyId]
  );

  // Before the journals, so the journal_check_period_open trigger vets every
  // seeded posting date against the seeded close state.
  const periods = await seedAccountingPeriods(ctx);
  const posting = await loadPostingContext(ctx, periods);

  await seedProjects(ctx);
  await seedProjectStock(ctx);
  await seedServiceWork(ctx);
  for (const spec of data.projects) {
    const projectId = need(ctx.refs.misc, `project:${spec.key}`, "project");
    if (spec.purchaseInvoiceLine) {
      const invoiceId = need(
        ctx.refs.misc,
        `pinv:${spec.purchaseInvoiceLine.invoiceKey}`,
        "purchase invoice"
      );
      const item = need(ctx.refs.items, spec.purchaseInvoiceLine.item, "item");
      const res = await client.query(
        `UPDATE "purchaseInvoiceLine" SET "projectId" = $1, "updatedBy" = $2
         WHERE "invoiceId" = $3 AND "itemId" = $4 AND "companyId" = $5`,
        [projectId, ctx.userId, invoiceId, item.id, companyId]
      );
      if (res.rowCount !== 1) {
        throw new Error(
          `Seed: project "${spec.key}" expected one purchase invoice line for "${spec.purchaseInvoiceLine.item}", found ${res.rowCount}`
        );
      }
    }
  }

  // dimension/dimensionValue are companyGroup-scoped (no companyId), so the
  // dataset wipe never clears them — look up before inserting.
  const projectDimension = await maybeOne<{ id: string }>(
    client,
    `SELECT id FROM dimension
     WHERE "companyGroupId" = $1 AND "entityType" = 'Project' AND active = true
     ORDER BY id LIMIT 1`,
    [companyGroupId]
  );
  const custom = data.customDimension;
  let customDimensionId = (
    await maybeOne<{ id: string }>(
      client,
      `SELECT id FROM dimension WHERE "companyGroupId" = $1 AND name = $2 AND active = true`,
      [companyGroupId, custom.name]
    )
  )?.id;
  if (!customDimensionId) {
    ctx.log(`dimension ${custom.name} — Custom`);
    customDimensionId = await insertId(ctx, "dimension", {
      name: custom.name,
      entityType: "Custom",
      companyGroupId
    });
  }
  const dimensionValueIds: Record<string, string> = {};
  for (const value of custom.values) {
    const existing = await maybeOne<{ id: string }>(
      client,
      `SELECT id FROM "dimensionValue" WHERE "dimensionId" = $1 AND name = $2`,
      [customDimensionId, value]
    );
    dimensionValueIds[value] =
      existing?.id ??
      (await insertId(ctx, "dimensionValue", {
        dimensionId: customDimensionId,
        name: value,
        companyGroupId
      }));
  }
  const resolveDimension = (tag: {
    dimension: string;
    value: string;
  }): { dimensionId: string; valueId: string } => {
    if (tag.dimension === "Project") {
      if (!projectDimension) {
        throw new Error(
          "Seed: no active Project dimension for this company group — bootstrap seeds it"
        );
      }
      return {
        dimensionId: projectDimension.id,
        valueId: need(ctx.refs.misc, `project:${tag.value}`, "project")
      };
    }
    if (tag.dimension !== custom.name) {
      throw new Error(`Seed: unknown dimension "${tag.dimension}"`);
    }
    return {
      dimensionId: customDimensionId,
      valueId: need(dimensionValueIds, tag.value, "dimension value")
    };
  };

  for (const entry of data.journalEntries) {
    const journalId = await seedJournal(ctx, posting, entry, resolveAccount);
    for (const line of entry.lines) {
      if (!line.dimensions?.length) continue;
      const lineRow = await one<{ id: string }>(
        client,
        `SELECT id FROM "journalLine"
         WHERE "journalId" = $1 AND "journalLineReference" = $2 AND "companyId" = $3`,
        [journalId, line.journalLineReference, companyId]
      );
      for (const tag of line.dimensions) {
        await insertMaybe(ctx, "journalLineDimension", {
          journalLineId: lineRow.id,
          ...resolveDimension(tag)
        });
      }
    }
  }

  await postInventoryDocuments(ctx, posting);
  // After the receipt cost layers exist: a grouped receipt splits them.
  await seedPlanningGroups(ctx);
  await seedIndirectPools(ctx, accountIdByNumber);
  await postSalesInvoices(ctx, posting);
  await postPurchaseInvoices(ctx, posting);

  for (const spec of data.memos) {
    const isCredit = spec.direction === "Credit";
    const invoice = await one<{
      id: string;
      invoiceId: string;
      currencyCode: string;
    }>(
      client,
      `SELECT id, "invoiceId", "currencyCode" FROM ${isCredit ? '"salesInvoice"' : '"purchaseInvoice"'}
       WHERE id = $1 AND "companyId" = $2`,
      [
        need(
          ctx.refs.misc,
          `${isCredit ? "sinv" : "pinv"}:${spec.invoiceKey}`,
          "invoice"
        ),
        companyId
      ]
    );
    ctx.log(`${spec.direction.toLowerCase()} memo ${spec.key} — Posted`);
    const memoId = await insertMemo(ctx, {
      direction: spec.direction,
      partyId: isCredit
        ? need(ctx.refs.customers, spec.customer ?? "", "customer")
        : need(ctx.refs.suppliers, spec.supplier ?? "", "supplier"),
      status: "Posted",
      dateOffset: spec.dateOffset,
      amount: spec.amount,
      currencyCode: invoice.currencyCode,
      exchangeRate: 1,
      reference: invoice.invoiceId,
      notes: spec.notes
    });
    ctx.refs.documents[`memo:${spec.key}`] = memoId;
  }
  // Also journals the Posted return credits tier 04 wrote.
  await postMemos(ctx, posting);

  if (data.payments.length > 0 && !defaults.bankCashAccount) {
    throw new Error("Seed: accountDefault.bankCashAccount is not set");
  }
  for (const spec of data.payments) {
    const isReceipt = spec.type === "Receipt";
    const paymentDate = resolveDate(ctx.anchor, spec.dateOffset);
    const posted = spec.status !== "Draft";
    ctx.log(`payment ${spec.key} — ${spec.type} ${spec.status ?? "Posted"}`);
    const paymentReadableId = await nextSequence(ctx, "payment");
    const paymentId = await insertId(ctx, "payment", {
      paymentId: paymentReadableId,
      paymentType: spec.type,
      customerId: isReceipt
        ? need(ctx.refs.customers, spec.customer ?? "", "customer")
        : undefined,
      supplierId: isReceipt
        ? undefined
        : need(ctx.refs.suppliers, spec.supplier ?? "", "supplier"),
      currencyCode: "USD",
      exchangeRate: 1,
      bankAccount: defaults.bankCashAccount,
      paymentDate,
      postingDate: posted ? paymentDate : undefined,
      totalAmount: spec.amount,
      reference: spec.reference,
      status: posted ? "Posted" : "Draft",
      postedAt: posted
        ? resolveTimestamp(ctx.anchor, spec.dateOffset, "15:00:00")
        : undefined,
      postedBy: posted ? ctx.userId : undefined
    });
    ctx.refs.documents[`payment:${spec.key}`] = paymentId;
    if (!posted) {
      if (spec.applies.length > 0 || spec.credits?.length) {
        throw new Error(
          `Seed: Draft payment "${spec.key}" must be unapplied (the apply table is the point)`
        );
      }
      continue;
    }

    const invoiceIdFor = (invoiceKey: string) =>
      need(
        ctx.refs.misc,
        `${isReceipt ? "sinv" : "pinv"}:${invoiceKey}`,
        "invoice"
      );
    const target = (invoiceKey: string) => {
      const id = invoiceIdFor(invoiceKey);
      return isReceipt
        ? { targetSalesInvoiceId: id }
        : { targetPurchaseInvoiceId: id };
    };
    // Base currency at rate 1: appliedAmount (base) = sourceAmount (principal).
    for (const apply of spec.applies) {
      await insertRow(ctx, "invoiceSettlement", {
        paymentId,
        ...target(apply.invoiceKey),
        appliedAmount: apply.amount,
        sourceAmount: apply.amount,
        sourceExchangeRate: 1,
        targetExchangeRate: 1,
        discountAmount: 0,
        writeOffAmount: 0,
        fxGainLossAmount: 0,
        appliedDate: paymentDate
      });
    }
    // Matching-snapshot memo applications are GL-neutral (applyCreditsToInvoices).
    for (const credit of spec.credits ?? []) {
      await insertRow(ctx, "invoiceSettlement", {
        memoId: need(ctx.refs.documents, `memo:${credit.memoKey}`, "memo"),
        appliedViaPaymentId: paymentId,
        ...target(credit.invoiceKey),
        appliedAmount: credit.amount,
        sourceAmount: credit.amount,
        sourceExchangeRate: 1,
        targetExchangeRate: 1,
        discountAmount: 0,
        writeOffAmount: 0,
        fxGainLossAmount: 0,
        appliedDate: paymentDate
      });
    }
    await postPayment(ctx, posting, {
      paymentId,
      paymentReadableId,
      type: spec.type,
      amount: spec.amount,
      postingDate: paymentDate,
      applies: spec.applies.map((apply) => ({
        targetId: invoiceIdFor(apply.invoiceKey),
        amount: apply.amount
      }))
    });
  }

  for (const spec of data.exchangeRateOverrides) {
    ctx.log(`exchange rate override ${spec.currencyCode}`);
    await insertMaybe(ctx, "exchangeRateOverride", {
      currencyCode: spec.currencyCode,
      rate: spec.rate
    });
  }

  // ── Fixed assets ─────────────────────────────────────────────────────────
  // fixedAssetClass is in PRESERVED_TABLES — bootstrap seeds the three classes,
  // so look them up by name rather than inserting.
  const faClasses = await rows<{ id: string; name: string }>(
    client,
    `SELECT id, name FROM "fixedAssetClass" WHERE "companyId" = $1`,
    [companyId]
  );
  const faClassByName = new Map(faClasses.map((c) => [c.name, c.id]));
  const fallbackClassId = faClasses[0]?.id;

  const runLines: { fixedAssetId: string; amount: number }[] = [];

  for (const spec of data.fixedAssets) {
    const fixedAssetClassId =
      faClassByName.get(spec.className) ?? fallbackClassId;
    if (!fixedAssetClassId) {
      throw new Error(
        `Seed: missing fixedAssetClass "${spec.className}" for fixed asset "${spec.name}" (and no fallback class exists)`
      );
    }
    ctx.log(`fixed asset ${spec.name} — ${spec.status}`);
    const fixedAssetId = await nextSequence(ctx, "fixedAsset");
    const disposalDate =
      spec.disposal === undefined
        ? undefined
        : resolveDate(ctx.anchor, spec.disposal.dateOffset);
    const fa = await insertId(ctx, "fixedAsset", {
      fixedAssetId,
      fixedAssetClassId,
      locationId: need(ctx.refs.locations, spec.location, "location"),
      name: spec.name,
      description: spec.description,
      serialNumber: spec.serialNumber,
      status: spec.status,
      depreciationMethod: spec.depreciationMethod,
      usefulLifeMonths: spec.usefulLifeMonths,
      residualValuePercent: spec.residualValuePercent,
      acquisitionCost: spec.acquisitionCost,
      acquisitionDate:
        spec.acquisitionOffset === null
          ? null
          : resolveDate(ctx.anchor, spec.acquisitionOffset),
      depreciationStartDate:
        spec.depreciationStartOffset === null
          ? null
          : resolveDate(ctx.anchor, spec.depreciationStartOffset),
      accumulatedDepreciation: spec.accumulatedDepreciation,
      // Undefined keys are dropped by insertId, so plain assets insert as before.
      assetLifetimeUsage: spec.assetLifetimeUsage,
      disposalDate,
      disposalMethod: spec.disposal?.method,
      saleProceeds: spec.disposal?.saleProceeds
    });
    ctx.refs.documents[`fixedAsset:${spec.key}`] = fa;
    if (spec.depreciationCharge) {
      runLines.push({ fixedAssetId: fa, amount: spec.depreciationCharge });
    }
    for (const log of spec.usageLogs ?? []) {
      const { start, end } = monthBack(ctx.anchor, log.monthsBack);
      await insertRow(ctx, "fixedAssetUsageLog", {
        fixedAssetId: fa,
        periodStart: start.toString(),
        periodEnd: end.toString(),
        unitsProduced: log.unitsProduced
      });
    }
    if (spec.disposal && disposalDate) {
      // The app's disposal math: NBV = cost − accumulated depreciation, and the
      // gain/(loss) is proceeds − NBV (post-sales-invoice).
      const netBookValueAtDisposal = round(
        spec.acquisitionCost - spec.accumulatedDepreciation
      );
      await insertRow(ctx, "fixedAssetDisposal", {
        fixedAssetId: fa,
        disposalDate,
        disposalMethod: spec.disposal.method,
        saleProceeds: spec.disposal.saleProceeds,
        netBookValueAtDisposal,
        gainLoss: round(spec.disposal.saleProceeds - netBookValueAtDisposal)
      });
    }
  }

  ctx.log("AR / AP billing addresses");
  await upsertBillingAddress(
    ctx,
    "companyAccountsReceivableBillingAddress",
    data.billingAddresses.receivable
  );
  await upsertBillingAddress(
    ctx,
    "companyAccountsPayableBillingAddress",
    data.billingAddresses.payable
  );

  // ── Depreciation run: unposted, one line per Active asset ────────────────
  // Mirrors what accounting+/depreciation-runs.new.tsx builds. taxAmount stays
  // NULL because companySettings.assetTaxDepreciationEnabled is off, which is
  // also what buildDepreciationLines() produces in that case.
  if (runLines.length > 0) {
    ctx.log("depreciation run — Draft");
    const depreciationRunId = await nextSequence(ctx, "depreciationRun");
    const run = await insertId(ctx, "depreciationRun", {
      depreciationRunId,
      // One month behind the current period, so "New Depreciation Run" still
      // has a period left to create (getNextPeriodEnd rolls this forward).
      periodEnd: previousMonthEnd(ctx.anchor),
      status: "Draft"
    });
    for (const line of runLines) {
      await insertRow(ctx, "depreciationRunLine", {
        depreciationRunId: run,
        fixedAssetId: line.fixedAssetId,
        amount: line.amount,
        // One line per asset per month; the run covers this one month.
        periodEnd: previousMonthEnd(ctx.anchor)
      });
    }
    ctx.refs.documents["depreciationRun:draft"] = run;
  }
}

async function seedJournal(
  ctx: Ctx,
  posting: PostingContext,
  entry: JournalEntrySpec,
  resolveAccount: (line: JournalLineSpec) => Promise<string>
): Promise<string> {
  const { client, companyId } = ctx;
  const findJournal = (journalEntryId: string) =>
    maybeOne<{ id: string }>(
      client,
      `SELECT id FROM journal WHERE "journalEntryId" = $1 AND "companyId" = $2`,
      [journalEntryId, companyId]
    );

  // journal is preserved across wipes — skip if already seeded. A company holds
  // one Posted Opening Balance (unique index), so an earlier one is adopted too.
  const existing =
    (await findJournal(entry.journalEntryId)) ??
    (entry.sourceType === "Opening Balance"
      ? await maybeOne<{ id: string }>(
          client,
          `SELECT id FROM journal
           WHERE "companyId" = $1 AND "sourceType" = 'Opening Balance' AND status = 'Posted'`,
          [companyId]
        )
      : null);
  if (existing) {
    ctx.log("journal entry — already exists, skipping");
    ctx.refs.documents[entry.ref] = existing.id;
    if (entry.reversal) {
      const reversal = await findJournal(entry.reversal.journalEntryId);
      if (reversal) ctx.refs.documents[entry.reversal.ref] = reversal.id;
    }
    return existing.id;
  }

  ctx.log(`journal entry ${entry.journalEntryId} — ${entry.status}`);
  // A Reversed entry was Posted first; reverseJournalEntry flips it below.
  const posted = entry.status !== "Draft";
  const postedStamp = (offset: number) => ({
    sourceType: entry.sourceType ?? "Manual",
    postedAt: resolveTimestamp(ctx.anchor, offset, "17:00:00"),
    postedBy: ctx.userId
  });
  const postingDate = resolveDate(ctx.anchor, entry.postingOffset);
  const je = await insertId(ctx, "journal", {
    journalEntryId: entry.journalEntryId,
    description: entry.description,
    status: posted ? "Posted" : entry.status,
    postingDate,
    accountingPeriodId: periodFor(posting, postingDate),
    ...(posted ? postedStamp(entry.postingOffset) : {})
  });
  for (const line of entry.lines) {
    await insertId(ctx, "journalLine", {
      journalId: je,
      accountId: await resolveAccount(line),
      description: line.description,
      amount: line.amount,
      quantity: line.quantity,
      journalLineReference: line.journalLineReference
    });
  }
  ctx.refs.documents[entry.ref] = je;

  if (entry.status === "Reversed") {
    const spec = entry.reversal;
    if (!spec) {
      throw new Error(
        `Seed: journal "${entry.ref}" is Reversed but names no reversal entry`
      );
    }
    ctx.log(`journal entry ${spec.journalEntryId} — reversal, Posted`);
    const reversalDate = resolveDate(ctx.anchor, spec.postingOffset);
    const reversal = await insertId(ctx, "journal", {
      journalEntryId: spec.journalEntryId,
      description: `Reversal of ${entry.journalEntryId}`,
      status: "Posted",
      postingDate: reversalDate,
      accountingPeriodId: periodFor(posting, reversalDate),
      reversalOfId: je,
      ...postedStamp(spec.postingOffset)
    });
    for (const line of entry.lines) {
      await insertId(ctx, "journalLine", {
        journalId: reversal,
        accountId: await resolveAccount(line),
        description: line.description,
        amount: -line.amount,
        quantity: line.quantity,
        journalLineReference: spec.journalEntryId
      });
    }
    // Posted → Reversed is the one UPDATE journal_posted_immutable permits.
    await client.query(
      `UPDATE journal SET status = 'Reversed', "reversedById" = $1, "updatedBy" = $2
       WHERE id = $3 AND "companyId" = $4`,
      [reversal, ctx.userId, je, companyId]
    );
    ctx.refs.documents[spec.ref] = reversal;
  }
  return je;
}

// Close is sequential: oldest months Closed, then one Locked, the rest Open.
async function seedAccountingPeriods(
  ctx: Ctx
): Promise<AccountingPeriodRange[]> {
  const { client, companyId } = ctx;
  const fiscal = await maybeOne<{ startMonth: string | null }>(
    client,
    `SELECT "startMonth" FROM "fiscalYearSettings" WHERE "companyId" = $1`,
    [companyId]
  );
  const startMonth = fiscal?.startMonth
    ? (MONTH_NUMBER[fiscal.startMonth] ?? 1)
    : 1;

  // One Active period per company, like resolveAccountingPeriod's "current" mode.
  await client.query(
    `UPDATE "accountingPeriod" SET status = 'Inactive' WHERE "companyId" = $1 AND status = 'Active'`,
    [companyId]
  );

  const closed = new Set<number>(CLOSED_PERIOD_MONTHS_BACK);
  const seeded: AccountingPeriodRange[] = [];
  let lockedPeriodId: string | null = null;
  let lockedPeriodEnd: string | null = null;
  ctx.log(`accounting periods — ${SEEDED_PERIOD_MONTHS} months`);
  for (let back = SEEDED_PERIOD_MONTHS - 1; back >= 0; back--) {
    const { start, end } = monthBack(ctx.anchor, back);
    const fiscalYear =
      startMonth === 1 || start.month < startMonth
        ? start.year
        : start.year + 1;
    const periodNumber = ((start.month - startMonth + 12) % 12) + 1;
    const isClosed = closed.has(back);
    const isLocked = back === LOCKED_PERIOD_MONTHS_BACK;
    // Closed periods went through Locked first.
    const lockedAt =
      isClosed || isLocked
        ? `${end.add({ days: 4 }).toString()}T17:00:00Z`
        : null;
    const closedAt = isClosed
      ? `${end.add({ days: 9 }).toString()}T17:00:00Z`
      : null;
    const period = {
      startDate: start.toString(),
      endDate: end.toString(),
      fiscalYear,
      periodNumber,
      status: back === 0 ? "Active" : "Inactive",
      closeStatus: isClosed ? "Closed" : isLocked ? "Locked" : "Open",
      lockedAt,
      lockedBy: lockedAt ? ctx.userId : null,
      closedAt,
      closedBy: closedAt ? ctx.userId : null
    };
    // accountingPeriod survives the wipe (posted journals reference it), and
    // the app finds a period by date range — so adopt the month's existing
    // row, which job-costing functions may have minted without fiscal numbers,
    // rather than add an overlapping one.
    const existing = await maybeOne<{ id: string }>(
      client,
      `SELECT id FROM "accountingPeriod"
       WHERE "companyId" = $1
         AND (("fiscalYear" = $2 AND "periodNumber" = $3) OR "startDate" = $4)
       ORDER BY ("fiscalYear" = $2 AND "periodNumber" = $3) DESC NULLS LAST, id
       LIMIT 1`,
      [companyId, fiscalYear, periodNumber, period.startDate]
    );
    let periodId: string;
    if (existing) {
      periodId = existing.id;
      await client.query(
        `UPDATE "accountingPeriod" SET
           "startDate" = $3, "endDate" = $4, "fiscalYear" = $5,
           "periodNumber" = $6, status = $7, "closeStatus" = $8,
           "lockedAt" = $9, "lockedBy" = $10, "closedAt" = $11,
           "closedBy" = $12, "updatedBy" = $13
         WHERE id = $1 AND "companyId" = $2`,
        [
          periodId,
          companyId,
          period.startDate,
          period.endDate,
          period.fiscalYear,
          period.periodNumber,
          period.status,
          period.closeStatus,
          period.lockedAt,
          period.lockedBy,
          period.closedAt,
          period.closedBy,
          ctx.userId
        ]
      );
    } else {
      periodId = await insertId(ctx, "accountingPeriod", period);
    }
    seeded.push({
      id: periodId,
      startDate: period.startDate,
      endDate: period.endDate
    });
    if (isLocked) {
      lockedPeriodId = periodId;
      lockedPeriodEnd = end.toString();
    }
  }

  // Snapshot the bootstrap definitions the way getPeriodCloseChecklist
  // instantiates them; the rest of the checklist materializes on first view.
  const tasks = ctx.dataset.accounting.closeTasks;
  if (tasks.length === 0) return seeded;
  if (!lockedPeriodId || !lockedPeriodEnd) {
    throw new Error("Seed: close tasks need a Locked period");
  }
  const definitions = await rows<{
    id: string;
    name: string;
    taskType: string;
    autoCheckKey: string | null;
    sortOrder: number;
    required: boolean;
    severity: string | null;
  }>(
    client,
    `SELECT id, name, "taskType", "autoCheckKey", "sortOrder", required, severity
     FROM "periodCloseTaskDefinition" WHERE "companyId" = $1`,
    [companyId]
  );
  const byName = Object.fromEntries(definitions.map((d) => [d.name, d]));
  const completedAt = `${lockedPeriodEnd}T16:00:00Z`;
  for (const task of tasks) {
    const def = need(byName, task.definition, "period close task definition");
    ctx.log(`period close task ${def.name} — ${task.status}`);
    const done = task.status === "Done";
    await insertRow(ctx, "periodCloseTask", {
      accountingPeriodId: lockedPeriodId,
      definitionId: def.id,
      name: def.name,
      taskType: def.taskType,
      autoCheckKey: def.autoCheckKey,
      sortOrder: def.sortOrder,
      required: def.required,
      severity: def.severity,
      status: task.status,
      assigneeId: ctx.userId,
      completedAt: done ? completedAt : undefined,
      // NULL for system-auto completions (the table's own convention).
      completedBy: done && def.taskType !== "Auto" ? ctx.userId : undefined,
      skippedReason: task.skippedReason,
      notes: task.notes
    });
  }
  return seeded;
}

async function upsertBillingAddress(
  ctx: Ctx,
  table:
    | "companyAccountsReceivableBillingAddress"
    | "companyAccountsPayableBillingAddress",
  address: BillingAddressSpec
): Promise<void> {
  const values = [
    address.addressLine1,
    address.city,
    address.state,
    address.postalCode,
    address.countryCode,
    address.phone,
    address.email
  ];
  await ctx.client.query(
    `INSERT INTO "${table}"
       (id, "addressLine1", city, state, "postalCode", "countryCode", phone, email, "updatedBy")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       "addressLine1" = EXCLUDED."addressLine1", city = EXCLUDED.city,
       state = EXCLUDED.state, "postalCode" = EXCLUDED."postalCode",
       "countryCode" = EXCLUDED."countryCode", phone = EXCLUDED.phone,
       email = EXCLUDED.email, "updatedBy" = EXCLUDED."updatedBy"`,
    [ctx.companyId, ...values, ctx.userId]
  );
}

// Mirrors `projectStates` (`seed-data.ts`), the six company-wide states the
// company seed gives every company. A company whose states a wipe removed
// gets them back here.
const PROJECT_STATES: {
  name: ProjectStateName;
  group: "Backlog" | "Unstarted" | "Started" | "Completed" | "Cancelled";
  color: string;
  isDefault: boolean;
}[] = [
  { name: "Backlog", group: "Backlog", color: "#60646C", isDefault: true },
  { name: "Todo", group: "Unstarted", color: "#60646C", isDefault: true },
  { name: "In Progress", group: "Started", color: "#F59E0B", isDefault: true },
  { name: "In Review", group: "Started", color: "#3B82F6", isDefault: false },
  { name: "Done", group: "Completed", color: "#46A758", isDefault: true },
  { name: "Cancelled", group: "Cancelled", color: "#9AA4BC", isDefault: true }
];

/**
 * The company's project states by name (states are company-wide). Inserts
 * the six defaults the company lacks; a group that already has a default
 * keeps it.
 */
async function insertProjectStates(ctx: Ctx): Promise<Record<string, string>> {
  const existing = await rows<{
    id: string;
    name: string;
    group: string;
    isDefault: boolean;
  }>(
    ctx.client,
    `SELECT id, name, "group", "isDefault" FROM "projectState" WHERE "companyId" = $1`,
    [ctx.companyId]
  );
  const stateIds: Record<string, string> = Object.fromEntries(
    existing.map((state) => [state.name, state.id])
  );
  const defaults = new Set(
    existing.filter((state) => state.isDefault).map((state) => state.group)
  );
  for (const [index, state] of PROJECT_STATES.entries()) {
    if (stateIds[state.name]) continue;
    stateIds[state.name] = await insertId(ctx, "projectState", {
      name: state.name,
      group: state.group,
      color: state.color,
      sortOrder: index + 1,
      isDefault: state.isDefault && !defaults.has(state.group)
    });
    if (state.isDefault) defaults.add(state.group);
  }
  return stateIds;
}

/**
 * A Service project's work tree: the default states, the nodes in list order
 * (`<identifier>-<n>`, Todo, by sibling order) and, with `planLines`, each
 * node's labor, material and other-cost plan lines. Returns the node ids by
 * key.
 */
async function insertServiceTree(
  ctx: Ctx,
  args: {
    projectId: string;
    identifier: string;
    nodes: ServiceTemplateNodeSpec[];
    planLines: boolean;
  }
): Promise<Record<string, string>> {
  const { projectId, identifier, nodes } = args;
  const stateIds = await insertProjectStates(ctx);

  const nodeIds: Record<string, string> = {};
  const siblingCount: Record<string, number> = {};
  for (const [index, node] of nodes.entries()) {
    const siblings = node.parentKey ?? "";
    siblingCount[siblings] = (siblingCount[siblings] ?? 0) + 1;
    const nodeId = await insertId(ctx, "projectElement", {
      projectId,
      readableId: `${identifier}-${index + 1}`,
      sequence: index + 1,
      type: node.type,
      parentId: node.parentKey
        ? need(nodeIds, node.parentKey, "parent node")
        : null,
      name: node.name,
      stateId: need(stateIds, "Todo", "project state"),
      isChargeable: true,
      sortOrder: siblingCount[siblings]
    });
    nodeIds[node.key] = nodeId;
    if (!args.planLines) continue;

    for (const line of node.labor ?? []) {
      await insertRow(ctx, "projectElementLabor", {
        projectId,
        projectElementId: nodeId,
        laborCategoryId: need(
          ctx.refs.misc,
          `laborCategory:${line.laborCategory}`,
          "labor category"
        ),
        hours: line.hours
      });
    }
    for (const line of node.materials ?? []) {
      const item = need(ctx.refs.items, line.item, "item");
      await insertRow(ctx, "projectElementMaterial", {
        projectId,
        projectElementId: nodeId,
        itemId: item.id,
        methodType: "Pull from Inventory",
        quantity: line.quantity,
        unitOfMeasureCode: item.unitOfMeasureCode,
        unitCost: item.unitCost
      });
    }
    for (const line of node.costs ?? []) {
      await insertRow(ctx, "projectElementCost", {
        projectId,
        projectElementId: nodeId,
        description: line.description,
        amount: line.amount
      });
    }
  }
  return nodeIds;
}

/**
 * Field service work, after the labor categories: each service template
 * (a Draft Service project marked as a template, identifier `TPL-` and the
 * first 6 characters of its id, as `createServiceTemplate` names it), then
 * each service order with its Service project (identifier = the order's
 * readable id, as `createServiceOrder` makes it). A Scheduled order copies its
 * template's nodes and plan lines and gets one visit for the applying user. A
 * Refurbishment has no customer and puts its stock serial On Hold.
 */
async function seedServiceWork(ctx: Ctx): Promise<void> {
  const { anchor, userId } = ctx;
  const sales = ctx.dataset.sales;
  const plantId = ctx.refs.locations.Plant ?? ctx.locationId;

  // A contract's project: the parent of the Service projects of the orders
  // the contract covers (Field Service Phase D).
  const contractProjectIds: Record<string, string> = {};
  for (const spec of sales.contracts) {
    if (!spec.project) continue;
    ctx.log(`contract project ${spec.name}`);
    const projectId = await insertId(ctx, "project", {
      name: spec.name,
      identifier: spec.project.identifier,
      costTreatment: "Expense",
      status: "Released",
      customerId: need(ctx.refs.customers, spec.customer, "customer"),
      ownerId: userId,
      locationId: ctx.locationId,
      priority: "None",
      active: true,
      nextElementSequence: 1
    });
    await insertProjectStates(ctx);
    await ctx.client.query(
      `UPDATE "customerContract" SET "projectId" = $1
       WHERE id = $2 AND "companyId" = $3`,
      [
        projectId,
        need(ctx.refs.documents, `con:${spec.key}`, "contract"),
        ctx.companyId
      ]
    );
    contractProjectIds[spec.key] = projectId;
  }

  const templateIds: Record<string, string> = {};
  for (const spec of sales.serviceTemplates) {
    ctx.log(`service template ${spec.name}`);
    const projectId = await insertId(ctx, "project", {
      name: spec.name,
      projectType: "Service",
      isTemplate: true,
      status: "Draft",
      costTreatment: "By Coverage",
      priority: "None",
      active: true,
      locationId: plantId,
      nextElementSequence: spec.nodes.length + 1
    });
    const body = projectId.slice(projectId.indexOf("_") + 1);
    const identifier = `TPL-${body.slice(0, 6).toUpperCase()}`;
    await ctx.client.query(
      `UPDATE project SET identifier = $1 WHERE id = $2 AND "companyId" = $3`,
      [identifier, projectId, ctx.companyId]
    );
    await insertServiceTree(ctx, {
      projectId,
      identifier,
      nodes: spec.nodes,
      planLines: true
    });
    templateIds[spec.key] = projectId;
  }

  for (const spec of sales.serviceOrders) {
    const template = spec.template
      ? sales.serviceTemplates.find((t) => t.key === spec.template)
      : undefined;
    if (spec.template && !template) {
      throw new Error(
        `Seed: service order "${spec.key}" names unknown template "${spec.template}"`
      );
    }

    // The order's subject: a customer asset (Field Visit), or a serial in
    // stock with no customer (Refurbishment).
    let subject: {
      projectName: string;
      customerId: string | null;
      parentProjectId: string | null;
      columns: Record<string, unknown>;
    };
    if (spec.type === "Refurbishment") {
      const stock = ctx.dataset.inventory.onHandTracked.find((s) =>
        s.entities.some((e) => e.readableId === spec.serial)
      );
      if (!stock) {
        throw new Error(
          `Seed: service order "${spec.key}" names unknown serial "${spec.serial}"`
        );
      }
      subject = {
        projectName: `${spec.serial} — Refurbishment`,
        customerId: null,
        parentProjectId: null,
        columns: {
          type: "Refurbishment",
          trackedEntityId: need(ctx.refs.misc, `te:${spec.serial}`, "serial"),
          itemId: need(ctx.refs.items, stock.item, "item").id,
          customerAssetId: null,
          customerId: null,
          customerLocationId: null,
          expectedSellingPrice: spec.expectedSellingPrice ?? null
        }
      };
    } else {
      const asset = sales.customerAssets.find((a) => a.key === spec.asset);
      if (!asset) {
        throw new Error(
          `Seed: service order "${spec.key}" names unknown asset "${spec.asset}"`
        );
      }
      const customerId = need(ctx.refs.customers, asset.customer, "customer");
      subject = {
        projectName: `${asset.serial} — ${asset.customer}`,
        customerId,
        parentProjectId: spec.contract
          ? (contractProjectIds[spec.contract] ?? null)
          : null,
        columns: {
          type: "Field Visit",
          customerContractId: spec.contract
            ? need(ctx.refs.documents, `con:${spec.contract}`, "contract")
            : null,
          trackedEntityId: need(
            ctx.refs.misc,
            `asset-serial:${asset.key}`,
            "asset serial"
          ),
          itemId: need(ctx.refs.items, asset.item, "item").id,
          customerAssetId: need(ctx.refs.misc, `asset:${asset.key}`, "asset"),
          customerId,
          customerLocationId: need(
            ctx.refs.misc,
            `cloc:${asset.customer}`,
            "customer location"
          )
        }
      };
    }

    const serviceOrderId = await nextSequence(ctx, "serviceOrder");
    ctx.log(`service order ${serviceOrderId}`);
    const projectId = await insertId(ctx, "project", {
      name: subject.projectName,
      identifier: serviceOrderId,
      projectType: "Service",
      status: "Released",
      costTreatment: "By Coverage",
      customerId: subject.customerId,
      parentProjectId: subject.parentProjectId,
      locationId: plantId,
      priority: "None",
      active: true,
      nextElementSequence: (template?.nodes.length ?? 0) + 1
    });
    // Every Service project has the default states, nodes or not.
    await insertServiceTree(ctx, {
      projectId,
      identifier: serviceOrderId,
      nodes: template?.nodes ?? [],
      planLines: true
    });

    const orderId = await insertId(ctx, "serviceOrder", {
      serviceOrderId,
      ...subject.columns,
      status: spec.status,
      locationId: plantId,
      projectId,
      serviceTemplateId: template ? need(templateIds, template.key) : null,
      priority: spec.priority ?? "None",
      problem: RICH(spec.problem)
    });
    // A refurbishment holds its serial out of picking and shipping.
    if (spec.type === "Refurbishment") {
      await ctx.client.query(
        `UPDATE "trackedEntity" SET status = 'On Hold'
         WHERE id = $1 AND "companyId" = $2`,
        [subject.columns.trackedEntityId, ctx.companyId]
      );
    }
    ctx.refs.documents[`svc:${spec.key}`] = orderId;

    if (spec.visit) {
      await insertRow(ctx, "serviceVisit", {
        serviceOrderId: orderId,
        technicianId: userId,
        status: "Scheduled",
        plannedStart: resolveTimestamp(
          anchor,
          spec.visit.startOffset,
          spec.visit.startTime
        ),
        plannedEnd: resolveTimestamp(
          anchor,
          spec.visit.startOffset,
          spec.visit.endTime
        )
      });
    }
  }
}

/** A Requirement's target columns; `actualParameterId` resolves its key. */
function requirementColumns(
  requirement: ProjectElementSpec["requirement"],
  parameterId: (key: string) => string
) {
  if (!requirement) return {};
  return {
    requirementCategory: requirement.category,
    targetOperator: requirement.operator,
    targetValue: requirement.target,
    targetUpperValue: requirement.upperTarget ?? null,
    targetUnit: requirement.unit ?? null,
    verificationMethod: requirement.verificationMethod ?? null,
    actualParameterId: requirement.actualParameter
      ? parameterId(requirement.actualParameter)
      : null
  };
}

/**
 * Project stock (Projects Phase 2a), after the projects exist: sets
 * `project.projectStock`, then seeds each project's opening stock in its
 * stripe (an item ledger row and its cost layer) and its Posted Transfers of
 * common stock. A Transfer writes what `post-project-stock-transfer` writes:
 * the header and line (with the drawn unit cost), the item ledger pair at one
 * bin, the common relief row and the project's layer. Common opening stock has
 * no cost layers, so the drawn cost is the item's unit cost, as a seeded
 * shipment's is. No journal: both owners are inventory.
 */
async function seedProjectStock(ctx: Ctx): Promise<void> {
  const { companyId, userId, anchor } = ctx;
  const plantId = ctx.refs.locations.Plant ?? ctx.locationId;

  for (const spec of ctx.dataset.accounting.projects) {
    if (!spec.projectStock) continue;
    ctx.log(`project stock ${spec.name}`);
    const projectId = need(ctx.refs.misc, `project:${spec.key}`, "project");
    await ctx.client.query(
      `UPDATE project SET "projectStock" = true, "updatedBy" = $1
       WHERE id = $2 AND "companyId" = $3`,
      [userId, projectId, companyId]
    );

    for (const entry of spec.projectStock.openingStock) {
      const itemRef = need(ctx.refs.items, entry.item);
      const postingDate = resolveDate(anchor, entry.dateOffset);
      const itemLedgerId = await insertId(ctx, "itemLedger", {
        entryType: "Positive Adjmt.",
        documentType: "Inventory Receipt",
        postingDate,
        itemId: itemRef.id,
        locationId: plantId,
        storageUnitId: need(ctx.refs.shelves, entry.shelf),
        quantity: entry.qty,
        projectId,
        comment: "Opening balance"
      });
      await insertRow(ctx, "costLedger", {
        itemLedgerType: "Positive Adjmt.",
        costLedgerType: "Direct Cost",
        adjustment: false,
        documentType: "Inventory Receipt",
        documentId: itemLedgerId,
        itemId: itemRef.id,
        quantity: round(entry.qty),
        cost: round(entry.qty * entry.unitCost),
        remainingQuantity: round(entry.qty),
        projectId,
        postingDate
      });
    }

    for (const transfer of spec.projectStock.transfers) {
      const itemRef = need(ctx.refs.items, transfer.item);
      const storageUnitId = need(ctx.refs.shelves, transfer.shelf);
      const postingDate = resolveDate(anchor, transfer.dateOffset);
      const postedAt = resolveTimestamp(
        anchor,
        transfer.dateOffset,
        "15:00:00"
      );
      const cost = await one<{ unitCost: number | null }>(
        ctx.client,
        `SELECT "unitCost" FROM "itemCost" WHERE "itemId" = $1 AND "companyId" = $2`,
        [itemRef.id, companyId]
      );
      const unitCost = Number(cost.unitCost ?? 0);
      const transferId = await insertId(ctx, "projectStockTransfer", {
        projectStockTransferId: await nextSequence(ctx, "projectStockTransfer"),
        type: "Transfer",
        status: "Posted",
        fromProjectId: null,
        toProjectId: projectId,
        locationId: plantId,
        reason: transfer.reason,
        approvedBy: userId,
        approvedAt: resolveTimestamp(anchor, transfer.dateOffset, "09:00:00"),
        postedAt
      });
      await insertRow(ctx, "projectStockTransferLine", {
        projectStockTransferId: transferId,
        itemId: itemRef.id,
        quantity: transfer.qty,
        storageUnitId,
        unitCost
      });
      const ledgerBase = {
        entryType: "Transfer",
        documentType: "Project Transfer",
        documentId: transferId,
        postingDate,
        itemId: itemRef.id,
        locationId: plantId,
        storageUnitId
      };
      await insertRow(ctx, "itemLedger", {
        ...ledgerBase,
        quantity: -transfer.qty,
        projectId: null
      });
      await insertRow(ctx, "itemLedger", {
        ...ledgerBase,
        quantity: transfer.qty,
        projectId
      });
      const layerBase = {
        itemLedgerType: "Transfer",
        costLedgerType: "Direct Cost",
        adjustment: false,
        documentType: "Project Transfer",
        documentId: transferId,
        itemId: itemRef.id,
        postingDate
      };
      await insertRow(ctx, "costLedger", {
        ...layerBase,
        quantity: round(-transfer.qty),
        cost: round(-transfer.qty * unitCost),
        remainingQuantity: 0,
        projectId: null
      });
      await insertRow(ctx, "costLedger", {
        ...layerBase,
        quantity: round(transfer.qty),
        cost: round(transfer.qty * unitCost),
        remainingQuantity: round(transfer.qty),
        projectId
      });
    }
  }
}

/**
 * Planning groups (Projects Phase 3), after `postInventoryDocuments` wrote the
 * receipt cost layers. Each group is at the plant. Its members get project
 * stock, the plant, the group and their priority, as the project Details
 * action requires. Then the group's 2 PO lines get `planningGroupId`:
 * - the received line: its one receipt item ledger row and its one cost layer
 *   split into a stripe per peg, as `post-receipt` splits a grouped receipt
 *   (the journal stays one inventory debit per line). Each stripe gets a Hard
 *   peg linked to its ledger row, which supersedes the Soft peg made at the
 *   order date, as `harden_pegs_for_supply` does;
 * - the open line: one Soft peg per peg.
 * A seeded peg has no run id. The first MRP run keeps the Hard pegs and
 * re-pegs the open supply.
 */
/**
 * Government contracting Phase 5b: the pools, their account mappings and a
 * Provisional and a Target rate per period of the current fiscal year (B12:
 * a rate from period 1 is one row per period, period rate = YTD rate).
 */
async function seedIndirectPools(
  ctx: Ctx,
  accountIdByNumber: Record<string, string>
): Promise<void> {
  const pools = ctx.dataset.accounting.indirectPools;
  if (pools.length === 0) return;
  const fiscal = await maybeOne<{ startMonth: string | null }>(
    ctx.client,
    `SELECT "startMonth" FROM "fiscalYearSettings" WHERE "companyId" = $1`,
    [ctx.companyId]
  );
  const startMonth = fiscal?.startMonth
    ? (MONTH_NUMBER[fiscal.startMonth] ?? 1)
    : 1;
  // The fiscal year is named by its ending calendar year, as in
  // seedAccountingPeriods.
  const fiscalYear =
    startMonth === 1 || ctx.anchor.month < startMonth
      ? ctx.anchor.year
      : ctx.anchor.year + 1;

  for (const spec of pools) {
    ctx.log(`indirect pool ${spec.name}`);
    const poolId = await insertId(ctx, "indirectPool", {
      name: spec.name,
      poolType: spec.poolType,
      sequence: spec.sequence,
      baseType: spec.baseType,
      appliedAccountId: spec.appliedAccount
        ? need(accountIdByNumber, spec.appliedAccount, "GL account")
        : undefined
    });
    for (const mapping of spec.accounts) {
      await insertRow(ctx, "indirectPoolAccount", {
        indirectPoolId: poolId,
        accountId: need(accountIdByNumber, mapping.account, "GL account"),
        role: mapping.role
      });
    }
    // Rates are fractions in the dataset and in the column alike.
    for (const rateType of ["Provisional", "Target"] as const) {
      for (let periodNumber = 1; periodNumber <= 12; periodNumber++) {
        await insertRow(ctx, "indirectRate", {
          indirectPoolId: poolId,
          fiscalYear,
          periodNumber,
          rateType,
          periodRate: spec.rate,
          ytdRate: spec.rate
        });
      }
    }
  }
}

async function seedPlanningGroups(ctx: Ctx): Promise<void> {
  const { companyId, userId, anchor } = ctx;
  const plantId = ctx.refs.locations.Plant ?? ctx.locationId;
  const { purchaseOrders } = ctx.dataset.purchasing;
  const projectSpecs = ctx.dataset.accounting.projects;

  for (const spec of ctx.dataset.accounting.planningGroups ?? []) {
    ctx.log(`planning group ${spec.name}`);
    const item = need(ctx.refs.items, spec.item, "item");
    const groupId = await insertId(ctx, "planningGroup", {
      name: spec.name,
      locationId: plantId,
      priorityRule: spec.priorityRule
    });
    const projectId = (key: string) =>
      need(ctx.refs.misc, `project:${key}`, "project");
    const directOrder = (ref: string) => {
      const po = purchaseOrders.find(
        (p) => p.source === "direct" && p.ref === ref
      );
      if (!po || po.source !== "direct") {
        throw new Error(`Seed: planning group "${spec.name}": no order ${ref}`);
      }
      return po;
    };
    const lineId = (ref: string) =>
      need(
        ctx.refs.documents,
        `poline:${ref}:${spec.item}`,
        "purchase order line"
      );
    // The demand of a peg: the element's plan-line material of the item.
    const demand = (peg: { project: string; element: string }) => {
      const material = projectSpecs
        .find((p) => p.key === peg.project)
        ?.elements.find((e) => e.key === peg.element)
        ?.materials?.find((m) => m.item === spec.item);
      if (!material) {
        throw new Error(
          `Seed: planning group "${spec.name}": ${peg.project}:${peg.element} has no ${spec.item} material`
        );
      }
      return {
        planningGroupId: groupId,
        itemId: item.id,
        locationId: plantId,
        supplyType: "Purchase Order Line",
        projectId: projectId(peg.project),
        projectElementId: need(
          ctx.refs.misc,
          `projectElement:${peg.project}:${peg.element}`,
          "project element"
        ),
        demandSourceType: "Project Material",
        demandSourceId: need(
          ctx.refs.misc,
          `projectElementMaterial:${peg.project}:${peg.element}:${spec.item}`,
          "plan-line material"
        ),
        needDate: resolveDate(anchor, material.requiredOffset)
      };
    };

    for (const member of spec.members) {
      await ctx.client.query(
        `UPDATE project SET "projectStock" = true, "planningGroupId" = $1,
           "planningPriority" = $2, "locationId" = $3, "updatedBy" = $4
         WHERE id = $5 AND "companyId" = $6`,
        [
          groupId,
          member.priority,
          plantId,
          userId,
          projectId(member.project),
          companyId
        ]
      );
    }
    const receivedLineId = lineId(spec.received.purchaseOrder);
    const openLineId = lineId(spec.open.purchaseOrder);
    await ctx.client.query(
      `UPDATE "purchaseOrderLine" SET "planningGroupId" = $1, "updatedBy" = $2
       WHERE id = ANY($3) AND "companyId" = $4`,
      [groupId, userId, [receivedLineId, openLineId], companyId]
    );

    // The received line: split the receipt into member stripes.
    const receivedOrder = directOrder(spec.received.purchaseOrder);
    const receipt = receivedOrder.receipt;
    if (receipt?.status !== "Posted" || receipt.postedOffset === undefined) {
      throw new Error(
        `Seed: planning group "${spec.name}": ${spec.received.purchaseOrder} has no Posted receipt`
      );
    }
    const receiptId = need(ctx.refs.documents, receipt.ref, "receipt");
    const ledgerRows = await rows<{
      id: string;
      quantity: string;
      entryType: string;
      locationId: string;
      storageUnitId: string | null;
      postingDate: string;
    }>(
      ctx.client,
      `SELECT id, quantity, "entryType", "locationId", "storageUnitId",
              "postingDate"::text AS "postingDate"
       FROM "itemLedger"
       WHERE "documentType" = 'Purchase Receipt' AND "documentId" = $1
         AND "itemId" = $2 AND "companyId" = $3`,
      [receiptId, item.id, companyId]
    );
    const layers = await rows<{
      id: string;
      quantity: string;
      cost: string;
      remainingQuantity: string;
      externalDocumentId: string | null;
      supplierId: string | null;
      postingDate: string;
    }>(
      ctx.client,
      `SELECT id, quantity, cost, "remainingQuantity", "externalDocumentId",
              "supplierId", "postingDate"::text AS "postingDate"
       FROM "costLedger"
       WHERE "documentType" = 'Purchase Receipt' AND "documentId" = $1
         AND "itemId" = $2 AND "companyId" = $3`,
      [receiptId, item.id, companyId]
    );
    const ledger = ledgerRows[0];
    const layer = layers[0];
    const pegs = spec.received.pegs;
    const total = pegs.reduce((sum, peg) => sum + peg.quantity, 0);
    if (
      ledgerRows.length !== 1 ||
      layers.length !== 1 ||
      !ledger ||
      !layer ||
      Number(ledger.quantity) !== total ||
      Number(layer.remainingQuantity) !== Number(layer.quantity)
    ) {
      throw new Error(
        `Seed: planning group "${spec.name}": receipt ${receipt.ref} needs one untouched ledger row and layer of ${total} ${spec.item}`
      );
    }
    const layerCost = Number(layer.cost);
    const unitCost = layerCost / Number(layer.quantity);
    const orderedAt = resolveTimestamp(
      anchor,
      receivedOrder.orderDateOffset,
      "09:00:00"
    );
    const hardenedAt = resolveTimestamp(
      anchor,
      receipt.postedOffset,
      "15:00:00"
    );

    let costSoFar = 0;
    for (const [index, peg] of pegs.entries()) {
      const stripeProjectId = projectId(peg.project);
      const last = index === pegs.length - 1;
      // The last stripe takes the rounding rest, so the pieces add up.
      const cost = last
        ? round(layerCost - costSoFar)
        : round(peg.quantity * unitCost);
      costSoFar += cost;
      let itemLedgerId: string;
      if (index === 0) {
        itemLedgerId = ledger.id;
        await ctx.client.query(
          `UPDATE "itemLedger" SET quantity = $1, "projectId" = $2
           WHERE id = $3 AND "companyId" = $4`,
          [peg.quantity, stripeProjectId, ledger.id, companyId]
        );
        await ctx.client.query(
          `UPDATE "costLedger" SET quantity = $1, "remainingQuantity" = $1,
             cost = $2, "nominalCost" = $2, "projectId" = $3
           WHERE id = $4 AND "companyId" = $5`,
          [round(peg.quantity), cost, stripeProjectId, layer.id, companyId]
        );
      } else {
        itemLedgerId = await insertId(ctx, "itemLedger", {
          entryType: ledger.entryType,
          documentType: "Purchase Receipt",
          documentId: receiptId,
          itemId: item.id,
          locationId: ledger.locationId,
          storageUnitId: ledger.storageUnitId,
          quantity: peg.quantity,
          projectId: stripeProjectId,
          postingDate: ledger.postingDate
        });
        await insertRow(ctx, "costLedger", {
          itemLedgerType: "Purchase",
          costLedgerType: "Direct Cost",
          adjustment: false,
          documentType: "Purchase Receipt",
          documentId: receiptId,
          externalDocumentId: layer.externalDocumentId ?? undefined,
          itemId: item.id,
          quantity: round(peg.quantity),
          nominalCost: cost,
          cost,
          remainingQuantity: round(peg.quantity),
          supplierId: layer.supplierId ?? undefined,
          projectId: stripeProjectId,
          postingDate: layer.postingDate
        });
      }
      await insertRow(ctx, "projectPeg", {
        ...demand(peg),
        supplyId: receivedLineId,
        quantity: peg.quantity,
        state: "Soft",
        createdAt: orderedAt,
        supersededAt: hardenedAt
      });
      await insertRow(ctx, "projectPeg", {
        ...demand(peg),
        supplyId: receivedLineId,
        quantity: peg.quantity,
        state: "Hard",
        hardenedAt,
        itemLedgerId,
        createdAt: hardenedAt
      });
    }

    // The open line: Soft pegs from its order date.
    const openOrderedAt = resolveTimestamp(
      anchor,
      directOrder(spec.open.purchaseOrder).orderDateOffset,
      "09:00:00"
    );
    for (const peg of spec.open.pegs) {
      await insertRow(ctx, "projectPeg", {
        ...demand(peg),
        supplyId: openLineId,
        quantity: peg.quantity,
        state: "Soft",
        createdAt: openOrderedAt
      });
    }
  }
}

/**
 * Labor categories and their rates, then each project with its states,
 * milestones and elements, then the applying user's timesheet. An element's
 * `readableId` is `<identifier>-<n>` in list order, as `insertProjectElement`
 * numbers them, and the project's `nextElementSequence` continues after it.
 */
/**
 * Baseline 1 of a project, as `insertProjectBaseline` writes it: the plan
 * layer of the 5 plan tables through the shared `toPlanSnapshot`, with the
 * element dates (format version 2). Rows are read as JSON so dates and
 * numbers reach the snapshot as the app's reads give them.
 */
async function seedProjectBaseline(
  ctx: Ctx,
  projectId: string,
  baseline: { name: string; dateOffset: DayOffset }
): Promise<void> {
  const read = (table: string) =>
    rows<{ row: Record<string, unknown> }>(
      ctx.client,
      `SELECT to_jsonb(t) AS row FROM "${table}" t
       WHERE t."projectId" = $1 AND t."companyId" = $2`,
      [projectId, ctx.companyId]
    ).then((result) => result.map((r) => r.row));
  // One client: the reads run one after another.
  const elements = await read("projectElement");
  const links = await read("projectElementLink");
  const materials = await read("projectElementMaterial");
  const labor = await read("projectElementLabor");
  const costs = await read("projectElementCost");
  const snapshot = toPlanSnapshot({ elements, links, materials, labor, costs });
  await insertRow(ctx, "projectBaseline", {
    projectId,
    sequence: 1,
    name: baseline.name,
    source: "Manual",
    formatVersion: PROJECT_BASELINE_FORMAT_VERSION,
    snapshot: JSON.stringify(snapshot),
    elementCount: snapshot.elements.length,
    linkCount: snapshot.links.length,
    createdAt: resolveTimestamp(ctx.anchor, baseline.dateOffset, "09:00:00")
  });
  await ctx.client.query(
    `UPDATE "project" SET "nextBaselineSequence" = 2
     WHERE id = $1 AND "companyId" = $2`,
    [projectId, ctx.companyId]
  );
}

async function seedProjects(ctx: Ctx): Promise<void> {
  const { companyId, userId, anchor } = ctx;
  const data = ctx.dataset.accounting;

  const laborCategoryIds: Record<string, string> = {};
  for (const category of data.laborCategories) {
    const id = await insertId(ctx, "laborCategory", {
      name: category.name,
      description: category.description,
      active: true
    });
    laborCategoryIds[category.name] = id;
    ctx.refs.misc[`laborCategory:${category.name}`] = id;
    await insertRow(ctx, "laborCategoryRate", {
      laborCategoryId: id,
      effectiveFrom: resolveDate(anchor, LABOR_RATE_EFFECTIVE_OFFSET),
      costRate: category.costRate
    });
  }
  const userCategory = data.laborCategories[0];
  if (userCategory) {
    await ctx.client.query(
      `UPDATE "employeeJob" SET "laborCategoryId" = $1
       WHERE id = $2 AND "companyId" = $3`,
      [laborCategoryIds[userCategory.name], userId, companyId]
    );
  }

  const cipClasses = await rows<{ id: string; name: string }>(
    ctx.client,
    `SELECT id, name FROM "fixedAssetClass"
     WHERE "companyId" = $1 AND "isConstructionInProgress" = true`,
    [companyId]
  );

  const elementIds: Record<string, string> = {};
  for (const spec of data.projects) {
    ctx.log(`project ${spec.name}`);
    const fixedAssetClassId = spec.fixedAssetClass
      ? cipClasses.find((c) => c.name === spec.fixedAssetClass)?.id
      : null;
    if (spec.fixedAssetClass && !fixedAssetClassId) {
      throw new Error(
        `Seed: project "${spec.key}" names CIP class "${spec.fixedAssetClass}", which does not exist`
      );
    }
    const projectId = await insertId(ctx, "project", {
      name: spec.name,
      description: spec.description,
      identifier: spec.identifier,
      costTreatment: spec.costTreatment,
      fixedAssetClassId: fixedAssetClassId ?? null,
      status: spec.status,
      ownerId: userId,
      locationId: ctx.locationId,
      nextElementSequence: spec.elements.length + 1,
      costObjective: spec.costObjective ?? null,
      budgetControl: spec.budgetControl ?? "None",
      budgetTolerancePercent:
        spec.budgetTolerancePercent === undefined
          ? null
          : round(spec.budgetTolerancePercent / 100)
    });
    ctx.refs.misc[`project:${spec.key}`] = projectId;

    const stateIds = await insertProjectStates(ctx);

    const milestoneIds: Record<string, string> = {};
    for (const [index, milestone] of spec.milestones.entries()) {
      milestoneIds[milestone.key] = await insertId(ctx, "projectMilestone", {
        projectId,
        name: milestone.name,
        startDate: resolveDate(anchor, milestone.startOffset),
        endDate: resolveDate(anchor, milestone.endOffset),
        completedAt:
          milestone.endOffset < 0
            ? resolveTimestamp(anchor, milestone.endOffset, "17:00:00")
            : null,
        sortOrder: index + 1
      });
    }

    // A formula names Parameters by `{key}`; the row stores readable ids.
    const readableIds = new Map(
      spec.elements.map((element, index) => [
        element.key,
        `${spec.identifier}-${index + 1}`
      ])
    );
    const formulaText = (formula: string) =>
      formula.replace(/\{([^}]+)\}/g, (_, key: string) =>
        need(Object.fromEntries(readableIds), key, "formula parameter")
      );
    const percent = (value: number | undefined) =>
      value === undefined ? null : round(value / 100);

    const siblingCount: Record<string, number> = {};
    for (const [index, element] of spec.elements.entries()) {
      const parentId = element.parentKey
        ? need(elementIds, `${spec.key}:${element.parentKey}`, "parent element")
        : null;
      const siblings = element.parentKey ?? "";
      siblingCount[siblings] = (siblingCount[siblings] ?? 0) + 1;
      const completed =
        element.state === "Done" || element.state === "Cancelled";
      elementIds[`${spec.key}:${element.key}`] = await insertId(
        ctx,
        "projectElement",
        {
          projectId,
          readableId: `${spec.identifier}-${index + 1}`,
          sequence: index + 1,
          type: element.type,
          parentId,
          name: element.name,
          stateId: need(stateIds, element.state, "project state"),
          milestoneId: element.milestone
            ? need(milestoneIds, element.milestone, "milestone")
            : null,
          completedAt: completed
            ? resolveTimestamp(anchor, -1, "16:00:00")
            : null,
          estimatedHours: element.estimatedHours ?? null,
          startDate:
            element.startOffset === undefined
              ? null
              : resolveDate(anchor, element.startOffset),
          targetDate:
            element.targetOffset === undefined
              ? null
              : resolveDate(anchor, element.targetOffset),
          // A Parameter takes no charges.
          isChargeable: element.type !== "Parameter",
          budget: element.budget ?? null,
          sortOrder: siblingCount[siblings],
          itemId: element.item
            ? need(ctx.refs.items, element.item, "item").id
            : null,
          isFinalAsset: element.isFinalAsset ?? false,
          isControlAccount: element.isControlAccount ?? false,
          earnedValueTechnique: element.earnedValueTechnique ?? null,
          earnedValuePercent: percent(element.earnedValuePercent),
          ...requirementColumns(element.requirement, (key) =>
            need(elementIds, `${spec.key}:${key}`, "actual parameter")
          ),
          ...(element.verdict
            ? {
                verdict: element.verdict,
                verdictAt:
                  element.verdict === "Not Run"
                    ? null
                    : resolveTimestamp(anchor, -1, "15:00:00"),
                verdictBy: element.verdict === "Not Run" ? null : userId
              }
            : {}),
          ...(element.parameter
            ? {
                parameterSource: element.parameter.source,
                parameterValue: element.parameter.value ?? null,
                parameterUnit: element.parameter.unit ?? null,
                parameterFormula: element.parameter.formula
                  ? formulaText(element.parameter.formula)
                  : null,
                allocationPercent: percent(element.parameter.allocationPercent),
                parameterContingencyPercent: percent(
                  element.parameter.contingencyPercent
                )
              }
            : {})
        }
      );
      const insertedId = elementIds[`${spec.key}:${element.key}`]!;
      ctx.refs.misc[`projectElement:${spec.key}:${element.key}`] = insertedId;
      // Plan-line materials: what MRP reads as Project Material demand.
      for (const material of element.materials ?? []) {
        const item = need(ctx.refs.items, material.item, "item");
        ctx.refs.misc[
          `projectElementMaterial:${spec.key}:${element.key}:${material.item}`
        ] = await insertId(ctx, "projectElementMaterial", {
          projectId,
          projectElementId: insertedId,
          itemId: item.id,
          methodType: "Pull from Inventory",
          quantity: material.quantity,
          unitOfMeasureCode: item.unitOfMeasureCode,
          unitCost: item.unitCost,
          requiredDate: resolveDate(anchor, material.requiredOffset)
        });
      }
    }

    // Trace links, then the `feeds` link from each Parameter a formula names
    // to the formula's Parameter, as the formula save writes them.
    const elementId = (key: string) =>
      need(elementIds, `${spec.key}:${key}`, "linked element");
    const links = [
      ...(spec.links ?? []).map((link) => ({
        from: link.from,
        to: link.to,
        type: link.type as string
      })),
      ...spec.elements.flatMap((element) =>
        [...(element.parameter?.formula ?? "").matchAll(/\{([^}]+)\}/g)].map(
          (match) => ({ from: match[1]!, to: element.key, type: "feeds" })
        )
      )
    ];
    for (const link of links) {
      await insertRow(ctx, "projectElementLink", {
        projectId,
        fromElementId: elementId(link.from),
        toElementId: elementId(link.to),
        linkType: link.type
      });
    }

    if (spec.baseline) await seedProjectBaseline(ctx, projectId, spec.baseline);
  }

  for (const entry of data.timesheetEntries) {
    const submitted = entry.status === "Submitted";
    await insertRow(ctx, "timesheetEntry", {
      employeeId: userId,
      entryDate: resolveTimesheetDay(anchor, entry.week, entry.weekday),
      projectId: need(ctx.refs.misc, `project:${entry.project}`, "project"),
      projectElementId: need(
        elementIds,
        `${entry.project}:${entry.element}`,
        "project element"
      ),
      laborCategoryId: need(
        laborCategoryIds,
        entry.laborCategory,
        "labor category"
      ),
      hours: entry.hours,
      note: entry.note ?? null,
      status: entry.status,
      submittedAt: submitted ? resolveTimestamp(anchor, -2, "17:00:00") : null
    });
  }
}
