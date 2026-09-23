import { round } from "../../../supabase/functions/shared/precision.ts";
import {
  CLOSED_PERIOD_MONTHS_BACK,
  LOCKED_PERIOD_MONTHS_BACK,
  monthBack,
  previousMonthEnd,
  resolveDate,
  resolveTimestamp,
  SEEDED_PERIOD_MONTHS
} from "../dates.ts";
import {
  insertId,
  insertMaybe,
  insertRow,
  maybeOne,
  need,
  nextSequence,
  one,
  rows
} from "../sql.ts";
import type {
  AccountClass,
  Ctx,
  JournalEntrySpec,
  JournalLineSpec
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

  const defaults = await one<{
    bankCashAccount: string | null;
    salesDiscountAccount: string | null;
    supplierPaymentDiscountAccount: string | null;
  }>(
    client,
    `SELECT "bankCashAccount", "salesDiscountAccount", "supplierPaymentDiscountAccount"
     FROM "accountDefault" WHERE "companyId" = $1`,
    [companyId]
  );

  // ── Accounting periods: trailing months, oldest Closed → Locked → Open ────
  // Before the journals, so the journal_check_period_open trigger vets every
  // seeded posting date against the seeded close state.
  await seedAccountingPeriods(ctx);

  // ── Projects (+ project coding on one purchase invoice line) ──────────────
  for (const spec of data.projects) {
    ctx.log(`project ${spec.name}`);
    const projectId = await insertId(ctx, "project", {
      name: spec.name,
      description: spec.description
    });
    ctx.refs.misc[`project:${spec.key}`] = projectId;
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

  // ── Dimensions: the bootstrap Project dimension + one Custom dimension ────
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

  // ── Journal entries ────────────────────────────────────────────────────────
  // accountingPeriodId stays NULL on purpose: journal survives the dataset
  // wipe while accountingPeriod does not, and the wipe would have to UPDATE a
  // Posted journal to null the FK — which journal_posted_immutable forbids.
  // journal_check_period_open resolves a NULL period from postingDate.
  for (const entry of data.journalEntries) {
    const journalId = await seedJournal(ctx, entry, resolveAccount);
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

  // ── Memos (Posted, accounting-disabled shape: journalId null) ─────────────
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
    const memoDate = resolveDate(ctx.anchor, spec.dateOffset);
    const memoId = await insertId(ctx, "memo", {
      memoId: await nextSequence(ctx, isCredit ? "creditMemo" : "debitMemo"),
      direction: spec.direction,
      customerId: isCredit
        ? need(ctx.refs.customers, spec.customer ?? "", "customer")
        : undefined,
      supplierId: isCredit
        ? undefined
        : need(ctx.refs.suppliers, spec.supplier ?? "", "supplier"),
      currencyCode: invoice.currencyCode,
      exchangeRate: 1,
      amount: spec.amount,
      memoDate,
      postingDate: memoDate,
      status: "Posted",
      postedAt: resolveTimestamp(ctx.anchor, spec.dateOffset, "16:00:00"),
      postedBy: ctx.userId,
      // The reason account post-memo stamps for a memo with no return order.
      reasonAccount:
        (isCredit
          ? defaults.salesDiscountAccount
          : defaults.supplierPaymentDiscountAccount) ?? undefined,
      reference: invoice.invoiceId,
      notes: spec.notes
    });
    ctx.refs.documents[`memo:${spec.key}`] = memoId;
  }

  // ── Payments + settlements (post-payment, accounting disabled) ────────────
  if (data.payments.length > 0 && !defaults.bankCashAccount) {
    throw new Error("Seed: accountDefault.bankCashAccount is not set");
  }
  for (const spec of data.payments) {
    const isReceipt = spec.type === "Receipt";
    const paymentDate = resolveDate(ctx.anchor, spec.dateOffset);
    ctx.log(`payment ${spec.key} — ${spec.type} Posted`);
    const paymentId = await insertId(ctx, "payment", {
      paymentId: await nextSequence(ctx, "payment"),
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
      postingDate: paymentDate,
      totalAmount: spec.amount,
      reference: spec.reference,
      status: "Posted",
      postedAt: resolveTimestamp(ctx.anchor, spec.dateOffset, "15:00:00"),
      postedBy: ctx.userId
    });
    ctx.refs.documents[`payment:${spec.key}`] = paymentId;

    const target = (invoiceKey: string) => {
      const id = need(
        ctx.refs.misc,
        `${isReceipt ? "sinv" : "pinv"}:${invoiceKey}`,
        "invoice"
      );
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
  }

  // ── Exchange-rate overrides ──────────────────────────────────────────────────
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
        amount: line.amount
      });
    }
    ctx.refs.documents["depreciationRun:draft"] = run;
  }
}

/** Inserts (or adopts — journal survives the wipe) one entry plus any reversal. */
async function seedJournal(
  ctx: Ctx,
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

  // journal is preserved across wipes — skip if already seeded
  const existing = await findJournal(entry.journalEntryId);
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
    sourceType: "Manual",
    postedAt: resolveTimestamp(ctx.anchor, offset, "17:00:00"),
    postedBy: ctx.userId
  });
  const je = await insertId(ctx, "journal", {
    journalEntryId: entry.journalEntryId,
    description: entry.description,
    status: posted ? "Posted" : entry.status,
    postingDate: resolveDate(ctx.anchor, entry.postingOffset),
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
    const reversal = await insertId(ctx, "journal", {
      journalEntryId: spec.journalEntryId,
      description: `Reversal of ${entry.journalEntryId}`,
      status: "Posted",
      postingDate: resolveDate(ctx.anchor, spec.postingOffset),
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

/** Oldest months Closed (close is sequential), then one Locked, the rest Open. */
async function seedAccountingPeriods(ctx: Ctx): Promise<void> {
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
    const periodId = await insertId(
      ctx,
      "accountingPeriod",
      {
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
      },
      {
        onConflict: `("companyId", "fiscalYear", "periodNumber") DO UPDATE SET
          "startDate" = EXCLUDED."startDate", "endDate" = EXCLUDED."endDate",
          status = EXCLUDED.status, "closeStatus" = EXCLUDED."closeStatus",
          "lockedAt" = EXCLUDED."lockedAt", "lockedBy" = EXCLUDED."lockedBy",
          "closedAt" = EXCLUDED."closedAt", "closedBy" = EXCLUDED."closedBy"`
      }
    );
    if (isLocked) {
      lockedPeriodId = periodId;
      lockedPeriodEnd = end.toString();
    }
  }

  // ── Close checklist on the Locked period ──────────────────────────────────
  // Snapshot the bootstrap definitions the way getPeriodCloseChecklist
  // instantiates them; the rest of the checklist materializes on first view.
  const tasks = ctx.dataset.accounting.closeTasks;
  if (tasks.length === 0) return;
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
}
