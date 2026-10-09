// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "../../precision.ts";
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

// Mirrors `defaultProjectStates` (ERP `projects.models.ts`), the six states
// `createProject` gives every new project. The backfill migration seeds the same.
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
  const stateIds: Record<string, string> = {};
  for (const [index, state] of PROJECT_STATES.entries()) {
    stateIds[state.name] = await insertId(ctx, "projectState", {
      projectId,
      name: state.name,
      group: state.group,
      color: state.color,
      sortOrder: index + 1,
      isDefault: state.isDefault
    });
  }

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
 * template's nodes and plan lines and gets one visit for the applying user.
 */
async function seedServiceWork(ctx: Ctx): Promise<void> {
  const { anchor, userId } = ctx;
  const sales = ctx.dataset.sales;
  const plantId = ctx.refs.locations.Plant ?? ctx.locationId;

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
    const asset = sales.customerAssets.find((a) => a.key === spec.asset);
    if (!asset) {
      throw new Error(
        `Seed: service order "${spec.key}" names unknown asset "${spec.asset}"`
      );
    }
    const template = spec.template
      ? sales.serviceTemplates.find((t) => t.key === spec.template)
      : undefined;
    if (spec.template && !template) {
      throw new Error(
        `Seed: service order "${spec.key}" names unknown template "${spec.template}"`
      );
    }
    const serviceOrderId = await nextSequence(ctx, "serviceOrder");
    ctx.log(`service order ${serviceOrderId}`);
    const customerId = need(ctx.refs.customers, asset.customer, "customer");
    const projectId = await insertId(ctx, "project", {
      name: `${asset.serial} — ${asset.customer}`,
      identifier: serviceOrderId,
      projectType: "Service",
      status: "Released",
      costTreatment: "By Coverage",
      customerId,
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
      type: "Field Visit",
      status: spec.status,
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
      ),
      locationId: plantId,
      projectId,
      serviceTemplateId: template ? need(templateIds, template.key) : null,
      priority: spec.priority ?? "None",
      problem: RICH(spec.problem)
    });
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
 * Labor categories and their rates, then each project with its states,
 * milestones and elements, then the applying user's timesheet. An element's
 * `readableId` is `<identifier>-<n>` in list order, as `insertProjectElement`
 * numbers them, and the project's `nextElementSequence` continues after it.
 */
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
      nextElementSequence: spec.elements.length + 1
    });
    ctx.refs.misc[`project:${spec.key}`] = projectId;

    const stateIds: Record<string, string> = {};
    for (const [index, state] of PROJECT_STATES.entries()) {
      stateIds[state.name] = await insertId(ctx, "projectState", {
        projectId,
        name: state.name,
        group: state.group,
        color: state.color,
        sortOrder: index + 1,
        isDefault: state.isDefault
      });
    }

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
          // A Parameter takes no charges.
          isChargeable: element.type !== "Parameter",
          budget: element.budget ?? null,
          sortOrder: siblingCount[siblings],
          itemId: element.item
            ? need(ctx.refs.items, element.item, "item").id
            : null,
          isFinalAsset: element.isFinalAsset ?? false,
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
