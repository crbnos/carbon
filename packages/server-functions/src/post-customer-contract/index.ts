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
//                         row. The first edit materializes the schedule.
//   reset-schedule        Draft only: drop the persisted schedule; the page
//                         goes back to the live preview.
//   amend                 Active: change, add or end lines from an effective
//                         date, then reconcile the schedule (preview rolls back).
//   cancel                Active: end the contract early, optionally crediting
//                         unused billed time on a Draft credit memo.
//   revert-cancellation   Undo a cancellation while its memo is still Draft.
//
// Spec: .ai/specs/2026-10-02-contracts.md; plan:
// .ai/plans/2026-10-03-contracts-phase-a.md Tasks 9–11.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  amendmentEffectiveDate,
  horizon,
  lineTotals,
  planInvoiceSchedule,
  reconcileContractSchedule,
  recurringValuePerPeriod,
  suggestAmendmentType,
  validateScheduleEdit
} from "@carbon/database/contract-schedule";
import { toJson } from "@carbon/database/json";
import { equals, round } from "@carbon/database/precision";
import { getNextSequence } from "@carbon/database/sequence";
import { datetime, effectiveInvoiceAutomation } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import {
  applyReconciliation,
  type ContractLineRow,
  type ContractRow,
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
const contractLineKinds = [
  "One-time",
  "Recurring"
] as const satisfies readonly Enums["customerContractLineKind"][];
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
 *  `customerContractScheduleEditValidator` minus `reset`. */
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
      .array(z.object({ invoiceDate: isoDate, amount: z.number() }))
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
  })
]);

/** Percentages are percent points (0–100), as the ERP's
 *  `contractAmendmentChangeValidator` parses them; divided by 100 here. */
const percentPoints = z.number().min(0).max(100);

const amendmentLine = z
  .object({
    kind: z.enum(contractLineKinds),
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
  .refine((line) => (line.kind === "Recurring") === !!line.rateUnit, {
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

/** Sets each line's `endDate` in one statement. */
async function setLineEndDates(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  ends: { id: string; endDate: string | null }[]
): Promise<void> {
  if (ends.length === 0) return;
  const values = ends.map(
    (end) => sql`(${end.id}::text, ${end.endDate}::date)`
  );
  await sql`
    UPDATE "customerContractLine" AS l
    SET "endDate" = v."endDate",
        "updatedBy" = ${scope.userId},
        "updatedAt" = now()
    FROM (VALUES ${sql.join(values)}) AS v("id", "endDate")
    WHERE l."id" = v."id"
      AND l."companyId" = ${scope.companyId}
      AND l."customerContractId" = ${contractId}
  `.execute(trx);
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
      if (line.kind === "Recurring" && !line.rateUnit) {
        problems.push(`${label}: a recurring line needs a rate unit`);
      }
    }
    if (problems.length > 0) throw new InvalidInputError(problems.join("; "));

    const terms = toTerms(contract);
    const through = horizon(terms, payload.asOf);

    // 2. Materialize an unedited schedule, or check an edited one still
    // bills every line's total. An open-ended contract's persisted schedule
    // was planned to an earlier horizon, so it is compared over the span it
    // covers.
    if (existing.length === 0) {
      await materializeSchedule(trx, scope, contract, lines, through);
    } else {
      const compareThrough = terms.endDate
        ? through
        : existing.reduce(
            (latest, row) => (row.periodEnd > latest ? row.periodEnd : latest),
            existing[0]!.periodEnd
          );
      const { ok, residuals } = validateScheduleEdit(
        lineTotals(
          planInvoiceSchedule(terms, toLineTerms(lines), compareThrough)
        ),
        existing
      );
      if (!ok) {
        const lineLabel = (lineId: string) => {
          const line = lines.find((l) => l.id === lineId);
          return (
            line?.description ??
            (line ? itemById.get(line.itemId)?.readableIdWithRevision : null) ??
            lineId
          );
        };
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
    // and a full-price copy starts the next.
    const discounted = lines.filter(
      (line) =>
        line.kind === "Recurring" &&
        line.discountEndsOn !== null &&
        addDays(line.discountEndsOn, 1) <=
          (line.endDate ?? contract.endDate ?? "9999-12-31")
    );
    if (discounted.length > 0) {
      const lineTerms = toLineTerms(lines);
      const amendments = await trx
        .insertInto("customerContractAmendment")
        .values(
          discounted.map((line) => {
            const amendmentDate = addDays(line.discountEndsOn!, 1);
            const before = recurringValuePerPeriod(
              lineTerms,
              contract.billingFrequency,
              amendmentDate
            );
            const after = recurringValuePerPeriod(
              [
                ...lineTerms.filter((l) => l.id !== line.id),
                {
                  ...lineTerms.find((l) => l.id === line.id)!,
                  discountPercent: 0,
                  startDate: amendmentDate
                }
              ],
              contract.billingFrequency,
              amendmentDate
            );
            return {
              customerContractId: contract.id,
              amendmentDate,
              effect: "Change Date" as const,
              contractType: suggestAmendmentType(before, after),
              reason: "Discount ends",
              previousState: null,
              companyId,
              createdBy: userId
            };
          })
        )
        .returning(["id"])
        .execute();

      await setLineEndDates(
        trx,
        scope,
        contract.id,
        discounted.map((line) => ({
          id: line.id,
          endDate: line.discountEndsOn
        }))
      );
      await trx
        .insertInto("customerContractLine")
        .values(
          discounted.map((line, index) =>
            copyLineValues(scope, line, {
              startDate: addDays(line.discountEndsOn!, 1),
              discountPercent: 0,
              discountEndsOn: null,
              amendmentId: amendments[index]!.id,
              amendsLineId: line.id
            })
          )
        )
        .execute();

      // One reconciliation from the earliest change: Planned invoices from
      // that date on are re-planned against every new line at once.
      const from = discounted
        .map((line) => addDays(line.discountEndsOn!, 1))
        .sort()[0]!;
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
          from,
          through: reconcileThrough(through, existing)
        })
      );
    }

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

    const plannedInvoice = (id: string) => {
      const invoice = invoices.find((i) => i.id === id);
      if (!invoice) throw new NotFoundError("Planned invoice not found");
      if (invoice.status !== "Planned") {
        throw new InvalidInputError(
          `The ${invoice.invoiceDate} invoice is ${invoice.status}; only a Planned invoice can be edited`
        );
      }
      return invoice;
    };
    const plannedRow = (id: string) => {
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
  if (line.kind === "One-time") {
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

      const terms = toTerms(contract);
      const through = reconcileThrough(horizon(terms, payload.asOf), existing);
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
        if (line.kind === "One-time" && invoicedLineIds.has(line.id)) {
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
                discountPercent: change.discountPercent / 100
              }),
              ...(change.taxPercent !== undefined && {
                taxPercent: change.taxPercent / 100
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
          inserts.push({
            fields: {
              customerContractId: contract.id,
              kind: line.kind,
              itemId: line.itemId,
              description: line.description || null,
              quantity: line.quantity,
              rate: line.rate,
              rateUnit: line.rateUnit ?? null,
              discountPercent: line.discountPercent / 100,
              discountEndsOn: line.discountEndsOn ?? null,
              taxPercent: line.taxPercent / 100,
              startDate: maxDate(line.startDate, effective),
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
  lineEndDates: z.record(z.string(), z.string().nullable())
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

  // Resolved before the transaction (and only when a memo may be written).
  const memoReadableId =
    payload.creditUnusedTime && !payload.preview
      ? await db
          .transaction()
          .execute((trx) => getNextSequence(trx, "creditMemo", companyId))
      : null;

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

      // 2. End every line that runs past the new end, remembering its end.
      const previousState: PreviousState = {
        contractEndDate: contract.endDate,
        renewal: contract.renewal,
        lineEndDates: {}
      };
      const ends: { id: string; endDate: string }[] = [];
      for (const line of lines) {
        if (line.endDate !== null && line.endDate <= endDate) continue;
        previousState.lineEndDates[line.id] = line.endDate;
        ends.push({
          id: line.id,
          endDate: maxDate(endDate, addDays(line.startDate, -1))
        });
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
          next.existing
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
      if (payload.creditUnusedTime && creditAvailable && memoReadableId) {
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
            // A memo total is a settlement value (currency decimals); the
            // memo-borne rows keep internal precision.
            amount: round(credit, currency?.decimalPlaces ?? 2),
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
        memoId ? result : { ...result, adjustments: [] },
        { adjustmentMemoId: memoId }
      );

      return {
        customerContractId: contract.id,
        memoId,
        memoReadableId: memoId ? memoReadableId : null
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

    const amendment = await trx
      .selectFrom("customerContractAmendment")
      .select(["id", "previousState"])
      .where("customerContractId", "=", contract.id)
      .where("companyId", "=", companyId)
      .where("reason", "like", `${CANCELLATION_REASON_PREFIX}%`)
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

    // 1. Restore the line end dates, the contract's end and renewal.
    const lineIds = new Set(lines.map((line) => line.id));
    await setLineEndDates(
      trx,
      scope,
      contract.id,
      Object.entries(previous.lineEndDates)
        .filter(([id]) => lineIds.has(id))
        .map(([id, endDate]) => ({ id, endDate }))
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
          next.existing
        )
      })
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
