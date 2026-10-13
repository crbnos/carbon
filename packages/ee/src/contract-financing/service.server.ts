// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Server-only contract financing: the terms, the rate history, the PBP event
// schedule and the requests, and the readers the ERP shows them with.
//
// The commercial LOCK: every authoring function calls
// `requireEntitlement(..., "GOVERNMENT_CONTRACTING")` before it touches the
// database. The readers degrade with `companyHasFeature`. Receiving the
// government's payment is community code: a customer deposit held against
// the contract (`payment.customerContractId`), applied to delivery invoices
// as liquidation.
//
// Reached only through `@carbon/ee/contract-financing.server` (`./server.ts`).
// Spec: .ai/specs/2026-10-12-wbs-interop-and-contract-financing.md (Phase B)

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  loadContractInvoiceIds,
  loadSalesInvoiceDocumentIds
} from "@carbon/database/deposit-scope";
import { toJson } from "@carbon/database/json";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import type { z } from "zod";
import { requireEntitlement } from "../entitlements.server";
import { companyHasFeature } from "../plan.server";
import {
  buildPbpRequest,
  computeSf1443,
  expectedLiquidation,
  PBP_CAP_EXCEEDED,
  rateOn,
  type Sf1443Input,
  type Sf1443OverridableLine,
  unliquidatedBalance
} from "./compute";
import type {
  contractFinancingRateValidator,
  contractFinancingTermsValidator,
  financingRequestValidator,
  pbpEventCompleteValidator,
  pbpEventValidator
} from "./models";
import type { ContractFinancingView, FinancingOverride } from "./types";

type Client = SupabaseClient<Database>;
type Db = Kysely<KyselyDatabase> | KyselyTx;

const FEATURE = "GOVERNMENT_CONTRACTING" as const;

/** A refusal the route shows as it is. */
export class FinancingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancingError";
  }
}

type Actor = { companyId: string; userId: string; customerContractId: string };

const LIVE_REQUEST_STATUSES = ["Submitted", "Approved", "Paid"] as const;
const CLOSED_INVOICE_STATUSES = ["Draft", "Voided"] as const;
const PAID_INVOICE_STATUSES = ["Paid", "Voided", "Draft"] as const;

async function requireBaseCurrencyContract(db: Db, actor: Actor) {
  const row = await db
    .selectFrom("customerContract as c")
    .innerJoin("company as co", "co.id", "c.companyId")
    .select(["c.currencyCode", "co.baseCurrencyCode"])
    .where("c.id", "=", actor.customerContractId)
    .where("c.companyId", "=", actor.companyId)
    .executeTakeFirst();
  if (!row) throw new FinancingError("The contract does not exist");
  if (row.currencyCode && row.currencyCode !== row.baseCurrencyCode) {
    throw new FinancingError(
      "Contract financing needs a contract in the company's base currency"
    );
  }
}

// --- Terms, rates and events ---------------------------------------------------

export async function upsertContractFinancing(
  client: Client,
  db: Kysely<KyselyDatabase>,
  input: Actor & z.infer<typeof contractFinancingTermsValidator>
) {
  await requireEntitlement(client, input.companyId, FEATURE);
  await requireBaseCurrencyContract(db, input);

  const existing = await db
    .selectFrom("customerContractFinancing")
    .select(["id", "financingMethod"])
    .where("customerContractId", "=", input.customerContractId)
    .where("companyId", "=", input.companyId)
    .executeTakeFirst();
  if (existing && existing.financingMethod !== input.financingMethod) {
    const requests = await db
      .selectFrom("contractFinancingRequest")
      .select("id")
      .where("customerContractId", "=", input.customerContractId)
      .where("companyId", "=", input.companyId)
      .limit(1)
      .execute();
    if (requests.length > 0) {
      throw new FinancingError(
        "The financing method cannot change once a request exists"
      );
    }
  }

  const values = {
    financingMethod: input.financingMethod,
    contractPrice: input.contractPrice,
    initialAwardDate: input.initialAwardDate,
    isSmallBusiness: input.isSmallBusiness,
    maximumPaymentShare: input.maximumPaymentShare ?? 0.9
  };
  if (existing) {
    await db
      .updateTable("customerContractFinancing")
      .set({
        ...values,
        updatedBy: input.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", existing.id)
      .where("companyId", "=", input.companyId)
      .execute();
    return existing.id;
  }
  const row = await db
    .insertInto("customerContractFinancing")
    .values({
      ...values,
      companyId: input.companyId,
      customerContractId: input.customerContractId,
      createdBy: input.userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Adds a rate from a date on, as a contract modification does. */
export async function addFinancingRate(
  client: Client,
  db: Kysely<KyselyDatabase>,
  input: Actor & z.infer<typeof contractFinancingRateValidator>
) {
  await requireEntitlement(client, input.companyId, FEATURE);
  const terms = await db
    .selectFrom("customerContractFinancing")
    .select("financingMethod")
    .where("customerContractId", "=", input.customerContractId)
    .where("companyId", "=", input.companyId)
    .executeTakeFirst();
  if (!terms) throw new FinancingError("Set the financing terms first");
  if (
    terms.financingMethod === "Progress Payments" &&
    input.progressPaymentRate === undefined
  ) {
    throw new FinancingError("Enter the progress payment rate");
  }
  if (
    terms.financingMethod === "Performance-Based Payments" &&
    input.progressPaymentRate !== undefined
  ) {
    throw new FinancingError(
      "A performance-based payment contract has no progress payment rate"
    );
  }
  await db
    .insertInto("customerContractFinancingRate")
    .values({
      companyId: input.companyId,
      customerContractId: input.customerContractId,
      effectiveDate: input.effectiveDate,
      progressPaymentRate: input.progressPaymentRate ?? null,
      liquidationRate: input.liquidationRate,
      modificationNumber: input.modificationNumber ?? null,
      createdBy: input.userId
    })
    .onConflict((conflict) =>
      conflict
        .columns(["customerContractId", "effectiveDate", "companyId"])
        .doUpdateSet({
          progressPaymentRate: input.progressPaymentRate ?? null,
          liquidationRate: input.liquidationRate,
          modificationNumber: input.modificationNumber ?? null,
          updatedBy: input.userId,
          updatedAt: datetime.timestamp()
        })
    )
    .execute();
}

export async function upsertPbpEvent(
  client: Client,
  db: Kysely<KyselyDatabase>,
  input: Actor & z.infer<typeof pbpEventValidator>
) {
  await requireEntitlement(client, input.companyId, FEATURE);
  const values = {
    sequence: input.sequence,
    eventCode: input.eventCode,
    description: input.description,
    completionCriteria: input.completionCriteria ?? null,
    eventType: input.eventType,
    customerContractLineId: input.customerContractLineId || null,
    amount: input.amount,
    plannedDate: input.plannedDate ?? null
  };
  if (input.id) {
    const billed = await db
      .selectFrom("contractFinancingRequestEvent as re")
      .innerJoin("contractFinancingRequest as r", (join) =>
        join
          .onRef("r.id", "=", "re.contractFinancingRequestId")
          .onRef("r.companyId", "=", "re.companyId")
      )
      .select("re.id")
      .where("re.performanceBasedPaymentEventId", "=", input.id)
      .where("re.companyId", "=", input.companyId)
      .where("r.status", "!=", "Withdrawn")
      .limit(1)
      .execute();
    if (billed.length > 0) {
      throw new FinancingError("A billed event cannot change");
    }
    await db
      .updateTable("performanceBasedPaymentEvent")
      .set({
        ...values,
        updatedBy: input.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", input.id)
      .where("customerContractId", "=", input.customerContractId)
      .where("companyId", "=", input.companyId)
      .execute();
    return input.id;
  }
  const row = await db
    .insertInto("performanceBasedPaymentEvent")
    .values({
      ...values,
      companyId: input.companyId,
      customerContractId: input.customerContractId,
      createdBy: input.userId
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Records an event as complete, with its evidence. */
export async function completePbpEvent(
  client: Client,
  db: Kysely<KyselyDatabase>,
  input: Actor & z.infer<typeof pbpEventCompleteValidator>
) {
  await requireEntitlement(client, input.companyId, FEATURE);
  await db
    .updateTable("performanceBasedPaymentEvent")
    .set({
      completedDate: input.completedDate,
      completedBy: input.userId,
      evidence: input.evidence ?? null,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", input.id)
    .where("customerContractId", "=", input.customerContractId)
    .where("companyId", "=", input.companyId)
    .execute();
}

// --- Readers -------------------------------------------------------------------

/** The contract's projects whose cost a progress payment counts: the
 *  contract's own and those of its Fixed lines (FAR 32.501-3). */
async function contractProjectIds(db: Db, actor: Actor): Promise<string[]> {
  const [contract, lines] = await Promise.all([
    db
      .selectFrom("customerContract")
      .select("projectId")
      .where("id", "=", actor.customerContractId)
      .where("companyId", "=", actor.companyId)
      .executeTakeFirst(),
    db
      .selectFrom("customerContractLine")
      .select("projectId")
      .where("customerContractId", "=", actor.customerContractId)
      .where("companyId", "=", actor.companyId)
      .where("billingMethod", "=", "Fixed")
      .where("projectId", "is not", null)
      .execute()
  ]);
  return [
    ...new Set(
      [contract?.projectId, ...lines.map((line) => line.projectId)].filter(
        (id): id is string => Boolean(id)
      )
    )
  ];
}

type Liquidation = {
  /** Deposits received less what invoices have liquidated. */
  unliquidated: number;
  /** Liquidation applied to the contract's invoices so far. */
  applied: number;
  /** The expected liquidation of each posted invoice not yet paid. */
  expectedByInvoice: Map<string, number>;
};

/**
 * The contract's financing position: its posted deposits, what has been
 * applied from them, and the liquidation the government will take from each
 * posted unpaid invoice, oldest first, capped by what stays unliquidated.
 */
async function loadLiquidation(
  db: Db,
  actor: Actor,
  options: { asOf?: string; currencyDecimals: number }
): Promise<Liquidation> {
  const deposits = await db
    .selectFrom("payment")
    .select(["id", "totalAmount", "exchangeRate"])
    .where("customerContractId", "=", actor.customerContractId)
    .where("companyId", "=", actor.companyId)
    .where("status", "=", "Posted")
    .where("paymentType", "=", "Receipt")
    .execute();
  const depositIds = deposits.map((deposit) => deposit.id);
  const applications = depositIds.length
    ? await db
        .selectFrom("invoiceSettlement as s")
        .innerJoin("payment as p", (join) =>
          join
            .onRef("p.id", "=", "s.paymentId")
            .onRef("p.companyId", "=", "s.companyId")
        )
        .select(["s.appliedAmount"])
        .where("s.companyId", "=", actor.companyId)
        .where("p.status", "=", "Posted")
        .where((eb) =>
          eb.or([
            eb("s.sourcePaymentId", "in", depositIds),
            eb.and([
              eb("s.sourcePaymentId", "is", null),
              eb("s.paymentId", "in", depositIds)
            ])
          ])
        )
        .execute()
    : [];
  const applied = applications.reduce(
    (total, row) => total + Number(row.appliedAmount),
    0
  );
  const unliquidated = unliquidatedBalance(
    deposits.map((deposit) => Number(deposit.totalAmount)),
    applications.map((row) => Number(row.appliedAmount))
  );

  const [rates, invoiceIds] = await Promise.all([
    db
      .selectFrom("customerContractFinancingRate")
      .select(["effectiveDate", "progressPaymentRate", "liquidationRate"])
      .where("customerContractId", "=", actor.customerContractId)
      .where("companyId", "=", actor.companyId)
      .execute(),
    loadContractInvoiceIds(db, actor.companyId, actor.customerContractId)
  ]);
  const unpaid = invoiceIds.length
    ? await db
        .selectFrom("salesInvoice")
        .select(["id", "subtotal", "postingDate", "dateIssued"])
        .where("companyId", "=", actor.companyId)
        .where("id", "in", invoiceIds)
        .where("status", "not in", [...PAID_INVOICE_STATUSES])
        .$if(Boolean(options.asOf), (query) =>
          query.where("postingDate", "<=", options.asOf!)
        )
        .orderBy("postingDate")
        .orderBy("id")
        .execute()
    : [];

  const expectedByInvoice = new Map<string, number>();
  let earlier = 0;
  for (const invoice of unpaid) {
    const date = invoice.postingDate ?? invoice.dateIssued ?? "";
    const rate = rateOn(
      rates.map((row) => ({
        effectiveDate: row.effectiveDate,
        progressPaymentRate:
          row.progressPaymentRate === null
            ? null
            : Number(row.progressPaymentRate),
        liquidationRate: Number(row.liquidationRate)
      })),
      date
    );
    if (!rate) continue;
    const expected = expectedLiquidation({
      liquidationRate: rate.liquidationRate,
      invoiceAmount: Number(invoice.subtotal ?? 0),
      unliquidated,
      earlierExpected: earlier,
      currencyDecimals: options.currencyDecimals
    });
    expectedByInvoice.set(invoice.id, expected);
    earlier += expected;
  }
  return { unliquidated, applied, expectedByInvoice };
}

async function currencyDecimalsOf(db: Db, companyId: string) {
  const row = await db
    .selectFrom("company as co")
    .innerJoin("currency as cu", (join) =>
      join
        .onRef("cu.code", "=", "co.baseCurrencyCode")
        .onRef("cu.companyGroupId", "=", "co.companyGroupId")
    )
    .select(["cu.decimalPlaces", "co.baseCurrencyCode"])
    .where("co.id", "=", companyId)
    .executeTakeFirst();
  return {
    decimals: row?.decimalPlaces ?? 2,
    currencyCode: row?.baseCurrencyCode ?? "USD"
  };
}

/** Everything the contract's Financing section shows. A reader: no entitlement. */
export async function getContractFinancing(
  db: Kysely<KyselyDatabase>,
  actor: Omit<Actor, "userId">
): Promise<ContractFinancingView> {
  const a = { ...actor, userId: "" };
  const [terms, rates, events, requests, billed, contract, currency] =
    await Promise.all([
      db
        .selectFrom("customerContractFinancing")
        .selectAll()
        .where("customerContractId", "=", actor.customerContractId)
        .where("companyId", "=", actor.companyId)
        .executeTakeFirst(),
      db
        .selectFrom("customerContractFinancingRate")
        .selectAll()
        .where("customerContractId", "=", actor.customerContractId)
        .where("companyId", "=", actor.companyId)
        .orderBy("effectiveDate", "desc")
        .execute(),
      db
        .selectFrom("performanceBasedPaymentEvent")
        .selectAll()
        .where("customerContractId", "=", actor.customerContractId)
        .where("companyId", "=", actor.companyId)
        .orderBy("sequence")
        .execute(),
      db
        .selectFrom("contractFinancingRequest as r")
        .leftJoin("payment as p", (join) =>
          join
            .onRef("p.id", "=", "r.paymentId")
            .onRef("p.companyId", "=", "r.companyId")
        )
        .selectAll("r")
        .select([
          "p.paymentId as paymentReadableId",
          "p.status as paymentStatus"
        ])
        .where("r.customerContractId", "=", actor.customerContractId)
        .where("r.companyId", "=", actor.companyId)
        .orderBy("r.createdAt", "desc")
        .execute(),
      db
        .selectFrom("contractFinancingRequestEvent as re")
        .innerJoin("contractFinancingRequest as r", (join) =>
          join
            .onRef("r.id", "=", "re.contractFinancingRequestId")
            .onRef("r.companyId", "=", "re.companyId")
        )
        .select("re.performanceBasedPaymentEventId")
        .where("r.customerContractId", "=", actor.customerContractId)
        .where("r.companyId", "=", actor.companyId)
        .where("r.status", "!=", "Withdrawn")
        .execute(),
      db
        .selectFrom("customerContract")
        .select("currencyCode")
        .where("id", "=", actor.customerContractId)
        .where("companyId", "=", actor.companyId)
        .executeTakeFirst(),
      currencyDecimalsOf(db, actor.companyId)
    ]);
  const billedIds = new Set(
    billed.map((row) => row.performanceBasedPaymentEventId)
  );
  const liquidation = await loadLiquidation(db, a, {
    currencyDecimals: currency.decimals
  });
  return {
    terms: terms ?? null,
    rates,
    events: events.map((event) => ({
      ...event,
      billed: billedIds.has(event.id)
    })),
    requests: requests.map((request) => ({
      ...request,
      paymentReadableId: request.paymentReadableId ?? null,
      paymentStatus: request.paymentStatus ?? null
    })),
    unliquidated: liquidation.unliquidated,
    currencyCode: currency.currencyCode,
    isBaseCurrency:
      !contract?.currencyCode || contract.currencyCode === currency.currencyCode
  } as ContractFinancingView;
}

/**
 * The inputs of an SF 1443 through a date: the cost of the contract's
 * projects, the earlier requests, the price of the delivered items and the
 * liquidation so far. Grouped reads only.
 */
export async function loadSf1443Inputs(
  db: Db,
  actor: Actor & {
    costsThroughDate: string;
    /** The request being computed: never counted as an earlier request. */
    excludeRequestId?: string;
  }
): Promise<
  Omit<
    Sf1443Input,
    "contractPrice" | "progressPaymentRate" | "liquidationRate" | "overrides"
  > & { estimateAtCompletion: number }
> {
  const projectIds = await contractProjectIds(db, actor);
  const currency = await currencyDecimalsOf(db, actor.companyId);
  const [cost, eac, previous, invoiceIds, liquidation] = await Promise.all([
    projectIds.length
      ? db
          .selectFrom("projectLedger")
          .select([
            sql<number>`COALESCE(SUM("amount") FILTER (WHERE NOT "unallowable"), 0)`.as(
              "eligible"
            ),
            sql<number>`COALESCE(SUM("amount"), 0)`.as("incurred")
          ])
          .where("companyId", "=", actor.companyId)
          .where("projectId", "in", projectIds)
          .where("postingDate", "<=", actor.costsThroughDate)
          .executeTakeFirst()
      : Promise.resolve({ eligible: 0, incurred: 0 }),
    projectIds.length
      ? db
          .selectFrom("projectElement")
          .select(
            sql<number>`COALESCE(SUM("estimateAtCompletion"), 0)`.as("total")
          )
          .where("companyId", "=", actor.companyId)
          .where("projectId", "in", projectIds)
          .where("parentId", "is", null)
          .executeTakeFirst()
      : Promise.resolve({ total: 0 }),
    db
      .selectFrom("contractFinancingRequest")
      .select(sql<number>`COALESCE(SUM("requestedAmount"), 0)`.as("total"))
      .where("customerContractId", "=", actor.customerContractId)
      .where("companyId", "=", actor.companyId)
      .where("status", "in", [...LIVE_REQUEST_STATUSES])
      .$if(Boolean(actor.excludeRequestId), (query) =>
        query.where("id", "!=", actor.excludeRequestId!)
      )
      .executeTakeFirst(),
    loadContractInvoiceIds(db, actor.companyId, actor.customerContractId),
    loadLiquidation(db, actor, {
      asOf: actor.costsThroughDate,
      currencyDecimals: currency.decimals
    })
  ]);
  const delivered = invoiceIds.length
    ? await db
        .selectFrom("salesInvoice")
        .select(sql<number>`COALESCE(SUM("subtotal"), 0)`.as("total"))
        .where("companyId", "=", actor.companyId)
        .where("id", "in", invoiceIds)
        .where("status", "not in", [...CLOSED_INVOICE_STATUSES])
        .where("postingDate", "<=", actor.costsThroughDate)
        .executeTakeFirst()
    : { total: 0 };
  const expected = [...liquidation.expectedByInvoice.values()].reduce(
    (total, value) => total + value,
    0
  );
  const incurred = Number(cost?.incurred ?? 0);
  return {
    eligibleCost: Number(cost?.eligible ?? 0),
    incurredCost: incurred,
    estimateAtCompletion: Number(eac?.total ?? 0),
    estimateToComplete: Math.max(0, Number(eac?.total ?? 0) - incurred),
    previousRequested: Number(previous?.total ?? 0),
    deliveredPrice: Number(delivered?.total ?? 0),
    liquidated: liquidation.applied + expected
  };
}

// --- Requests ------------------------------------------------------------------

async function loadTerms(db: Db, actor: Actor) {
  const terms = await db
    .selectFrom("customerContractFinancing")
    .selectAll()
    .where("customerContractId", "=", actor.customerContractId)
    .where("companyId", "=", actor.companyId)
    .executeTakeFirst();
  if (!terms) throw new FinancingError("Set the financing terms first");
  const rates = await db
    .selectFrom("customerContractFinancingRate")
    .select(["effectiveDate", "progressPaymentRate", "liquidationRate"])
    .where("customerContractId", "=", actor.customerContractId)
    .where("companyId", "=", actor.companyId)
    .execute();
  return {
    terms,
    rates: rates.map((row) => ({
      effectiveDate: row.effectiveDate,
      progressPaymentRate:
        row.progressPaymentRate === null
          ? null
          : Number(row.progressPaymentRate),
      liquidationRate: Number(row.liquidationRate)
    }))
  };
}

type RequestDates = {
  requestDate: string;
  costsThroughDate: string;
  estimateToComplete: number | null;
};

/** The SF 1443 lines of a progress payment request, with its overrides. */
async function progressPaymentLines(
  db: Db,
  actor: Actor,
  dates: RequestDates,
  overrides: Record<string, FinancingOverride>,
  excludeRequestId?: string
) {
  const { terms, rates } = await loadTerms(db, actor);
  const rate = rateOn(rates, dates.requestDate);
  if (!rate || rate.progressPaymentRate === null) {
    throw new FinancingError(
      "Add the progress payment and liquidation rates in effect on the request date"
    );
  }
  const inputs = await loadSf1443Inputs(db, {
    ...actor,
    costsThroughDate: dates.costsThroughDate,
    excludeRequestId
  });
  const result = computeSf1443({
    ...inputs,
    estimateToComplete: dates.estimateToComplete ?? inputs.estimateToComplete,
    contractPrice: Number(terms.contractPrice),
    progressPaymentRate: rate.progressPaymentRate,
    liquidationRate: rate.liquidationRate,
    overrides: Object.fromEntries(
      Object.entries(overrides).map(([line, override]) => [
        line,
        override.value
      ])
    ) as Partial<Record<Sf1443OverridableLine, number>>
  });
  return {
    lines: {
      ...result.lines,
      "6A": rate.progressPaymentRate,
      "6B": rate.liquidationRate,
      lossRatio: result.lossRatio,
      hasSection3: result.hasSection3
    },
    requestedAmount: result.lines["26"]
  };
}

/** Creates a Draft request: an SF 1443, or a PBP request of the complete events. */
export async function createFinancingRequest(
  client: Client,
  db: Kysely<KyselyDatabase>,
  input: Actor & z.infer<typeof financingRequestValidator>
): Promise<string> {
  await requireEntitlement(client, input.companyId, FEATURE);
  if (input.costsThroughDate > input.requestDate) {
    throw new FinancingError("Costs through cannot be after the request date");
  }
  return db.transaction().execute(async (trx) => {
    // One Draft per contract: a request's earlier values (SF 1443 line 24,
    // PBP 1a and the share cap) count only live requests, so a second Draft
    // would be computed without the first and both could be submitted.
    await trx
      .selectFrom("customerContractFinancing")
      .select("customerContractId")
      .where("customerContractId", "=", input.customerContractId)
      .where("companyId", "=", input.companyId)
      .forUpdate()
      .executeTakeFirst();
    const draft = await trx
      .selectFrom("contractFinancingRequest")
      .select("id")
      .where("customerContractId", "=", input.customerContractId)
      .where("companyId", "=", input.companyId)
      .where("status", "=", "Draft")
      .executeTakeFirst();
    if (draft) {
      throw new FinancingError(
        "Submit or delete the Draft request before you create another"
      );
    }
    const { terms } = await loadTerms(trx, input);
    const base = {
      companyId: input.companyId,
      customerContractId: input.customerContractId,
      financingMethod: terms.financingMethod,
      requestDate: input.requestDate,
      costsThroughDate: input.costsThroughDate,
      estimateToComplete: input.estimateToComplete ?? null,
      estimateDate: input.estimateDate ?? null,
      createdBy: input.userId
    };

    if (terms.financingMethod === "Progress Payments") {
      const { lines, requestedAmount } = await progressPaymentLines(
        trx,
        input,
        {
          requestDate: input.requestDate,
          costsThroughDate: input.costsThroughDate,
          estimateToComplete: input.estimateToComplete ?? null
        },
        {}
      );
      const row = await trx
        .insertInto("contractFinancingRequest")
        .values({ ...base, lines: toJson(lines), requestedAmount })
        .returning("id")
        .executeTakeFirstOrThrow();
      return row.id;
    }

    const [events, billed, previous, cost] = await Promise.all([
      trx
        .selectFrom("performanceBasedPaymentEvent")
        .select(["id", "sequence", "eventType", "amount", "completedDate"])
        .where("customerContractId", "=", input.customerContractId)
        .where("companyId", "=", input.companyId)
        .execute(),
      trx
        .selectFrom("contractFinancingRequestEvent as re")
        .innerJoin("contractFinancingRequest as r", (join) =>
          join
            .onRef("r.id", "=", "re.contractFinancingRequestId")
            .onRef("r.companyId", "=", "re.companyId")
        )
        .select("re.performanceBasedPaymentEventId")
        .where("r.customerContractId", "=", input.customerContractId)
        .where("r.companyId", "=", input.companyId)
        .where("r.status", "!=", "Withdrawn")
        .execute(),
      trx
        .selectFrom("contractFinancingRequest")
        .select(sql<number>`COALESCE(SUM("requestedAmount"), 0)`.as("total"))
        .where("customerContractId", "=", input.customerContractId)
        .where("companyId", "=", input.companyId)
        .where("status", "in", [...LIVE_REQUEST_STATUSES])
        .executeTakeFirst(),
      loadSf1443Inputs(trx, {
        ...input,
        costsThroughDate: input.costsThroughDate
      })
    ]);
    const request = buildPbpRequest({
      events: events.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        eventType: event.eventType,
        amount: Number(event.amount),
        completedDate:
          event.completedDate && event.completedDate <= input.requestDate
            ? event.completedDate
            : null
      })),
      billedEventIds: new Set(
        billed.map((row) => row.performanceBasedPaymentEventId)
      ),
      contractPrice: Number(terms.contractPrice),
      maximumShare: Number(terms.maximumPaymentShare),
      previousBilled: Number(previous?.total ?? 0),
      incurredCost: cost.incurredCost
    });
    if ("error" in request) {
      throw new FinancingError(
        request.error === PBP_CAP_EXCEEDED
          ? "The request takes the payments above the maximum share of the price"
          : "No complete event is waiting to be billed"
      );
    }
    const row = await trx
      .insertInto("contractFinancingRequest")
      .values({
        ...base,
        lines: toJson(request.values),
        requestedAmount: request.values["1b"]
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const amounts = new Map(events.map((event) => [event.id, event.amount]));
    await trx
      .insertInto("contractFinancingRequestEvent")
      .values(
        request.eventIds.map((eventId) => ({
          companyId: input.companyId,
          contractFinancingRequestId: row.id,
          performanceBasedPaymentEventId: eventId,
          amount: Number(amounts.get(eventId) ?? 0),
          createdBy: input.userId
        }))
      )
      .execute();
    return row.id;
  });
}

async function loadRequest(db: Db, actor: Actor, requestId: string) {
  const request = await db
    .selectFrom("contractFinancingRequest")
    .selectAll()
    .where("id", "=", requestId)
    .where("customerContractId", "=", actor.customerContractId)
    .where("companyId", "=", actor.companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!request) throw new FinancingError("The request does not exist");
  return request;
}

/**
 * Sets or clears the override of one SF 1443 line of a Draft request, with
 * its reason, and recomputes every line. The computed value stays in `lines`
 * beside the override, so a reviewer sees both.
 */
export async function overrideRequestLine(
  client: Client,
  db: Kysely<KyselyDatabase>,
  input: Actor & {
    requestId: string;
    line: Sf1443OverridableLine;
    value?: number;
    reason?: string;
  }
) {
  await requireEntitlement(client, input.companyId, FEATURE);
  await db.transaction().execute(async (trx) => {
    const request = await loadRequest(trx, input, input.requestId);
    if (request.status !== "Draft") {
      throw new FinancingError("Only a Draft request changes");
    }
    if (request.financingMethod !== "Progress Payments") {
      throw new FinancingError("Only an SF 1443 line takes an override");
    }
    const overrides = {
      ...((request.overrides ?? {}) as Record<string, FinancingOverride>)
    };
    if (input.value === undefined) {
      delete overrides[input.line];
    } else {
      overrides[input.line] = {
        value: input.value,
        reason: input.reason ?? "",
        by: input.userId,
        at: datetime.timestamp()
      };
    }
    // `lines` keeps the computed values; the override shows beside them.
    const computed = await progressPaymentLines(
      trx,
      input,
      {
        requestDate: request.requestDate,
        costsThroughDate: request.costsThroughDate,
        estimateToComplete:
          request.estimateToComplete === null
            ? null
            : Number(request.estimateToComplete)
      },
      {},
      request.id
    );
    const effective = await progressPaymentLines(
      trx,
      input,
      {
        requestDate: request.requestDate,
        costsThroughDate: request.costsThroughDate,
        estimateToComplete:
          request.estimateToComplete === null
            ? null
            : Number(request.estimateToComplete)
      },
      overrides,
      request.id
    );
    await trx
      .updateTable("contractFinancingRequest")
      .set({
        lines: toJson(computed.lines),
        overrides: toJson(overrides),
        requestedAmount: effective.requestedAmount,
        updatedBy: input.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", request.id)
      .where("companyId", "=", input.companyId)
      .execute();
  });
}

/** Submits a Draft: it takes the next number of the contract's series. */
export async function submitFinancingRequest(
  client: Client,
  db: Kysely<KyselyDatabase>,
  input: Actor & { requestId: string }
): Promise<number> {
  await requireEntitlement(client, input.companyId, FEATURE);
  return db.transaction().execute(async (trx) => {
    const request = await loadRequest(trx, input, input.requestId);
    if (request.status !== "Draft") {
      throw new FinancingError("Only a Draft request can be submitted");
    }
    const series = await trx
      .updateTable("customerContractFinancing")
      .set({ nextRequestNumber: sql`"nextRequestNumber" + 1` })
      .where("customerContractId", "=", input.customerContractId)
      .where("companyId", "=", input.companyId)
      .returning(sql<number>`"nextRequestNumber" - 1`.as("number"))
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("contractFinancingRequest")
      .set({
        status: "Submitted",
        requestNumber: Number(series.number),
        submittedAt: datetime.timestamp(),
        submittedBy: input.userId,
        updatedBy: input.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", request.id)
      .where("companyId", "=", input.companyId)
      .execute();
    return Number(series.number);
  });
}

/** Records what the contracting officer approved (SF 1443 line 27). */
export async function approveFinancingRequest(
  client: Client,
  db: Kysely<KyselyDatabase>,
  input: Actor & { requestId: string; approvedAmount: number }
) {
  await requireEntitlement(client, input.companyId, FEATURE);
  await db.transaction().execute(async (trx) => {
    const request = await loadRequest(trx, input, input.requestId);
    if (request.status !== "Submitted") {
      throw new FinancingError("Only a Submitted request can be approved");
    }
    await trx
      .updateTable("contractFinancingRequest")
      .set({
        status: "Approved",
        approvedAmount: input.approvedAmount,
        updatedBy: input.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", request.id)
      .where("companyId", "=", input.companyId)
      .execute();
  });
}

/**
 * Withdraws a Submitted request (it keeps its number, so the series has no
 * gap) or deletes a Draft, which has no number yet.
 */
export async function withdrawFinancingRequest(
  client: Client,
  db: Kysely<KyselyDatabase>,
  input: Actor & { requestId: string }
) {
  await requireEntitlement(client, input.companyId, FEATURE);
  await db.transaction().execute(async (trx) => {
    const request = await loadRequest(trx, input, input.requestId);
    if (request.status === "Draft") {
      await trx
        .deleteFrom("contractFinancingRequest")
        .where("id", "=", request.id)
        .where("companyId", "=", input.companyId)
        .execute();
      return;
    }
    if (request.status !== "Submitted") {
      throw new FinancingError(
        "Only a Draft or Submitted request can be withdrawn"
      );
    }
    await trx
      .updateTable("contractFinancingRequest")
      .set({
        status: "Withdrawn",
        updatedBy: input.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", request.id)
      .where("companyId", "=", input.companyId)
      .execute();
  });
}

/** Links the deposit payment that receives an Approved request. */
export async function linkFinancingPayment(
  client: Client,
  db: Kysely<KyselyDatabase>,
  input: Actor & { requestId: string; paymentId: string }
) {
  await requireEntitlement(client, input.companyId, FEATURE);
  await db.transaction().execute(async (trx) => {
    const request = await loadRequest(trx, input, input.requestId);
    if (request.status !== "Approved") {
      throw new FinancingError("Only an Approved request takes a payment");
    }
    await trx
      .updateTable("contractFinancingRequest")
      .set({
        paymentId: input.paymentId,
        updatedBy: input.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", request.id)
      .where("companyId", "=", input.companyId)
      .execute();
  });
}

/**
 * Marks the requests a posted payment receives as Paid. Called after a
 * payment posts; it records a fact, so it needs no entitlement.
 */
export async function markFinancingRequestsPaid(
  db: Kysely<KyselyDatabase>,
  input: { companyId: string; paymentId: string; userId: string }
) {
  await db
    .updateTable("contractFinancingRequest")
    .set({
      status: "Paid",
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .where("paymentId", "=", input.paymentId)
    .where("companyId", "=", input.companyId)
    .where("status", "=", "Approved")
    .execute();
}

/**
 * The liquidation the government will take from a posted invoice of a
 * financed contract, or null when there is none. Degrades: without the
 * feature, null.
 */
export async function getExpectedLiquidation(
  client: Client,
  db: Kysely<KyselyDatabase>,
  input: { companyId: string; salesInvoiceId: string }
): Promise<{ amount: number; customerContractId: string } | null> {
  if (!(await companyHasFeature(client, input.companyId, { feature: FEATURE })))
    return null;
  const documents = await loadSalesInvoiceDocumentIds(db, input.companyId, [
    input.salesInvoiceId
  ]);
  const contractIds =
    documents.get(input.salesInvoiceId)?.customerContractIds ?? [];
  if (contractIds.length === 0) return null;
  const financed = await db
    .selectFrom("customerContractFinancing")
    .select("customerContractId")
    .where("companyId", "=", input.companyId)
    .where("customerContractId", "in", contractIds)
    .executeTakeFirst();
  if (!financed) return null;
  const currency = await currencyDecimalsOf(db, input.companyId);
  const liquidation = await loadLiquidation(
    db,
    {
      companyId: input.companyId,
      userId: "",
      customerContractId: financed.customerContractId
    },
    { currencyDecimals: currency.decimals }
  );
  const amount = liquidation.expectedByInvoice.get(input.salesInvoiceId);
  return amount
    ? { amount, customerContractId: financed.customerContractId }
    : null;
}

/** One request with the events it bills. A reader: no entitlement. */
export async function getFinancingRequest(
  db: Kysely<KyselyDatabase>,
  input: { companyId: string; customerContractId: string; requestId: string }
) {
  const [request, events] = await Promise.all([
    db
      .selectFrom("contractFinancingRequest as r")
      .leftJoin("payment as p", (join) =>
        join
          .onRef("p.id", "=", "r.paymentId")
          .onRef("p.companyId", "=", "r.companyId")
      )
      .selectAll("r")
      .select(["p.paymentId as paymentReadableId", "p.status as paymentStatus"])
      .where("r.id", "=", input.requestId)
      .where("r.customerContractId", "=", input.customerContractId)
      .where("r.companyId", "=", input.companyId)
      .executeTakeFirst(),
    db
      .selectFrom("contractFinancingRequestEvent as re")
      .innerJoin("performanceBasedPaymentEvent as e", (join) =>
        join
          .onRef("e.id", "=", "re.performanceBasedPaymentEventId")
          .onRef("e.companyId", "=", "re.companyId")
      )
      .leftJoin("customerContractLine as l", (join) =>
        join
          .onRef("l.id", "=", "e.customerContractLineId")
          .onRef("l.companyId", "=", "e.companyId")
      )
      .select([
        "e.id",
        "e.eventCode",
        "e.description",
        "e.eventType",
        "re.amount",
        "l.lineItemNumber"
      ])
      .where("re.contractFinancingRequestId", "=", input.requestId)
      .where("re.companyId", "=", input.companyId)
      .orderBy("e.sequence")
      .execute()
  ]);
  if (!request) return null;
  return {
    ...request,
    paymentReadableId: request.paymentReadableId ?? null,
    paymentStatus: request.paymentStatus ?? null,
    events: events.map((event) => ({ ...event, amount: Number(event.amount) }))
  };
}

export type FinancingRequestDetail = NonNullable<
  Awaited<ReturnType<typeof getFinancingRequest>>
>;
