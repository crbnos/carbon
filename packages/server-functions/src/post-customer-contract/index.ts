// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The lifecycle of a customer contract. Each action is ONE transaction that
// locks the contract header first (`loadContractForUpdate`):
//
//   confirm               Draft → Active: lines checked, the schedule
//                         materialized (or an edited one validated), the
//                         Stripe link checked, discount ends turned into
//                         amendments.
//   edit-schedule         Draft only: move / split / merge an invoice, move a
//                         row, set a cell's amount, add or delete an invoice.
//                         The first edit materializes the schedule.
//   edit-revenue          Draft only: set a (line, month) revenue amount, add
//                         or delete a month, reset. The first edit
//                         materializes the revenue plan.
//   reset-schedule        Draft only: drop the persisted schedule; the page
//                         goes back to the live preview.
//   amend                 Active: change, add or end lines from an effective
//                         date, then reconcile the schedule (preview rolls back).
//   cancel                Active: end the contract early, optionally crediting
//                         unused billed time on a Draft credit memo.
//   revert-cancellation   Undo a cancellation while its memo is still Draft.
//
// Spec: `.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III; plans:
// `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III Tasks 9–11,
// `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part IV T3 (revenue, D8–D11).

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  monthStart,
  validateRevenueEdit
} from "@carbon/database/contract-revenue-schedule";
import {
  amendmentEffectiveDate,
  horizon,
  lastRecurringPeriodEnd,
  lineTotals,
  periodEndContaining,
  planInvoiceSchedule,
  reconcileContractSchedule,
  recurringValuePerPeriod,
  suggestAmendmentType,
  validateScheduleEdit
} from "@carbon/database/contract-schedule";
import { toJson } from "@carbon/database/json";
import {
  distributeRoundingResidual,
  equals,
  round
} from "@carbon/database/precision";
import { monthEnd } from "@carbon/database/revenue-schedule";
import { getNextSequence } from "@carbon/database/sequence";
import { datetime, effectiveInvoiceAutomation } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import {
  billedTotals,
  changedRevenueLines,
  ensureRevenue,
  hasStoredRevenue,
  loadRevenue,
  materializeRevenue,
  reconcileRevenue,
  writeOpeningEntries
} from "./revenue-writes";
import {
  applyDiscountEnds,
  applyReconciliation,
  type ContractLineRow,
  type ContractRow,
  carriedRevenueDates,
  copyLineValues,
  deleteEmptyPlannedInvoices,
  insertScheduleRows,
  invoiceKey,
  type LineFields,
  type LoadedContract,
  loadContractForUpdate,
  loadSchedule,
  materializeSchedule,
  reconcileThrough,
  resolveInvoiceIds,
  type Scope,
  scheduleRowValues,
  setLineEndDates,
  toLineTerms,
  toTerms
} from "./schedule-writes";

type Db = Kysely<KyselyDatabase>;
type Enums = Database["public"]["Enums"];

const STRIPE_CONNECT_INTEGRATION = "stripe-connect";

// ---------------------------------------------------------------------------
// Input

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const base = {
  customerContractId: z.string().min(1),
  /** `YYYY-MM-DD`, today in the company's timezone (computed by the caller). */
  asOf: isoDate
};

const contractRateUnits = [
  "Day",
  "Week",
  "Month",
  "Quarter",
  "Year"
] as const satisfies readonly Enums["contractRateUnit"][];
const contractRevenueTypes = [
  "One-time",
  "Recurring"
] as const satisfies readonly Enums["contractRevenueType"][];
const contractRevenueMethods = [
  "Daily",
  "Even Period"
] as const satisfies readonly Enums["contractRevenueMethod"][];
const contractAmendmentEffects = [
  "Change Date",
  "Next Period"
] as const satisfies readonly Enums["contractAmendmentEffect"][];
const customerContractTypes = [
  "New Sales",
  "Existing",
  "Expansion",
  "Reactivation",
  "Contraction"
] as const satisfies readonly Enums["customerContractType"][];

/** One edit to a Draft schedule — the ERP's
 *  `customerContractScheduleEditValidator` minus `reset`. Refs are a stored
 *  id or a `planned:` position ref (see `editSchedule`). */
const scheduleEdit = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("move"),
    customerContractInvoiceId: z.string().min(1),
    invoiceDate: isoDate
  }),
  z.object({
    intent: z.literal("split"),
    customerContractInvoiceLineId: z.string().min(1),
    installments: z
      .array(
        z.object({
          invoiceDate: isoDate,
          amount: z.number().positive("Each installment must be more than 0")
        })
      )
      .min(2)
  }),
  z.object({
    intent: z.literal("merge"),
    sourceInvoiceId: z.string().min(1),
    targetInvoiceId: z.string().min(1)
  }),
  z.object({
    intent: z.literal("moveLine"),
    customerContractInvoiceLineId: z.string().min(1),
    invoiceDate: isoDate
  }),
  // The invoice grid (plan D10): one cell is one (invoice, line).
  z.object({
    intent: z.literal("setAmount"),
    customerContractInvoiceId: z.string().min(1),
    customerContractLineId: z.string().min(1),
    amount: z.number().min(0)
  }),
  z.object({
    intent: z.literal("addInvoice"),
    invoiceDate: isoDate,
    amounts: z
      .array(
        z.object({
          customerContractLineId: z.string().min(1),
          amount: z.number().min(0)
        })
      )
      .refine((amounts) => amounts.some((a) => a.amount > 0), {
        message: "Enter an amount for at least one line"
      })
  }),
  z.object({
    intent: z.literal("delete"),
    customerContractInvoiceId: z.string().min(1)
  })
]);

/** `YYYY-MM-01`: a revenue row is one calendar month. */
const firstOfMonth = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-01$/,
    "Use the first day of a month (YYYY-MM-01)"
  );

/** One edit to a Draft revenue plan (plan D11). Rows are keyed by
 *  (line, month), so no position refs are needed. */
const revenueEdit = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("setAmount"),
    customerContractLineId: z.string().min(1),
    periodStart: firstOfMonth,
    // A hand edit moves revenue between months; only reconciliation writes a
    // negative (catch-up) month.
    amount: z.number().finite().min(0)
  }),
  z.object({
    intent: z.literal("addMonth"),
    periodStart: firstOfMonth,
    amounts: z
      .array(
        z.object({
          customerContractLineId: z.string().min(1),
          amount: z.number().finite().min(0)
        })
      )
      .refine((amounts) => amounts.some((a) => a.amount !== 0), {
        message: "Enter an amount for at least one line"
      })
  }),
  z.object({ intent: z.literal("deleteMonth"), periodStart: firstOfMonth }),
  z.object({ intent: z.literal("reset") })
]);

/** Percentages are percent points (0–100), as the ERP's
 *  `contractAmendmentChangeValidator` parses them; stored as a fraction by
 *  `fraction`. */
const percentPoints = z.number().min(0).max(100);

/** Percent points as the stored fraction, at internal scale — the same
 *  conversion as the ERP's `percentToFraction`. A bare `/ 100` stores float
 *  noise (14.3 / 100 = 0.14300000000000002). */
const fraction = (points: number) => round(points / 100);

const amendmentLine = z
  .object({
    revenueType: z.enum(contractRevenueTypes),
    itemId: z.string().min(1),
    description: z.string().optional(),
    quantity: z.number().positive(),
    rate: z.number().min(0),
    rateUnit: z.enum(contractRateUnits).optional(),
    discountPercent: percentPoints,
    discountEndsOn: isoDate.optional(),
    taxPercent: percentPoints,
    startDate: isoDate,
    endDate: isoDate.optional(),
    goLiveDate: isoDate.optional(),
    revenueMethod: z.enum(contractRevenueMethods),
    revenueStartDate: isoDate.optional(),
    revenueEndDate: isoDate.optional(),
    projectId: z.string().optional()
  })
  .refine((line) => (line.revenueType === "Recurring") === !!line.rateUnit, {
    message: "A recurring line needs a rate unit; a one-time line has none",
    path: ["rateUnit"]
  });

const amendmentChange = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("change"),
    lineId: z.string().min(1),
    quantity: z.number().positive().optional(),
    rate: z.number().min(0).optional(),
    rateUnit: z.enum(contractRateUnits).optional(),
    discountPercent: percentPoints.optional(),
    taxPercent: percentPoints.optional(),
    description: z.string().optional(),
    revenueMethod: z.enum(contractRevenueMethods).optional(),
    projectId: z.string().optional()
  }),
  z.object({ op: z.literal("add"), line: amendmentLine }),
  z.object({ op: z.literal("end"), lineId: z.string().min(1) })
]);

export const postCustomerContractInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("confirm"), ...base }),
  z.object({ type: z.literal("edit-schedule"), ...base, edit: scheduleEdit }),
  z.object({ type: z.literal("reset-schedule"), ...base }),
  z.object({ type: z.literal("edit-revenue"), ...base, edit: revenueEdit }),
  z.object({
    type: z.literal("amend"),
    ...base,
    amendmentDate: isoDate,
    effect: z.enum(contractAmendmentEffects),
    contractType: z.enum(customerContractTypes),
    reason: z.string().trim().min(1),
    changes: z.array(amendmentChange).min(1),
    preview: z.boolean().optional()
  }),
  z.object({
    type: z.literal("cancel"),
    ...base,
    endDate: isoDate,
    reason: z.string().trim().min(1),
    creditUnusedTime: z.boolean(),
    preview: z.boolean().optional()
  }),
  z.object({ type: z.literal("revert-cancellation"), ...base })
]);

export type PostCustomerContractInput = z.infer<
  typeof postCustomerContractInput
>;
type Payload<T extends PostCustomerContractInput["type"]> = Extract<
  PostCustomerContractInput,
  { type: T }
>;

// ---------------------------------------------------------------------------
// Helpers

const addDays = (date: string, days: number) =>
  parseDate(date).add({ days }).toString();
const maxDate = (a: string, b: string) => (a >= b ? a : b);

function refuseUnless(
  contract: ContractRow,
  status: Enums["customerContractStatus"],
  action: string
) {
  if (contract.status !== status) {
    throw new InvalidInputError(
      `Contract ${contract.customerContractId} is ${contract.status}; only ${
        status === "Active" ? "an" : "a"
      } ${status} contract can be ${action}`
    );
  }
}

// ---------------------------------------------------------------------------
// confirm

async function confirm(
  db: Db,
  scope: Scope,
  payload: Payload<"confirm">
): Promise<{ customerContractId: string }> {
  const { companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    // 1. Lock, load, and check the lines.
    let { contract, lines, existing } = await loadContractForUpdate(
      trx,
      companyId,
      payload.customerContractId
    );
    refuseUnless(contract, "Draft", "confirmed");
    if (lines.length === 0) {
      throw new InvalidInputError("Add at least one line before confirming");
    }
    const items = await trx
      .selectFrom("item")
      .select(["id", "type", "readableIdWithRevision"])
      .where("id", "in", [...new Set(lines.map((line) => line.itemId))])
      .where("companyId", "=", companyId)
      .execute();
    const itemById = new Map(items.map((item) => [item.id, item]));
    const problems: string[] = [];
    for (const line of lines) {
      const item = itemById.get(line.itemId);
      const label = line.description ?? item?.readableIdWithRevision ?? "Line";
      if (!item) problems.push(`${label}: item not found`);
      else if (item.type !== "Service") {
        problems.push(`${label}: only Service items can be on a contract`);
      }
      if (line.revenueType === "Recurring" && !line.rateUnit) {
        problems.push(`${label}: a recurring line needs a rate unit`);
      }
    }
    if (problems.length > 0) throw new InvalidInputError(problems.join("; "));

    const terms = toTerms(contract);
    const through = horizon(terms, payload.asOf);

    // Billed through must fall on a period end (spec decision 8): a period
    // is billed elsewhere or here, never half of each. The day before the
    // start means nothing was billed elsewhere.
    if (
      contract.billedThrough !== null &&
      contract.billedThrough !== addDays(contract.startDate, -1)
    ) {
      const periodEnd = periodEndContaining(terms, contract.billedThrough);
      if (periodEnd !== contract.billedThrough) {
        throw new InvalidInputError(
          periodEnd
            ? `Billed through (${contract.billedThrough}) must fall on the end of a billing period; that period ends on ${periodEnd}`
            : `Billed through (${contract.billedThrough}) is before the contract starts`
        );
      }
    }

    // 2. Materialize an unedited schedule, or check an edited one still
    // bills every line's total. An open-ended contract's persisted schedule
    // was planned to an earlier horizon, so it is compared over the
    // Recurring periods it covers (a One-time row's service window can run
    // far past them).
    const lineLabel = (lineId: string) => {
      const line = lines.find((l) => l.id === lineId);
      return (
        line?.description ??
        (line ? itemById.get(line.itemId)?.readableIdWithRevision : null) ??
        lineId
      );
    };
    if (existing.length === 0) {
      await materializeSchedule(trx, scope, contract, lines, through);
    } else {
      const compareThrough = terms.endDate
        ? through
        : (lastRecurringPeriodEnd(existing, lines) ?? through);
      const { ok, residuals } = validateScheduleEdit(
        lineTotals(
          planInvoiceSchedule(terms, toLineTerms(lines), compareThrough)
        ),
        existing
      );
      if (!ok) {
        const detail = [...residuals]
          .filter(([, residual]) => !equals(residual, 0))
          .map(([lineId, residual]) => `${lineLabel(lineId)}: ${residual}`);
        throw new InvalidInputError(
          `The edited invoice schedule no longer bills each line's total${
            detail.length > 0
              ? ` (${detail.join("; ")} not on any invoice)`
              : ""
          }. Fix the edits or reset the schedule.`,
          { residuals: Object.fromEntries(residuals) }
        );
      }
    }

    // 2b. A revenue plan edited while Draft must still recognize what each
    // line bills (D11). Checked before the discount ends below re-plan any
    // line, so an edit is never hidden by a reconciliation.
    const revenueStored = await hasStoredRevenue(trx, scope, contract.id);
    if (revenueStored) {
      await refuseRevenueResiduals(trx, scope, contract.id, lineLabel);
    }
    const revenueBefore = revenueStored
      ? { lines, billed: await billedTotals(trx, scope, contract.id) }
      : null;

    // 3. Post and Send via Stripe needs the billing customer linked.
    const settings = await trx
      .selectFrom("companySettings")
      .select("invoiceAutomation")
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!settings) throw new NotFoundError("Company settings not found");
    const mode = effectiveInvoiceAutomation(
      contract.invoiceAutomation,
      settings.invoiceAutomation
    );
    if (mode === "Post and Send via Stripe") {
      const billingCustomerId =
        contract.invoiceCustomerId ?? contract.customerId;
      const link = await trx
        .selectFrom("externalIntegrationMapping")
        .select("id")
        .where("entityType", "=", "customer")
        .where("entityId", "=", billingCustomerId)
        .where("integration", "=", STRIPE_CONNECT_INTEGRATION)
        .where("companyId", "=", companyId)
        .where("externalId", "is not", null)
        .executeTakeFirst();
      if (!link) {
        throw new InvalidInputError(
          "The billing customer is not linked to a Stripe customer. Link them before confirming a contract that sends its invoices via Stripe."
        );
      }
    }

    // 4. A discount that ends becomes an amendment: the line ends that day
    // and a full-price copy starts the next. One reconciliation from the
    // earliest change re-plans Planned invoices from that date on against
    // every new line at once.
    const discountFrom = await applyDiscountEnds(trx, scope, contract);
    if (discountFrom !== null) {
      const reloaded = await loadContractForUpdate(trx, companyId, contract.id);
      contract = reloaded.contract;
      lines = reloaded.lines;
      existing = reloaded.existing;
      await applyReconciliation(
        trx,
        scope,
        contract.id,
        reconcileContractSchedule({
          terms: toTerms(contract),
          lines: toLineTerms(lines),
          existing,
          from: discountFrom,
          through: reconcileThrough(through, existing, lines)
        })
      );
    }

    // 4b. The revenue plan: written now when none is stored, else re-planned
    // for the lines a discount end split (D9). Then checked again — a plan
    // written from lines whose revenue dates bill nothing cannot conserve.
    if (!revenueBefore) {
      await materializeRevenue(trx, scope, contract, lines);
    } else if (discountFrom !== null) {
      await reconcileRevenue(
        trx,
        scope,
        contract,
        lines,
        changedRevenueLines(revenueBefore, {
          lines,
          billed: await billedTotals(trx, scope, contract.id)
        }),
        discountFrom
      );
    }
    await refuseRevenueResiduals(trx, scope, contract.id, lineLabel);

    // 4c. A migrated contract's opening position (D8).
    await writeOpeningEntries(trx, scope, contract);

    // 5. Active.
    const now = datetime.timestamp();
    await trx
      .updateTable("customerContract")
      .set({
        status: "Active",
        confirmedAt: now,
        confirmedBy: userId,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", contract.id)
      .where("companyId", "=", companyId)
      .execute();

    return { customerContractId: contract.id };
  });
}

/** Refuses when a line's stored revenue no longer totals what its invoice
 *  schedule bills — the same shape as the invoice residual refusal, with
 *  `revenueResiduals` (billed − Σ revenue, per line). */
async function refuseRevenueResiduals(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  lineLabel: (lineId: string) => string
): Promise<void> {
  const billed = await billedTotals(trx, scope, contractId);
  const rows = await loadRevenue(trx, scope, contractId);
  const { ok, residuals } = validateRevenueEdit(billed.totals, rows);
  if (ok) return;
  const detail = [...residuals].map(
    ([lineId, residual]) => `${lineLabel(lineId)}: ${residual}`
  );
  throw new InvalidInputError(
    `The revenue plan no longer recognizes each line's billed total (${detail.join(
      "; "
    )} not in any month). Fix the edits or reset the revenue plan.`,
    { revenueResiduals: Object.fromEntries(residuals) }
  );
}

// ---------------------------------------------------------------------------
// edit-schedule / reset-schedule

async function editSchedule(
  db: Db,
  scope: Scope,
  payload: Payload<"edit-schedule">
): Promise<{ customerContractId: string }> {
  const { companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const loaded = await loadContractForUpdate(
      trx,
      companyId,
      payload.customerContractId
    );
    const { contract } = loaded;
    refuseUnless(contract, "Draft", "edited");

    // The first edit materializes the computed schedule.
    let { existing, invoices } = loaded;
    if (existing.length === 0) {
      await materializeSchedule(
        trx,
        scope,
        contract,
        loaded.lines,
        horizon(toTerms(contract), payload.asOf)
      );
      ({ existing, invoices } = await loadSchedule(
        trx,
        companyId,
        contract.id
      ));
    }

    // An unedited Draft's schedule is computed live, so the page can only name
    // its invoices and rows by position: `planned:<invoiceDate>` and
    // `planned:<invoiceDate>:<lineId>:<periodStart>[:adjustment]`. Resolve
    // those against the rows materialized above.
    const PLANNED_REF = "planned:";
    const resolveInvoiceId = (ref: string) => {
      if (!ref.startsWith(PLANNED_REF)) return ref;
      const invoiceDate = ref.slice(PLANNED_REF.length);
      return (
        invoices.find(
          (i) => i.status === "Planned" && i.invoiceDate === invoiceDate
        )?.id ?? ref
      );
    };
    const resolveRowId = (ref: string) => {
      if (!ref.startsWith(PLANNED_REF)) return ref;
      const [invoiceDate, lineId, periodStart, adjustment] = ref
        .slice(PLANNED_REF.length)
        .split(":");
      const invoiceId = resolveInvoiceId(`${PLANNED_REF}${invoiceDate}`);
      return (
        existing.find(
          (r) =>
            r.invoiceId === invoiceId &&
            r.lineId === lineId &&
            r.periodStart === periodStart &&
            r.isAdjustment === (adjustment === "adjustment")
        )?.id ?? ref
      );
    };

    const plannedInvoice = (ref: string) => {
      const id = resolveInvoiceId(ref);
      const invoice = invoices.find((i) => i.id === id);
      if (!invoice) throw new NotFoundError("Planned invoice not found");
      if (invoice.status !== "Planned") {
        throw new InvalidInputError(
          `The ${invoice.invoiceDate} invoice is ${invoice.status}; only a Planned invoice can be edited`
        );
      }
      return invoice;
    };
    const plannedRow = (ref: string) => {
      const id = resolveRowId(ref);
      const row = existing.find((r) => r.id === id);
      if (!row) throw new NotFoundError("Invoice line not found");
      if (!row.invoiceId) {
        throw new InvalidInputError("A credited row cannot be edited");
      }
      plannedInvoice(row.invoiceId);
      return row;
    };
    /** The Planned invoice of each date, created (as edited) when missing. */
    const plannedInvoicesOn = (dates: string[]) =>
      resolveInvoiceIds(
        trx,
        scope,
        contract.id,
        dates.map((invoiceDate) => ({
          invoiceDate,
          status: "Planned" as const
        })),
        { isEdited: true }
      );
    const moveRows = async (rowIds: string[], invoiceId: string) => {
      await trx
        .updateTable("customerContractInvoiceLine")
        .set({
          customerContractInvoiceId: invoiceId,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "in", rowIds)
        .where("customerContractId", "=", contract.id)
        .where("companyId", "=", companyId)
        .execute();
    };

    const touched = new Set<string>();
    const lineById = new Map(loaded.lines.map((line) => [line.id, line]));
    const contractLine = (lineId: string) => {
      const line = lineById.get(lineId);
      if (!line) throw new NotFoundError("Contract line not found");
      return line;
    };
    /** The line's row on another invoice nearest to `invoiceDate` (an
     *  earlier one wins a tie): where a new cell takes its period and price. */
    const nearestRow = (
      lineId: string,
      invoiceId: string,
      invoiceDate: string
    ) => {
      let best: { row: (typeof existing)[number]; distance: number } | null =
        null;
      for (const row of existing) {
        if (
          row.lineId !== lineId ||
          row.isAdjustment ||
          row.invoiceId === invoiceId ||
          row.invoiceDate === null
        ) {
          continue;
        }
        const distance = Math.abs(
          parseDate(row.invoiceDate).compare(parseDate(invoiceDate))
        );
        if (
          !best ||
          distance < best.distance ||
          (distance === best.distance &&
            row.invoiceDate < best.row.invoiceDate!)
        ) {
          best = { row, distance };
        }
      }
      return best?.row ?? null;
    };
    /** Σ the non-adjustment rows of one cell (invoice × line). */
    const cellRows = (invoiceId: string, lineId: string) =>
      existing.filter(
        (row) =>
          row.invoiceId === invoiceId &&
          row.lineId === lineId &&
          !row.isAdjustment
      );
    /**
     * Each cell becomes ONE non-adjustment row of its amount; 0 removes the
     * cell's rows (an invoice left empty is deleted below). The row keeps the
     * cell's period, else takes the line's nearest planned period, else the
     * invoice date. Units are rescaled like a split: units = source units ×
     * amount ÷ (quantity × source unit price × (1 − discount)); with no
     * source to price from it is 1 unit at the amount. One delete and one
     * insert for every cell.
     */
    const setCells = async (
      cells: {
        invoiceId: string;
        invoiceDate: string;
        lineId: string;
        amount: number;
      }[]
    ) => {
      const deleteIds: string[] = [];
      const inserts: ReturnType<typeof scheduleRowValues>[] = [];
      for (const cell of cells) {
        const line = contractLine(cell.lineId);
        const own = cellRows(cell.invoiceId, cell.lineId);
        deleteIds.push(...own.map((row) => row.id));
        touched.add(cell.invoiceId);
        const amount = round(cell.amount);
        if (equals(amount, 0)) continue;

        const nearest =
          own.length > 0
            ? null
            : nearestRow(cell.lineId, cell.invoiceId, cell.invoiceDate);
        const source = own.length > 0 ? own : nearest ? [nearest] : [];
        const periodStart =
          source.length > 0
            ? source.map((row) => row.periodStart).sort()[0]!
            : cell.invoiceDate;
        const periodEnd =
          source.length > 0
            ? source
                .map((row) => row.periodEnd)
                .sort()
                .at(-1)!
            : cell.invoiceDate;
        const sourceUnits = source.reduce((sum, row) => sum + row.units, 0);
        const sourceUnitPrice = source.reduce(
          (sum, row) => sum + row.unitPrice,
          0
        );
        const fullAmount =
          Number(line.quantity) *
          sourceUnitPrice *
          (1 - Number(line.discountPercent));
        const priced = source.length > 0 && !equals(fullAmount, 0);
        inserts.push(
          scheduleRowValues(
            scope,
            contract.id,
            {
              lineId: cell.lineId,
              periodStart,
              periodEnd,
              units: priced ? (sourceUnits * amount) / fullAmount : 1,
              unitPrice: priced ? sourceUnitPrice : amount,
              amount,
              isAdjustment: false
            },
            { invoiceId: cell.invoiceId, memoId: null }
          )
        );
      }
      if (deleteIds.length > 0) {
        await trx
          .deleteFrom("customerContractInvoiceLine")
          .where("id", "in", deleteIds)
          .where("customerContractId", "=", contract.id)
          .where("companyId", "=", companyId)
          .execute();
      }
      await insertScheduleRows(trx, inserts);
    };

    const { edit } = payload;
    switch (edit.intent) {
      case "move": {
        const invoice = plannedInvoice(edit.customerContractInvoiceId);
        const other = invoices.find(
          (i) =>
            i.id !== invoice.id &&
            i.status === "Planned" &&
            i.invoiceDate === edit.invoiceDate
        );
        if (other) {
          // Merge into the Planned invoice already on that date.
          const rowIds = existing
            .filter((row) => row.invoiceId === invoice.id)
            .map((row) => row.id);
          if (rowIds.length > 0) await moveRows(rowIds, other.id);
          touched.add(other.id);
        } else {
          await trx
            .updateTable("customerContractInvoice")
            .set({ invoiceDate: edit.invoiceDate })
            .where("id", "=", invoice.id)
            .where("customerContractId", "=", contract.id)
            .where("companyId", "=", companyId)
            .execute();
          touched.add(invoice.id);
        }
        break;
      }
      case "split": {
        const row = plannedRow(edit.customerContractInvoiceLineId);
        const total = round(
          edit.installments.reduce((sum, i) => sum + i.amount, 0)
        );
        if (!equals(total, round(row.amount))) {
          throw new InvalidInputError(
            `Installments total ${total}; the line must still total ${round(row.amount)}`
          );
        }
        const ids = await plannedInvoicesOn(
          edit.installments.map((i) => i.invoiceDate)
        );
        await insertScheduleRows(
          trx,
          edit.installments.map((installment) => {
            const units =
              row.amount === 0
                ? row.units / edit.installments.length
                : (row.units * installment.amount) / row.amount;
            const invoiceId = ids.get(
              invoiceKey(installment.invoiceDate, "Planned")
            )!;
            touched.add(invoiceId);
            return scheduleRowValues(
              scope,
              contract.id,
              {
                lineId: row.lineId,
                periodStart: row.periodStart,
                periodEnd: row.periodEnd,
                units,
                unitPrice: row.unitPrice,
                amount: installment.amount,
                isAdjustment: row.isAdjustment
              },
              { invoiceId, memoId: null }
            );
          })
        );
        await trx
          .deleteFrom("customerContractInvoiceLine")
          .where("id", "=", row.id)
          .where("customerContractId", "=", contract.id)
          .where("companyId", "=", companyId)
          .execute();
        touched.add(row.invoiceId!);
        break;
      }
      case "merge": {
        if (edit.sourceInvoiceId === edit.targetInvoiceId) {
          throw new InvalidInputError(
            "Choose a different invoice to merge into"
          );
        }
        const source = plannedInvoice(edit.sourceInvoiceId);
        const target = plannedInvoice(edit.targetInvoiceId);
        const rowIds = existing
          .filter((row) => row.invoiceId === source.id)
          .map((row) => row.id);
        if (rowIds.length > 0) await moveRows(rowIds, target.id);
        touched.add(target.id);
        break;
      }
      case "moveLine": {
        const row = plannedRow(edit.customerContractInvoiceLineId);
        const ids = await plannedInvoicesOn([edit.invoiceDate]);
        const invoiceId = ids.get(invoiceKey(edit.invoiceDate, "Planned"))!;
        if (invoiceId !== row.invoiceId) await moveRows([row.id], invoiceId);
        touched.add(invoiceId);
        touched.add(row.invoiceId!);
        break;
      }
      case "setAmount": {
        const invoice = plannedInvoice(edit.customerContractInvoiceId);
        await setCells([
          {
            invoiceId: invoice.id,
            invoiceDate: invoice.invoiceDate,
            lineId: edit.customerContractLineId,
            amount: edit.amount
          }
        ]);
        break;
      }
      case "addInvoice": {
        // One amount per line; every line must be on the contract before an
        // invoice is created for it.
        const amounts = new Map<string, number>();
        for (const { customerContractLineId, amount } of edit.amounts) {
          contractLine(customerContractLineId);
          amounts.set(
            customerContractLineId,
            (amounts.get(customerContractLineId) ?? 0) + amount
          );
        }
        // A Planned invoice already on the date takes the amounts: each adds
        // to what its cell already bills.
        const ids = await plannedInvoicesOn([edit.invoiceDate]);
        const invoiceId = ids.get(invoiceKey(edit.invoiceDate, "Planned"))!;
        await setCells(
          [...amounts]
            .filter(([, amount]) => amount > 0)
            .map(([lineId, amount]) => ({
              invoiceId,
              invoiceDate: edit.invoiceDate,
              lineId,
              amount:
                cellRows(invoiceId, lineId).reduce(
                  (sum, row) => sum + row.amount,
                  0
                ) + amount
            }))
        );
        break;
      }
      case "delete": {
        // The invoice goes with its rows (`deleteEmptyPlannedInvoices`
        // below); each line it billed shows a residual.
        const invoice = plannedInvoice(edit.customerContractInvoiceId);
        await trx
          .deleteFrom("customerContractInvoiceLine")
          .where("customerContractInvoiceId", "=", invoice.id)
          .where("customerContractId", "=", contract.id)
          .where("companyId", "=", companyId)
          .execute();
        break;
      }
    }

    if (touched.size > 0) {
      await trx
        .updateTable("customerContractInvoice")
        .set({
          isEdited: true,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "in", [...touched])
        .where("customerContractId", "=", contract.id)
        .where("companyId", "=", companyId)
        .where("status", "=", "Planned")
        .execute();
    }
    await deleteEmptyPlannedInvoices(trx, scope, contract.id);

    return { customerContractId: contract.id };
  });
}

async function resetSchedule(
  db: Db,
  scope: Scope,
  payload: Payload<"reset-schedule">
): Promise<{ customerContractId: string }> {
  const { companyId } = scope;
  return db.transaction().execute(async (trx) => {
    const { contract } = await loadContractForUpdate(
      trx,
      companyId,
      payload.customerContractId
    );
    refuseUnless(contract, "Draft", "reset");
    await trx
      .deleteFrom("customerContractInvoiceLine")
      .where("customerContractId", "=", contract.id)
      .where("companyId", "=", companyId)
      .execute();
    await trx
      .deleteFrom("customerContractInvoice")
      .where("customerContractId", "=", contract.id)
      .where("companyId", "=", companyId)
      .execute();
    return { customerContractId: contract.id };
  });
}

// ---------------------------------------------------------------------------
// edit-revenue (plan D11)

/** Edits a Draft's revenue plan. Rows are keyed by (line, month). The first
 *  edit writes the live plan (D1), then applies the edit; `reset` deletes
 *  every row, so the page plans live again. */
async function editRevenue(
  db: Db,
  scope: Scope,
  payload: Payload<"edit-revenue">
): Promise<{ customerContractId: string }> {
  const { companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const { contract, lines } = await loadContractForUpdate(
      trx,
      companyId,
      payload.customerContractId
    );
    refuseUnless(contract, "Draft", "edited");
    const { edit } = payload;

    const deleteRevenue = () =>
      trx
        .deleteFrom("customerContractRevenue")
        .where("customerContractId", "=", contract.id)
        .where("companyId", "=", companyId);

    if (edit.intent === "reset") {
      await deleteRevenue().execute();
      return { customerContractId: contract.id };
    }

    const lineIds = new Set(lines.map((line) => line.id));
    const named =
      edit.intent === "setAmount"
        ? [edit.customerContractLineId]
        : edit.intent === "addMonth"
          ? edit.amounts.map((a) => a.customerContractLineId)
          : [];
    if (named.some((lineId) => !lineIds.has(lineId))) {
      throw new NotFoundError("Contract line not found");
    }
    const { periodStart } = edit;
    let periodEnd: string;
    try {
      periodEnd = monthEnd(periodStart);
    } catch {
      throw new InvalidInputError(`${periodStart} is not a date`);
    }
    if (monthStart(periodStart) !== periodStart) {
      throw new InvalidInputError(
        `${periodStart} is not the first day of a month`
      );
    }

    // The first edit writes the live plan.
    if (!(await hasStoredRevenue(trx, scope, contract.id))) {
      await materializeRevenue(trx, scope, contract, lines, {
        through: horizon(toTerms(contract), payload.asOf)
      });
    }

    // A month before "Recognize revenue from" was recognized elsewhere.
    const status: Enums["contractRevenueStatus"] =
      contract.recognizeRevenueFrom !== null &&
      periodStart < monthStart(contract.recognizeRevenueFrom)
        ? "Recognized Externally"
        : "Planned";
    const rowValues = (lineId: string, amount: number) => ({
      customerContractId: contract.id,
      customerContractLineId: lineId,
      periodStart,
      periodEnd,
      amount: round(amount),
      status,
      companyId,
      createdBy: userId
    });
    const conflictKey = [
      "companyId",
      "customerContractLineId",
      "periodStart"
    ] as const;

    switch (edit.intent) {
      case "setAmount": {
        if (equals(round(edit.amount), 0)) {
          await deleteRevenue()
            .where("customerContractLineId", "=", edit.customerContractLineId)
            .where("periodStart", "=", periodStart)
            .execute();
          break;
        }
        await trx
          .insertInto("customerContractRevenue")
          .values(rowValues(edit.customerContractLineId, edit.amount))
          .onConflict((oc) =>
            oc.columns([...conflictKey]).doUpdateSet({
              amount: round(edit.amount),
              updatedBy: userId,
              updatedAt: datetime.timestamp()
            })
          )
          .execute();
        break;
      }
      case "addMonth": {
        // Each amount adds to what the line already recognizes that month.
        const amounts = new Map<string, number>();
        for (const { customerContractLineId, amount } of edit.amounts) {
          amounts.set(
            customerContractLineId,
            (amounts.get(customerContractLineId) ?? 0) + amount
          );
        }
        const values = [...amounts]
          .filter(([, amount]) => !equals(round(amount), 0))
          .map(([lineId, amount]) => rowValues(lineId, amount));
        if (values.length === 0) break;
        await trx
          .insertInto("customerContractRevenue")
          .values(values)
          .onConflict((oc) =>
            oc.columns([...conflictKey]).doUpdateSet({
              amount: sql`"customerContractRevenue"."amount" + excluded."amount"`,
              updatedBy: userId,
              updatedAt: datetime.timestamp()
            })
          )
          .execute();
        // A month the amounts brought to 0 has nothing left to recognize.
        await deleteRevenue()
          .where("periodStart", "=", periodStart)
          .where("amount", "=", 0)
          .execute();
        break;
      }
      case "deleteMonth": {
        await deleteRevenue().where("periodStart", "=", periodStart).execute();
        break;
      }
    }

    return { customerContractId: contract.id };
  });
}

// ---------------------------------------------------------------------------
// amend (Task 10)

/** Thrown inside a preview's transaction so nothing commits; carries the
 *  preview out of it. */
class PreviewRollback<T> extends Error {
  constructor(readonly result: T) {
    super("preview rollback");
  }
}

/** Runs `body` in one transaction. A preview throws `PreviewRollback`, which
 *  rolls everything back and is returned here as the result. */
async function inTransaction<R, P>(
  db: Db,
  body: (trx: KyselyTx) => Promise<R>
): Promise<R | P> {
  try {
    return await db.transaction().execute(body);
  } catch (error) {
    if (error instanceof PreviewRollback) return error.result as P;
    throw error;
  }
}

type ScheduleRowView = {
  lineId: string;
  periodStart: string;
  periodEnd: string;
  units: number;
  unitPrice: number;
  amount: number;
  isAdjustment: boolean;
};

export type ContractAmendmentPreview = {
  effectiveDate: string;
  adjustments: ScheduleRowView[];
  /** The first two Planned invoices on or after the effective date. */
  nextInvoices: {
    invoiceDate: string;
    total: number;
    rows: ScheduleRowView[];
  }[];
  suggestedType: Enums["customerContractType"];
  /** Edited invoices the amendment deletes and re-plans. */
  resetsEditedInvoices: number;
};

const rowView = (row: ScheduleRowView): ScheduleRowView => ({
  lineId: row.lineId,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  units: row.units,
  unitPrice: row.unitPrice,
  amount: row.amount,
  isAdjustment: row.isAdjustment
});

/** Effective dates of an amendment for one existing line. A Recurring line
 *  changes from the effective date (or its own start, when later). A One-time
 *  line has no time to split: the replacement takes over the whole line, so
 *  the old one ends the day before it starts and plans nothing. */
function lineCutover(line: ContractLineRow, effective: string) {
  if (line.revenueType === "One-time") {
    return { oldEnd: addDays(line.startDate, -1), newStart: line.startDate };
  }
  const newStart = maxDate(effective, line.startDate);
  return { oldEnd: addDays(newStart, -1), newStart };
}

async function amend(
  db: Db,
  scope: Scope,
  payload: Payload<"amend">
): Promise<{ amendmentId: string } | ContractAmendmentPreview> {
  const { companyId, userId } = scope;
  return inTransaction<{ amendmentId: string }, ContractAmendmentPreview>(
    db,
    async (trx) => {
      const loaded = await loadContractForUpdate(
        trx,
        companyId,
        payload.customerContractId
      );
      const { contract, lines, existing, invoices } = loaded;
      refuseUnless(contract, "Active", "amended");
      // A contract confirmed before revenue was stored gets its plan written
      // from the terms it had, so the reconciliation below keeps its past.
      await ensureRevenue(trx, scope, contract, lines);
      const billedBefore = await billedTotals(trx, scope, contract.id);

      const terms = toTerms(contract);
      const through = reconcileThrough(
        horizon(terms, payload.asOf),
        existing,
        lines
      );
      const effective = amendmentEffectiveDate(
        terms,
        payload.effect,
        payload.amendmentDate,
        through
      );

      const lineById = new Map(lines.map((line) => [line.id, line]));
      const invoicedLineIds = new Set(
        existing
          .filter(
            (row) => row.invoiceStatus === "Invoiced" && !row.isAdjustment
          )
          .map((row) => row.lineId)
      );
      const label = (line: ContractLineRow) =>
        line.description ?? `Line ${line.id}`;
      const touchedLines = new Set<string>();
      const openLine = (lineId: string) => {
        const line = lineById.get(lineId);
        if (!line) throw new NotFoundError("Contract line not found");
        if (touchedLines.has(lineId)) {
          throw new InvalidInputError(`${label(line)} is changed twice`);
        }
        touchedLines.add(lineId);
        if (line.endDate !== null && line.endDate < effective) {
          throw new InvalidInputError(
            `${label(line)} already ended on ${line.endDate}`
          );
        }
        if (line.revenueType === "One-time" && invoicedLineIds.has(line.id)) {
          throw new InvalidInputError(
            `${label(line)} is a one-time line that has been invoiced; it cannot be changed`
          );
        }
        return line;
      };

      // Added lines must be Service items of this company.
      const added = payload.changes.flatMap((change) =>
        change.op === "add" ? [change.line] : []
      );
      if (added.length > 0) {
        const items = await trx
          .selectFrom("item")
          .select(["id", "type"])
          .where("id", "in", [...new Set(added.map((line) => line.itemId))])
          .where("companyId", "=", companyId)
          .execute();
        const typeById = new Map(items.map((item) => [item.id, item.type]));
        for (const line of added) {
          const type = typeById.get(line.itemId);
          if (!type) throw new NotFoundError("Item not found");
          if (type !== "Service") {
            throw new InvalidInputError(
              "Only Service items can be on a contract"
            );
          }
        }
      }

      // The next line set: end dates to write and lines to insert.
      const ends: { id: string; endDate: string }[] = [];
      const inserts: { fields: LineFields; overrides: Partial<LineFields> }[] =
        [];
      for (const change of payload.changes) {
        if (change.op === "change") {
          const line = openLine(change.lineId);
          if (
            line.revenueType === "One-time" &&
            change.rateUnit !== undefined
          ) {
            throw new InvalidInputError(
              `${label(line)} is a one-time line; it has no rate unit`
            );
          }
          const { oldEnd, newStart } = lineCutover(line, effective);
          ends.push({ id: line.id, endDate: oldEnd });
          inserts.push({
            fields: line,
            overrides: {
              ...(change.quantity !== undefined && {
                quantity: change.quantity
              }),
              ...(change.rate !== undefined && { rate: change.rate }),
              ...(change.rateUnit !== undefined && {
                rateUnit: change.rateUnit
              }),
              ...(change.discountPercent !== undefined && {
                discountPercent: fraction(change.discountPercent)
              }),
              ...(change.taxPercent !== undefined && {
                taxPercent: fraction(change.taxPercent)
              }),
              ...(change.description !== undefined && {
                description: change.description || null
              }),
              ...(change.revenueMethod !== undefined && {
                revenueMethod: change.revenueMethod
              }),
              ...(change.projectId !== undefined && {
                projectId: change.projectId || null
              }),
              ...carriedRevenueDates(line, newStart),
              startDate: newStart,
              discountEndsOn:
                line.discountEndsOn !== null && line.discountEndsOn >= newStart
                  ? line.discountEndsOn
                  : null,
              amendsLineId: line.id
            }
          });
        } else if (change.op === "end") {
          const line = openLine(change.lineId);
          ends.push({
            id: line.id,
            endDate: lineCutover(line, effective).oldEnd
          });
        } else {
          const line = change.line;
          const startDate = maxDate(line.startDate, effective);
          const name = line.description || "The added line";
          if (line.endDate !== undefined && line.endDate < startDate) {
            throw new InvalidInputError(
              `${name} ends on ${line.endDate}, before it starts on ${startDate}`
            );
          }
          if (
            line.discountEndsOn !== undefined &&
            line.discountEndsOn < startDate
          ) {
            throw new InvalidInputError(
              `${name}'s discount ends on ${line.discountEndsOn}, before the line starts on ${startDate}`
            );
          }
          inserts.push({
            fields: {
              customerContractId: contract.id,
              revenueType: line.revenueType,
              itemId: line.itemId,
              description: line.description || null,
              quantity: line.quantity,
              rate: line.rate,
              rateUnit: line.rateUnit ?? null,
              discountPercent: fraction(line.discountPercent),
              discountEndsOn: line.discountEndsOn ?? null,
              taxPercent: fraction(line.taxPercent),
              startDate,
              endDate: line.endDate ?? null,
              goLiveDate: line.goLiveDate ?? null,
              revenueMethod: line.revenueMethod,
              revenueStartDate: line.revenueStartDate ?? null,
              revenueEndDate: line.revenueEndDate ?? null,
              amendmentId: null,
              amendsLineId: null,
              projectId: line.projectId || null,
              sortOrder: null,
              customFields: null
            },
            overrides: {}
          });
        }
      }

      // Suggested type, from the recurring value per period before and after.
      const endById = new Map(ends.map((end) => [end.id, end.endDate]));
      const before = recurringValuePerPeriod(
        toLineTerms(lines),
        contract.billingFrequency,
        effective
      );
      const after = recurringValuePerPeriod(
        [
          ...toLineTerms(
            lines.map((line) => ({
              ...line,
              endDate: endById.get(line.id) ?? line.endDate
            }))
          ),
          ...toLineTerms(
            inserts.map(({ fields, overrides }, index) => ({
              ...fields,
              ...overrides,
              id: `new-${index}`
            }))
          )
        ],
        contract.billingFrequency,
        effective
      );
      const suggestedType = suggestAmendmentType(before, after);

      // Write: the amendment, the end dates, the new lines.
      const amendment = await trx
        .insertInto("customerContractAmendment")
        .values({
          customerContractId: contract.id,
          amendmentDate: effective,
          effect: payload.effect,
          contractType: payload.contractType,
          reason: payload.reason,
          previousState: null,
          companyId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      await setLineEndDates(trx, scope, contract.id, ends);
      if (inserts.length > 0) {
        await trx
          .insertInto("customerContractLine")
          .values(
            inserts.map(({ fields, overrides }) =>
              copyLineValues(scope, fields, {
                ...overrides,
                amendmentId: amendment.id
              })
            )
          )
          .execute();
      }

      // A discount on a new line that ends inside it is split off now, as at
      // confirm — nothing else would ever end it. Each split starts after
      // the effective date, so the one reconciliation below covers it.
      await applyDiscountEnds(trx, scope, contract);

      // Reconcile the schedule from the effective date.
      const next = await loadContractForUpdate(trx, companyId, contract.id);
      const result = reconcileContractSchedule({
        terms: toTerms(next.contract),
        lines: toLineTerms(next.lines),
        existing: next.existing,
        from: effective,
        through
      });
      const editedIds = new Set(
        invoices.filter((invoice) => invoice.isEdited).map((i) => i.id)
      );
      const resetsEditedInvoices = result.deleteInvoiceIds.filter((id) =>
        editedIds.has(id)
      ).length;
      await applyReconciliation(trx, scope, contract.id, result);

      // Reconcile the revenue of every line the amendment changed (D9).
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
        effective
      );

      if (payload.preview) {
        const after = await loadSchedule(trx, companyId, contract.id);
        const nextInvoices = after.invoices
          .filter(
            (invoice) =>
              invoice.status === "Planned" && invoice.invoiceDate >= effective
          )
          .slice(0, 2)
          .map((invoice) => {
            const rows = after.existing
              .filter((row) => row.invoiceId === invoice.id)
              .map(rowView);
            return {
              invoiceDate: invoice.invoiceDate,
              total: round(rows.reduce((sum, row) => sum + row.amount, 0)),
              rows
            };
          });
        throw new PreviewRollback<ContractAmendmentPreview>({
          effectiveDate: effective,
          adjustments: result.adjustments.map(rowView),
          nextInvoices,
          suggestedType,
          resetsEditedInvoices
        });
      }

      return { amendmentId: amendment.id };
    }
  );
}

// ---------------------------------------------------------------------------
// cancel / revert-cancellation (Task 11)

/** What a cancellation changed, stored on its amendment so it can be
 *  reverted (plan decision 11). */
const previousStateSchema = z.object({
  contractEndDate: z.string().nullable(),
  renewal: z.enum(["Renew", "End"]),
  lineEndDates: z.record(z.string(), z.string().nullable()),
  /** The revenue end of every line whose revenue end the new end clamped
   *  (`setLineEndDates`). Absent on cancellations recorded before it. */
  lineRevenueEndDates: z.record(z.string(), z.string()).optional()
});
type PreviousState = z.infer<typeof previousStateSchema>;

const CANCELLATION_REASON_PREFIX = "Cancellation";

export type ContractCancellationPreview = {
  /** The unused billed time a credit memo would credit (positive). */
  credit: number;
  creditAvailable: boolean;
  /** Planned invoices the cancellation deletes. */
  removedInvoices: number;
};

export type ContractCancellationResult = {
  customerContractId: string;
  /** The Draft credit memo, when unused time was credited. */
  memoId: string | null;
  memoReadableId: string | null;
};

async function cancel(
  db: Db,
  scope: Scope,
  payload: Payload<"cancel">
): Promise<ContractCancellationResult | ContractCancellationPreview> {
  const { companyId, userId } = scope;
  const { endDate } = payload;

  return inTransaction<ContractCancellationResult, ContractCancellationPreview>(
    db,
    async (trx) => {
      // 1. Lock, load, refuse.
      const { contract, lines, existing } = await loadContractForUpdate(
        trx,
        companyId,
        payload.customerContractId
      );
      refuseUnless(contract, "Active", "cancelled");
      if (contract.endDate !== null && endDate >= contract.endDate) {
        throw new InvalidInputError(
          `The contract already ends on ${contract.endDate}; choose an earlier end date`
        );
      }
      if (endDate < addDays(contract.startDate, -1)) {
        throw new InvalidInputError(
          `The end date can be at most one day before the contract starts (${contract.startDate})`
        );
      }
      if (endDate < contract.startDate) {
        const invoiced = existing
          .filter((row) => row.invoiceStatus === "Invoiced")
          .map((row) => row.periodStart)
          .sort();
        if (invoiced.length > 0) {
          throw new InvalidInputError(
            `Invoices exist — cancel on or after ${invoiced[0]}`
          );
        }
      }

      // A contract confirmed before revenue was stored gets its plan first.
      await ensureRevenue(trx, scope, contract, lines);
      const billedBefore = await billedTotals(trx, scope, contract.id);

      // 2. End every line that runs past the new end, remembering its end.
      const previousState: PreviousState = {
        contractEndDate: contract.endDate,
        renewal: contract.renewal,
        lineEndDates: {},
        lineRevenueEndDates: {}
      };
      const ends: { id: string; endDate: string }[] = [];
      for (const line of lines) {
        if (line.endDate !== null && line.endDate <= endDate) continue;
        const lineEnd = maxDate(endDate, addDays(line.startDate, -1));
        previousState.lineEndDates[line.id] = line.endDate;
        if (line.revenueEndDate !== null && line.revenueEndDate > lineEnd) {
          previousState.lineRevenueEndDates![line.id] = line.revenueEndDate;
        }
        ends.push({ id: line.id, endDate: lineEnd });
      }
      await setLineEndDates(trx, scope, contract.id, ends);

      // 3. The contract ends (and is Ended at once when cancelled to nothing).
      const now = datetime.timestamp();
      const endsNow = endDate < contract.startDate;
      await trx
        .updateTable("customerContract")
        .set({
          endDate,
          renewal: "End",
          cancelledAt: now,
          cancellationReason: payload.reason,
          ...(endsNow && { status: "Ended" as const, endedAt: now }),
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", contract.id)
        .where("companyId", "=", companyId)
        .execute();

      // 4. The amendment that records it.
      await trx
        .insertInto("customerContractAmendment")
        .values({
          customerContractId: contract.id,
          amendmentDate: addDays(endDate, 1),
          effect: "Change Date",
          contractType: "Contraction",
          reason: `${CANCELLATION_REASON_PREFIX}: ${payload.reason}`,
          previousState: toJson(previousState),
          companyId,
          createdBy: userId
        })
        .execute();

      // 5. Reconcile from the day after the new end.
      const next = await loadContractForUpdate(trx, companyId, contract.id);
      const result = reconcileContractSchedule({
        terms: toTerms(next.contract),
        lines: toLineTerms(next.lines),
        existing: next.existing,
        from: addDays(endDate, 1),
        through: reconcileThrough(
          horizon(toTerms(next.contract), payload.asOf),
          next.existing,
          next.lines
        )
      });
      const credit = round(
        -result.adjustments.reduce((sum, row) => sum + row.amount, 0)
      );
      const creditAvailable = result.adjustments.length > 0;

      if (payload.preview) {
        throw new PreviewRollback<ContractCancellationPreview>({
          credit,
          creditAvailable,
          removedInvoices: result.deleteInvoiceIds.length
        });
      }

      // 6. The credit memo, or no credit at all.
      let memoId: string | null = null;
      let memoReadableId: string | null = null;
      let adjustments = result.adjustments;
      if (payload.creditUnusedTime && creditAvailable) {
        const currency = await trx
          .selectFrom("currency")
          .innerJoin(
            "company",
            "company.companyGroupId",
            "currency.companyGroupId"
          )
          .select("currency.decimalPlaces")
          .where("company.id", "=", companyId)
          .where("currency.code", "=", contract.currencyCode)
          .executeTakeFirst();
        if (!currency) {
          throw new InvalidInputError(
            `Currency ${contract.currencyCode} is not set up for this company`
          );
        }
        // A memo total is a settlement value (currency decimals). Its rows
        // are apportioned to the same decimals so they sum to it exactly —
        // posting the memo refuses rows that credit more than its amount.
        const amount = round(credit, currency.decimalPlaces);
        const apportioned = distributeRoundingResidual(
          adjustments.map((row) => row.amount),
          -amount,
          currency.decimalPlaces
        );
        adjustments = adjustments.map((row, index) => ({
          ...row,
          amount: apportioned[index]!
        }));
        // Allocated in this transaction, so a rollback leaves no gap.
        memoReadableId = await getNextSequence(trx, "creditMemo", companyId);
        const memo = await trx
          .insertInto("memo")
          .values({
            memoId: memoReadableId,
            direction: "Credit",
            status: "Draft",
            customerId: contract.invoiceCustomerId ?? contract.customerId,
            memoDate: payload.asOf,
            currencyCode: contract.currencyCode,
            exchangeRate: contract.exchangeRate,
            amount,
            reference: contract.customerContractId,
            customerContractId: contract.id,
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();
        memoId = memo.id;
      }
      await applyReconciliation(
        trx,
        scope,
        contract.id,
        { ...result, adjustments: memoId ? adjustments : [] },
        { adjustmentMemoId: memoId }
      );

      // 7. Reconcile revenue from the new end (D9): months after it are
      // removed, the month it falls in is re-cut, and a month already
      // recognized past it is caught up in the next Planned month (D7).
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
        endDate
      );

      return {
        customerContractId: contract.id,
        memoId,
        memoReadableId
      };
    }
  );
}

async function revertCancellation(
  db: Db,
  scope: Scope,
  payload: Payload<"revert-cancellation">
): Promise<{ customerContractId: string }> {
  const { companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const { contract, lines, existing } = await loadContractForUpdate(
      trx,
      companyId,
      payload.customerContractId
    );
    if (!contract.cancelledAt) {
      throw new InvalidInputError(
        `Contract ${contract.customerContractId} is not cancelled`
      );
    }
    refuseUnless(contract, "Active", "reverted");
    const cancelledEndDate = contract.endDate;
    if (cancelledEndDate === null || payload.asOf > cancelledEndDate) {
      throw new InvalidInputError(
        "The cancellation has taken effect; it can no longer be reverted"
      );
    }

    const memoIds = [
      ...new Set(
        existing
          .map((row) => row.memoId)
          .filter((memoId): memoId is string => memoId !== null)
      )
    ];
    if (memoIds.length > 0) {
      const memos = await trx
        .selectFrom("memo")
        .select(["id", "status"])
        .where("id", "in", memoIds)
        .where("companyId", "=", companyId)
        .execute();
      if (memos.some((memo) => memo.status !== "Draft")) {
        throw new InvalidInputError("The credit memo has been posted");
      }
    }

    // The cancellation is the amendment that recorded what it changed —
    // only a cancellation writes `previousState` (a reason is free text).
    const amendment = await trx
      .selectFrom("customerContractAmendment")
      .select(["id", "previousState"])
      .where("customerContractId", "=", contract.id)
      .where("companyId", "=", companyId)
      .where("previousState", "is not", null)
      .orderBy("createdAt", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();
    const parsed = previousStateSchema.safeParse(amendment?.previousState);
    if (!amendment || !parsed.success) {
      throw new InvalidInputError(
        "The cancellation has no record of what it changed; it cannot be reverted"
      );
    }
    const previous = parsed.data;

    // Restoring the recorded end dates is only right while nothing has
    // changed the lines since. An amendment after the cancellation ended a
    // line and started its replacement inside the cancelled term: restoring
    // the old line's end would bill both. Ordered by `createdAt` (when the
    // action ran), not `amendmentDate`: a later amendment is effective on or
    // before the cancelled end, so it always dates EARLIER than the
    // cancellation (end + 1) and an effective-date order would miss it.
    // Compared in SQL: a JS `Date` would cut the timestamp to milliseconds.
    const newer = await trx
      .selectFrom("customerContractAmendment")
      .select("id")
      .where("customerContractId", "=", contract.id)
      .where("companyId", "=", companyId)
      .where("id", "!=", amendment.id)
      .where("createdAt", ">", (eb) =>
        eb
          .selectFrom("customerContractAmendment as cancellation")
          .select("cancellation.createdAt")
          .where("cancellation.id", "=", amendment.id)
          .where("cancellation.companyId", "=", companyId)
      )
      .executeTakeFirst();
    if (newer) {
      throw new InvalidInputError(
        "The contract was amended after it was cancelled; the cancellation can no longer be reverted"
      );
    }
    const lineIds = new Set(lines.map((line) => line.id));
    if (Object.keys(previous.lineEndDates).some((id) => !lineIds.has(id))) {
      throw new InvalidInputError(
        "A line the cancellation ended no longer exists; the cancellation can no longer be reverted"
      );
    }

    // A contract confirmed before revenue was stored gets its plan first.
    await ensureRevenue(trx, scope, contract, lines);
    const billedBefore = await billedTotals(trx, scope, contract.id);

    // 1. Restore the line end dates (and the revenue ends they clamped),
    // the contract's end and renewal.
    const revenueEnds = previous.lineRevenueEndDates ?? {};
    await setLineEndDates(
      trx,
      scope,
      contract.id,
      Object.entries(previous.lineEndDates).map(([id, endDate]) => ({
        id,
        endDate,
        ...(revenueEnds[id] !== undefined && {
          revenueEndDate: revenueEnds[id]
        })
      }))
    );
    // 2. Clear the cancellation.
    const now = datetime.timestamp();
    await trx
      .updateTable("customerContract")
      .set({
        endDate: previous.contractEndDate,
        renewal: previous.renewal,
        cancelledAt: null,
        cancellationReason: null,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", contract.id)
      .where("companyId", "=", companyId)
      .execute();

    // 3. The memo-borne rows and the Draft memo, then the amendment.
    if (memoIds.length > 0) {
      await trx
        .deleteFrom("customerContractInvoiceLine")
        .where("memoId", "in", memoIds)
        .where("customerContractId", "=", contract.id)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .deleteFrom("memo")
        .where("id", "in", memoIds)
        .where("status", "=", "Draft")
        .where("companyId", "=", companyId)
        .execute();
    }
    await trx
      .deleteFrom("customerContractAmendment")
      .where("id", "=", amendment.id)
      .where("companyId", "=", companyId)
      .execute();

    // 4. Re-plan from the day after the cancelled end.
    const next = await loadContractForUpdate(trx, companyId, contract.id);
    await applyReconciliation(
      trx,
      scope,
      contract.id,
      reconcileContractSchedule({
        terms: toTerms(next.contract),
        lines: toLineTerms(next.lines),
        existing: next.existing,
        from: addDays(cancelledEndDate, 1),
        through: reconcileThrough(
          horizon(toTerms(next.contract), payload.asOf),
          next.existing,
          next.lines
        )
      })
    );

    // 5. Re-plan revenue from the cancelled end date (D9).
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
      cancelledEndDate
    );

    return { customerContractId: contract.id };
  });
}

// ---------------------------------------------------------------------------

/** Confirms, edits the schedule of, amends, cancels or reverts the
 *  cancellation of a customer contract, per `type`. */
const postCustomerContract = defineServerFn({
  name: "post-customer-contract",
  input: postCustomerContractInput,
  // Kysely below bypasses RLS. The confirm route also checks
  // `create: "invoicing"` itself when the contract's mode posts (spec
  // decision 29).
  permissions: { update: "sales" },
  async run({ db, companyId, userId }, payload) {
    const scope = { companyId, userId };
    switch (payload.type) {
      case "confirm":
        return confirm(db, scope, payload);
      case "edit-schedule":
        return editSchedule(db, scope, payload);
      case "reset-schedule":
        return resetSchedule(db, scope, payload);
      case "edit-revenue":
        return editRevenue(db, scope, payload);
      case "amend":
        return amend(db, scope, payload);
      case "cancel":
        return cancel(db, scope, payload);
      case "revert-cancellation":
        return revertCancellation(db, scope, payload);
    }
  }
});

export type { LoadedContract };
export default postCustomerContract;
