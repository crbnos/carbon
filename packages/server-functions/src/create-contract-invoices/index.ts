// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Contract invoice generation — shared by the contract page's "Invoice"
// and the daily recurring-billing job, so a person and the scheduler draft
// exactly the same invoices. Per Active contract, in one transaction: renew a
// contract whose term ran out, roll an open-ended schedule forward to the
// horizon, draft every Planned invoice that is due, and end a contract that
// has run its course. Posting stays with post-sales-invoice (and invoice
// automation): this only drafts.
// Spec: .ai/specs/2026-10-02-contracts.md; plan:
// .ai/plans/2026-10-03-contracts-phase-a.md Task 12.

import type { Database } from "@carbon/database";
import { toBaseAmount } from "@carbon/database/accounting-currency";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  horizon,
  invoiceLinePricing,
  lastRecurringPeriodEnd,
  reconcileContractSchedule,
  renewedEndDate
} from "@carbon/database/contract-schedule";
import { round } from "@carbon/database/precision";
import { getNextSequence } from "@carbon/database/sequence";
import {
  contractInvoiceHold,
  datetime,
  effectiveInvoiceAutomation,
  formatDate,
  formatPercent,
  type InvoiceAutomation,
  lineRevenueDates
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import {
  billedTotals,
  changedRevenueLines,
  ensureRevenue,
  reconcileRevenue
} from "../post-customer-contract/revenue-writes";
import {
  applyDiscountEnds,
  applyReconciliation,
  type ContractLineRow,
  type ContractRow,
  copyLineValues,
  deleteEmptyPlannedInvoices,
  type LoadedContract,
  loadContractForUpdate,
  reconcileThrough,
  type Scope,
  toLineTerms,
  toTerms
} from "../post-customer-contract/schedule-writes";

type Enums = Database["public"]["Enums"];

export type ContractInvoiceGenerationArgs = {
  companyId: string;
  /** `YYYY-MM-DD` in the company's timezone: Planned invoices dated on or
   *  before it are drafted. */
  asOf: string;
  /** Draft one contract only (the contract page's action). */
  customerContractId?: string;
  userId: string;
};

/** One invoice the generator drafted, and what automation may do with it. */
export type DraftedContractInvoice = {
  invoiceId: string;
  customerContractId: string;
  /** The contract's effective invoice automation. */
  mode: InvoiceAutomation;
  /** Set when a person must review the draft before it is posted. */
  holdReason: string | null;
};

export type ContractInvoiceGenerationFailure = {
  customerContractId: string;
  error: string;
};

export type ContractInvoiceGenerationResult = {
  invoices: DraftedContractInvoice[];
  /** `invoices.map(i => i.invoiceId)`. */
  invoiceIds: string[];
  /** Contracts whose transaction rolled back; their invoices stay Planned. */
  failures: ContractInvoiceGenerationFailure[];
};

const addDays = (date: string, days: number) =>
  parseDate(date).add({ days }).toString();

/** Shown on a drafted line: "Nov 1, 2026". */
const DESCRIPTION_DATE: Intl.DateTimeFormatOptions = { dateStyle: "medium" };
const DESCRIPTION_LOCALE = "en-US";

/**
 * Drafts the sales invoices of every Active contract with something to do: a
 * Planned invoice dated on or before `asOf`, a renewal that is due, an end
 * date that has passed, or an open-ended schedule to roll forward. Each
 * contract is its own transaction, so one contract's failure never rolls back
 * another's invoice. A drafted planned invoice is stamped `Invoiced` with its
 * sales invoice, and each of its rows with the line that bills it, which is
 * what makes a second call for the same day a no-op.
 */
async function createContractInvoicesForDueInvoices(
  db: Kysely<KyselyDatabase>,
  args: ContractInvoiceGenerationArgs
): Promise<ContractInvoiceGenerationResult> {
  const { companyId, asOf, customerContractId } = args;

  // One read for every contract with anything to do; the per-contract
  // transaction below re-reads its own rows under the header lock.
  let dueQuery = db
    .selectFrom("customerContract as c")
    .select("c.id")
    .where("c.companyId", "=", companyId)
    .where("c.status", "=", "Active")
    .where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom("customerContractInvoice as i")
            .select("i.id")
            .whereRef("i.customerContractId", "=", "c.id")
            .whereRef("i.companyId", "=", "c.companyId")
            .where("i.status", "=", "Planned")
            .where("i.invoiceDate", "<=", asOf)
        ),
        eb.and([eb("c.renewal", "=", "Renew"), eb("c.endDate", "<=", asOf)]),
        eb("c.endDate", "<", asOf),
        // An open-ended schedule may need its next period planned.
        eb("c.endDate", "is", null)
      ])
    )
    .orderBy("c.customerContractId");
  if (customerContractId) {
    dueQuery = dueQuery.where("c.id", "=", customerContractId);
  }
  const contracts = await dueQuery.execute();

  // One contract's failure never stops the others: what earlier contracts
  // committed is returned (so automation still runs over it) next to the
  // failures, rather than lost behind a throw.
  const invoices: DraftedContractInvoice[] = [];
  const failures: ContractInvoiceGenerationFailure[] = [];
  for (const contract of contracts) {
    try {
      const drafted = await db
        .transaction()
        .execute((trx) => processContract(trx, args, contract.id));
      invoices.push(...drafted);
    } catch (error) {
      failures.push({
        customerContractId: contract.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { invoices, invoiceIds: invoices.map((i) => i.invoiceId), failures };
}

async function processContract(
  trx: KyselyTx,
  args: ContractInvoiceGenerationArgs,
  contractId: string
): Promise<DraftedContractInvoice[]> {
  const { companyId, userId, asOf } = args;
  const scope: Scope = { companyId, userId };

  // 1. Lock and load.
  let loaded = await loadContractForUpdate(trx, companyId, contractId);
  if (loaded.contract.status !== "Active") return [];

  // 2. Renew, as many terms as the contract is behind.
  loaded = await renewDueTerms(trx, scope, asOf, loaded);

  // 3. Roll an open-ended schedule forward to the horizon.
  if (loaded.contract.endDate === null) {
    loaded = await rollHorizon(trx, scope, asOf, loaded);
  }

  // 4. Draft every Planned invoice that is due.
  await deleteEmptyPlannedInvoices(trx, scope, contractId);
  const drafted = await draftDueInvoices(trx, scope, asOf, loaded);

  // 5. End a contract whose end date has passed and that has nothing left to
  // invoice.
  const { contract } = loaded;
  if (contract.endDate !== null && contract.endDate < asOf) {
    const planned = await trx
      .selectFrom("customerContractInvoice")
      .select("id")
      .where("customerContractId", "=", contract.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Planned")
      .executeTakeFirst();
    if (!planned) {
      const now = datetime.timestamp();
      await trx
        .updateTable("customerContract")
        .set({
          status: "Ended",
          endedAt: now,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", contract.id)
        .where("companyId", "=", companyId)
        .execute();
    }
  }

  return drafted;
}

/**
 * Renews the contract while `renewal = 'Renew'` and its term has run out:
 * one amendment per term (effective the day after the old end), the contract
 * end moved by `termMonths`, and the schedule reconciled from the new term's
 * first day. A Recurring line that runs to the old end (a null end, or an end
 * equal to it) carries into the new term — as a copy at the uplifted rate when
 * `renewalUplift > 0`; a null-ended line otherwise just follows the contract.
 * A discount that ended in the old term is dropped from a copy; one that ends
 * inside the new term is split off (`applyDiscountEnds`), whether the line was
 * copied or followed the contract.
 */
async function renewDueTerms(
  trx: KyselyTx,
  scope: Scope,
  asOf: string,
  initial: LoadedContract
): Promise<LoadedContract> {
  const { companyId, userId } = scope;
  let loaded = initial;
  for (;;) {
    const { contract, lines } = loaded;
    if (
      contract.renewal !== "Renew" ||
      !contract.termMonths ||
      contract.endDate === null ||
      contract.endDate > asOf
    ) {
      return loaded;
    }
    const oldEnd = contract.endDate;
    const newStart = addDays(oldEnd, 1);
    // A contract confirmed before revenue was stored gets its plan written
    // from the term it had, so the reconciliation below keeps its past.
    await ensureRevenue(trx, scope, contract, lines);
    const billedBefore = await billedTotals(trx, scope, contract.id);
    const newEnd = renewedEndDate(oldEnd, contract.termMonths);
    const uplift = Number(contract.renewalUplift);

    const amendment = await trx
      .insertInto("customerContractAmendment")
      .values({
        customerContractId: contract.id,
        amendmentDate: newStart,
        effect: "Next Period",
        contractType: "Existing",
        reason: "Renewal",
        previousState: null,
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const renewing = lines.filter(
      (line) =>
        line.revenueType === "Recurring" &&
        line.startDate <= oldEnd &&
        (line.endDate === null || line.endDate === oldEnd)
    );
    // With an uplift every renewing line is ended and copied at the new rate.
    // Without one a null-ended line follows the contract as it is; a line
    // ended on the old contract end is copied at its rate, or it would drop
    // out of the renewed term.
    const copied =
      uplift > 0
        ? renewing
        : renewing.filter((line) => line.endDate === oldEnd);
    if (copied.length > 0) {
      const toEnd = copied.filter((line) => line.endDate === null);
      if (toEnd.length > 0) {
        await trx
          .updateTable("customerContractLine")
          .set({ endDate: oldEnd, updatedBy: userId, updatedAt: sql`now()` })
          .where(
            "id",
            "in",
            toEnd.map((line) => line.id)
          )
          .where("customerContractId", "=", contract.id)
          .where("companyId", "=", companyId)
          .execute();
      }
      await trx
        .insertInto("customerContractLine")
        .values(
          copied.map((line) =>
            copyLineValues(scope, line, {
              rate: round(line.rate * (1 + uplift)),
              startDate: newStart,
              endDate: null,
              // A discount that ended in the old term does not come back.
              discountEndsOn:
                line.discountEndsOn !== null && line.discountEndsOn >= newStart
                  ? line.discountEndsOn
                  : null,
              // The old term's go-live and revenue dates do not carry over.
              goLiveDate: null,
              revenueStartDate: null,
              revenueEndDate: null,
              amendmentId: amendment.id,
              amendsLineId: line.id
            })
          )
        )
        .execute();
    }

    await trx
      .updateTable("customerContract")
      .set({ endDate: newEnd, updatedBy: userId, updatedAt: sql`now()` })
      .where("id", "=", contract.id)
      .where("companyId", "=", companyId)
      .execute();

    // Every split starts after `newStart`, so the reconciliation below
    // covers it.
    await applyDiscountEnds(trx, scope, { ...contract, endDate: newEnd });

    const next = await loadContractForUpdate(trx, companyId, contract.id);
    const terms = toTerms(next.contract);
    await applyReconciliation(
      trx,
      scope,
      contract.id,
      reconcileContractSchedule({
        terms,
        lines: toLineTerms(next.lines),
        existing: next.existing,
        from: newStart,
        through: reconcileThrough(
          horizon(terms, asOf),
          next.existing,
          next.lines
        )
      })
    );
    // Revenue follows the renewed term from its first day (D9).
    await reconcileRevenue(
      trx,
      scope,
      next.contract,
      next.lines,
      changedRevenueLines(
        { lines, billed: billedBefore },
        {
          lines: next.lines,
          billed: await billedTotals(trx, scope, contract.id)
        }
      ),
      newStart
    );
    loaded = await loadContractForUpdate(trx, companyId, contract.id);
  }
}

/**
 * Plans an open-ended contract's periods up to `horizon(terms, asOf)`, from
 * the day after the last persisted Recurring period (`lastRecurringPeriodEnd`
 * — a One-time row's service window can run far past it). Creates only: rows
 * already planned (and the invoices they sit on) are never touched, and no
 * row is created for a key that already has one.
 */
async function rollHorizon(
  trx: KyselyTx,
  scope: Scope,
  asOf: string,
  loaded: LoadedContract
): Promise<LoadedContract> {
  const { contract, lines, existing } = loaded;
  const terms = toTerms(contract);
  const through = horizon(terms, asOf);
  const lastEnd = lastRecurringPeriodEnd(existing, lines);
  const from = lastEnd === null ? contract.startDate : addDays(lastEnd, 1);
  if (from > through) return loaded;

  const result = reconcileContractSchedule({
    terms,
    lines: toLineTerms(lines),
    existing,
    from,
    through
  });
  // Only the periods past the persisted schedule: reconciling from `from`
  // would otherwise replace a Planned invoice dated on or after it (an
  // Arrears invoice for the last planned period, a One-time row invoiced
  // later), re-creating its rows.
  const persisted = new Set(
    existing
      .filter((row) => !row.isAdjustment)
      .map((row) => `${row.lineId}|${row.periodStart}`)
  );
  const create = result.create
    .map((invoice) => ({
      ...invoice,
      rows: invoice.rows.filter(
        (row) =>
          row.periodStart >= from &&
          !persisted.has(`${row.lineId}|${row.periodStart}`)
      )
    }))
    .filter((invoice) => invoice.rows.length > 0);
  if (create.length === 0) return loaded;

  await ensureRevenue(trx, scope, contract, lines);
  const billedBefore = await billedTotals(trx, scope, contract.id);
  await applyReconciliation(trx, scope, contract.id, {
    deleteInvoiceIds: [],
    deleteRowIds: [],
    recut: [],
    create,
    adjustments: []
  });
  // The appended periods extend each open-ended line's revenue: re-plan it
  // from the first appended period (D9).
  const firstAppended = create
    .flatMap((invoice) => invoice.rows.map((row) => row.periodStart))
    .reduce((earliest, date) => (date < earliest ? date : earliest));
  await reconcileRevenue(
    trx,
    scope,
    contract,
    lines,
    changedRevenueLines(
      { lines, billed: billedBefore },
      { lines, billed: await billedTotals(trx, scope, contract.id) }
    ),
    firstAppended
  );
  return loadContractForUpdate(trx, scope.companyId, contract.id);
}

type DueRow = {
  id: string;
  customerContractInvoiceId: string;
  invoiceDate: string;
  customerContractLineId: string;
  periodStart: string;
  periodEnd: string;
  unitPrice: number;
  amount: number;
  isAdjustment: boolean;
  voidedSalesInvoiceId: string | null;
};

/** Drafts one sales invoice per Planned invoice dated on or before `asOf`. */
async function draftDueInvoices(
  trx: KyselyTx,
  scope: Scope,
  asOf: string,
  loaded: LoadedContract
): Promise<DraftedContractInvoice[]> {
  const { companyId } = scope;
  const { contract, lines } = loaded;

  const rows: DueRow[] = (
    await trx
      .selectFrom("customerContractInvoiceLine as r")
      .innerJoin("customerContractInvoice as i", (join) =>
        join
          .onRef("i.id", "=", "r.customerContractInvoiceId")
          .onRef("i.companyId", "=", "r.companyId")
      )
      .select([
        "r.id",
        "r.customerContractInvoiceId",
        sql<string>`i."invoiceDate"::text`.as("invoiceDate"),
        "r.customerContractLineId",
        sql<string>`r."periodStart"::text`.as("periodStart"),
        sql<string>`r."periodEnd"::text`.as("periodEnd"),
        "r.unitPrice",
        "r.amount",
        "r.isAdjustment",
        "r.voidedSalesInvoiceId"
      ])
      .where("i.customerContractId", "=", contract.id)
      .where("i.companyId", "=", companyId)
      .where("i.status", "=", "Planned")
      .where("i.invoiceDate", "<=", asOf)
      .orderBy("i.invoiceDate")
      .orderBy("i.id")
      .orderBy("r.periodStart")
      .orderBy("r.id")
      .execute()
  ).map((row) => ({
    ...row,
    customerContractInvoiceId: row.customerContractInvoiceId!,
    unitPrice: Number(row.unitPrice),
    amount: Number(row.amount),
    isAdjustment: row.isAdjustment ?? false
  }));
  if (rows.length === 0) return [];

  const settings = await trx
    .selectFrom("companySettings")
    .select("invoiceAutomation")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  const mode = effectiveInvoiceAutomation(
    contract.invoiceAutomation,
    settings.invoiceAutomation
  );

  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const items =
    itemIds.length === 0
      ? []
      : await trx
          .selectFrom("item")
          .select(["id", "name", "unitOfMeasureCode", "defaultMethodType"])
          .where("id", "in", itemIds)
          .where("companyId", "=", companyId)
          .execute();
  const itemById = new Map(items.map((item) => [item.id, item]));

  // The readable ids of the voided invoices these rows were billed on, so a
  // re-bill's hold names them. One read; a deleted invoice keeps its raw id.
  const voidedIds = [
    ...new Set(
      rows
        .map((row) => row.voidedSalesInvoiceId)
        .filter((voidedId): voidedId is string => !!voidedId)
    )
  ];
  const voidedReadableIds = new Map<string, string>();
  if (voidedIds.length > 0) {
    const voided = await trx
      .selectFrom("salesInvoice")
      .select(["id", "invoiceId"])
      .where("companyId", "=", companyId)
      .where("id", "in", voidedIds)
      .execute();
    for (const invoice of voided) {
      voidedReadableIds.set(invoice.id, invoice.invoiceId);
    }
  }

  const locationId = await contractLocationId(trx, companyId, contract);

  // Rows grouped by planned invoice, in invoice-date order; each invoice's
  // rows follow the contract's line order.
  const lineOrder = new Map(lines.map((line, index) => [line.id, index]));
  const byInvoice = new Map<string, DueRow[]>();
  for (const row of rows) {
    const group = byInvoice.get(row.customerContractInvoiceId);
    if (group) group.push(row);
    else byInvoice.set(row.customerContractInvoiceId, [row]);
  }

  const lineById = new Map(lines.map((line) => [line.id, line]));
  const drafted: DraftedContractInvoice[] = [];
  for (const [plannedInvoiceId, group] of byInvoice) {
    group.sort(
      (a, b) =>
        (lineOrder.get(a.customerContractLineId) ?? 0) -
          (lineOrder.get(b.customerContractLineId) ?? 0) ||
        a.periodStart.localeCompare(b.periodStart) ||
        Number(a.isAdjustment) - Number(b.isAdjustment)
    );
    const holdReason = contractInvoiceHold(
      mode,
      group.map((row) => ({
        amount: row.amount,
        isAdjustment: row.isAdjustment,
        voidedInvoiceReadableId: row.voidedSalesInvoiceId
          ? (voidedReadableIds.get(row.voidedSalesInvoiceId) ??
            row.voidedSalesInvoiceId)
          : null
      }))
    );
    const invoiceId = await insertContractInvoice(trx, scope, {
      asOf,
      contract,
      locationId,
      plannedInvoiceId,
      holdReason,
      lines: group.map((row) => {
        const line = lineById.get(row.customerContractLineId);
        if (!line) {
          throw new Error(
            `Schedule row ${row.id} names a line that is not on the contract`
          );
        }
        return invoiceLineValues(row, line, itemById.get(line.itemId), {
          contract,
          locationId
        });
      })
    });
    drafted.push({
      invoiceId,
      customerContractId: contract.id,
      mode,
      holdReason
    });
  }
  return drafted;
}

/** Where a contract's invoices are drafted: its sales order's shipping
 *  location when it came from one, else the company's first location. A
 *  contract has no location of its own. */
async function contractLocationId(
  trx: KyselyTx,
  companyId: string,
  contract: ContractRow
): Promise<string> {
  if (contract.salesOrderId) {
    const shipment = await trx
      .selectFrom("salesOrderShipment")
      .select("locationId")
      .where("id", "=", contract.salesOrderId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (shipment?.locationId) return shipment.locationId;
  }
  const location = await trx
    .selectFrom("location")
    .select("id")
    .where("companyId", "=", companyId)
    .orderBy("createdAt")
    .orderBy("id")
    .executeTakeFirst();
  if (!location) {
    throw new Error("The company has no location to draft the invoice at");
  }
  return location.id;
}

type InvoiceLineValues = {
  itemId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  customerContractId: string;
  customerContractLineId: string;
  customerContractInvoiceLineId: string;
  projectId: string | null;
  methodType: Enums["methodType"];
  unitOfMeasureCode: string;
};

/** One schedule row as a Service sales-invoice line (plan decision 10). */
function invoiceLineValues(
  row: DueRow,
  line: ContractLineRow,
  item:
    | {
        name: string;
        unitOfMeasureCode: string | null;
        defaultMethodType: Enums["methodType"] | null;
      }
    | undefined,
  context: { contract: ContractRow; locationId: string }
): InvoiceLineValues {
  const quantity = Number(line.quantity);
  const discountPercent = Number(line.discountPercent);
  const pricing = invoiceLinePricing(row, { quantity, discountPercent });

  const period = `${formatDate(row.periodStart, DESCRIPTION_DATE, DESCRIPTION_LOCALE)}–${formatDate(
    row.periodEnd,
    DESCRIPTION_DATE,
    DESCRIPTION_LOCALE
  )}`;
  const fellBack = pricing.discountPercent === 0 && discountPercent > 0;
  const description = [
    line.description ?? item?.name ?? "",
    period,
    ...(fellBack
      ? [`${formatPercent(discountPercent, DESCRIPTION_LOCALE)} off`]
      : [])
  ].join(" · ");

  let serviceStartDate: string | null = row.periodStart;
  let serviceEndDate: string | null = row.periodEnd;
  if (line.revenueType === "One-time") {
    const revenue = lineRevenueDates(line);
    serviceStartDate = revenue.end === null ? null : revenue.start;
    serviceEndDate = revenue.end;
  }

  return {
    itemId: line.itemId,
    description,
    quantity: pricing.quantity,
    // The schedule prices in the contract's currency; `salesInvoiceLine.
    // unitPrice` is base currency (`convertedUnitPrice` = unitPrice ×
    // exchangeRate is what the customer sees), as on every sales document.
    unitPrice: toBaseAmount(
      pricing.unitPrice,
      Number(context.contract.exchangeRate)
    ),
    discountPercent: pricing.discountPercent,
    taxPercent: Number(line.taxPercent),
    serviceStartDate,
    serviceEndDate,
    customerContractId: context.contract.id,
    customerContractLineId: line.id,
    customerContractInvoiceLineId: row.id,
    projectId: line.projectId ?? context.contract.projectId,
    // As the invoice line form fills it from the item (and `convert` copies
    // it from the order line the form filled the same way).
    methodType: item?.defaultMethodType ?? "Pull from Inventory",
    unitOfMeasureCode: item?.unitOfMeasureCode ?? "EA"
  };
}

/**
 * Inserts one Draft contract invoice (opportunity, header, shipment, lines),
 * stamps the planned invoice `Invoiced` with it and each row with the line
 * that bills it. Returns the invoice id.
 */
async function insertContractInvoice(
  trx: KyselyTx,
  scope: Scope,
  args: {
    asOf: string;
    contract: ContractRow;
    locationId: string;
    plannedInvoiceId: string;
    holdReason: string | null;
    lines: InvoiceLineValues[];
  }
): Promise<string> {
  const { companyId, userId } = scope;
  const { asOf, contract, locationId, lines } = args;

  // Net merchandise per line, as the schedule priced it; tax on the net.
  const nets = lines.map((line) =>
    round(line.quantity * line.unitPrice * (1 - line.discountPercent))
  );
  const subtotal = round(nets.reduce((sum, net) => sum + net, 0));
  const totalTax = round(
    lines.reduce((sum, line, index) => sum + nets[index]! * line.taxPercent, 0)
  );

  const readableInvoiceId = await getNextSequence(
    trx,
    "salesInvoice",
    companyId
  );
  // Every sales invoice has an opportunity, as insertSalesInvoice makes one:
  // its documents live under the opportunity's storage folder, and the
  // invoice page reads it.
  const opportunity = await trx
    .insertInto("opportunity")
    .values({ companyId, customerId: contract.customerId })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  const invoice = await trx
    .insertInto("salesInvoice")
    .values({
      invoiceId: readableInvoiceId,
      status: "Draft",
      customerId: contract.customerId,
      invoiceCustomerId: contract.invoiceCustomerId ?? contract.customerId,
      invoiceCustomerContactId: contract.invoiceCustomerContactId,
      invoiceCustomerLocationId: contract.invoiceCustomerLocationId,
      locationId,
      paymentTermId: contract.paymentTermId,
      currencyCode: contract.currencyCode,
      exchangeRate: contract.exchangeRate,
      customerReference: contract.customerReference,
      customerContractId: contract.id,
      dateIssued: asOf,
      subtotal,
      totalDiscount: 0,
      totalTax,
      totalAmount: round(subtotal + totalTax),
      opportunityId: opportunity.id,
      automationHoldReason: args.holdReason,
      companyId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  await trx
    .insertInto("salesInvoiceShipment")
    .values({
      id: invoice.id,
      locationId,
      shippingCost: 0,
      companyId,
      createdBy: userId
    })
    .execute();

  await trx
    .insertInto("salesInvoiceLine")
    .values(
      lines.map((line, index) => ({
        invoiceId: invoice.id,
        invoiceLineType: "Service" as const,
        ...line,
        exchangeRate: contract.exchangeRate,
        locationId,
        sortOrder: index + 1,
        companyId,
        createdBy: userId
      }))
    )
    .execute();

  // Stamp what was drafted with the invoice (and line) that bills it.
  await trx
    .updateTable("customerContractInvoice")
    .set({
      status: "Invoiced",
      salesInvoiceId: invoice.id,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("id", "=", args.plannedInvoiceId)
    .where("customerContractId", "=", contract.id)
    .where("companyId", "=", companyId)
    .execute();

  await trx
    .updateTable("customerContractInvoiceLine as r")
    .from("salesInvoiceLine as sil")
    .set({
      salesInvoiceLineId: sql`sil.id`,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .whereRef("sil.customerContractInvoiceLineId", "=", "r.id")
    .whereRef("sil.companyId", "=", "r.companyId")
    .where("sil.invoiceId", "=", invoice.id)
    .where("r.companyId", "=", companyId)
    .execute();

  return invoice.id;
}

export const createContractInvoicesInput = z.object({
  /** `YYYY-MM-DD` in the company's timezone. */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Draft one contract only. */
  customerContractId: z.string().optional()
});

/** Drafts the contract invoices due on or before `asOf` (see
 *  `createContractInvoicesForDueInvoices`). A contract that fails is reported
 *  in `failures`, never thrown, so the others still draft. */
const createContractInvoices = defineServerFn({
  name: "create-contract-invoices",
  input: createContractInvoicesInput,
  permissions: { update: "sales", create: "invoicing" },
  async run({ db, companyId, userId }, { asOf, customerContractId }) {
    return createContractInvoicesForDueInvoices(db, {
      companyId,
      userId,
      asOf,
      customerContractId
    });
  }
});

export default createContractInvoices;
