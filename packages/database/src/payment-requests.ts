// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Payment request building blocks: the allowance, the lifecycle and the one
// settlement path. Server-only. Every function takes `db` (a Kysely handle or
// transaction) and filters by companyId; the caller (the ERP operations, the
// Ramp sync) decides the transaction boundary.
// Spec: .ai/specs/2026-11-23-supplier-payment-requests.md

import { type Kysely, sql } from "kysely";
import type { KyselyDatabase, KyselyTx } from "./client.ts";
import {
  canTransitionPaymentRequest,
  EDITABLE_PAYMENT_REQUEST_STATUSES,
  OPEN_PAYMENT_REQUEST_STATUSES,
  type PaymentRequestStatus
} from "./payment-request-lifecycle.ts";
import { round } from "./precision.ts";

type Db = Kysely<KyselyDatabase> | KyselyTx;

export type PaymentRequestTarget =
  | { purchaseInvoiceId: string; purchaseOrderId?: undefined }
  | { purchaseOrderId: string; purchaseInvoiceId?: undefined };

/** A rule the caller broke. The operation returns its message as it is. */
export class PaymentRequestRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentRequestRefusal";
  }
}

const CENTS = 2;
const money = (n: number) => round(n, CENTS);

export const PAYMENT_REQUEST_COLUMNS = [
  "id",
  "purchaseInvoiceId",
  "purchaseOrderId",
  "requestNumber",
  "status",
  "amount",
  "currencyCode",
  "dueDate",
  "description",
  "documentPath",
  "isAutomatic",
  "paymentId",
  "createdAt"
] as const;

function targetOf(row: {
  purchaseInvoiceId: string | null;
  purchaseOrderId: string | null;
}): PaymentRequestTarget {
  return row.purchaseInvoiceId
    ? { purchaseInvoiceId: row.purchaseInvoiceId }
    : { purchaseOrderId: row.purchaseOrderId! };
}

/**
 * Locks the request's document row FOR UPDATE, so two requests on one document
 * check the allowance one after the other. Returns what a request copies. It
 * refuses nothing but a missing document; see `refuseUnlessTakesRequests`.
 */
export async function lockPaymentRequestTarget(
  db: Db,
  companyId: string,
  target: PaymentRequestTarget
) {
  if (target.purchaseInvoiceId) {
    const row = await db
      .selectFrom("purchaseInvoice as d")
      .innerJoin("company as c", "c.id", "d.companyId")
      .select([
        "d.id",
        "d.status",
        "d.supplierId",
        sql<string>`COALESCE(d."currencyCode", c."baseCurrencyCode")`.as(
          "currencyCode"
        )
      ])
      .where("d.id", "=", target.purchaseInvoiceId)
      .where("d.companyId", "=", companyId)
      .forUpdate("d")
      .executeTakeFirst();
    if (!row) throw new PaymentRequestRefusal("Purchase invoice not found");
    return { ...row, kind: "invoice" as const };
  }
  const row = await db
    .selectFrom("purchaseOrder as d")
    .innerJoin("company as c", "c.id", "d.companyId")
    .select([
      "d.id",
      "d.status",
      "d.supplierId",
      sql<string>`COALESCE(d."currencyCode", c."baseCurrencyCode")`.as(
        "currencyCode"
      )
    ])
    .where("d.id", "=", target.purchaseOrderId!)
    .where("d.companyId", "=", companyId)
    .forUpdate("d")
    .executeTakeFirst();
  if (!row) throw new PaymentRequestRefusal("Purchase order not found");
  return { ...row, kind: "order" as const };
}

/**
 * Whether the locked document takes new or changed requests. Settlement does
 * not ask: a payment Ramp already made is recorded whatever happened since.
 */
function refuseUnlessTakesRequests(
  document: Awaited<ReturnType<typeof lockPaymentRequestTarget>>
) {
  if (document.kind === "invoice" && document.status === "Voided") {
    throw new PaymentRequestRefusal("A voided invoice takes no request");
  }
  if (
    document.kind === "order" &&
    (document.status === "Draft" || document.status === "Closed")
  ) {
    throw new PaymentRequestRefusal(
      `A ${document.status} purchase order takes no deposit request`
    );
  }
}

/**
 * The amount new requests on the document may still use.
 *
 * Invoice: the open balance (which already nets Posted payments) less its
 * open requests. Purchase order: the order total less its prepayments (net of
 * refunds; a Paid deposit request's payment is one of them) less its open
 * deposit requests. One read each, in document currency.
 */
export async function getRequestAllowance(
  db: Db,
  args: {
    companyId: string;
    target: PaymentRequestTarget;
    excludeRequestId?: string;
  }
) {
  const { companyId, target } = args;
  const openRequests = (eb: any) =>
    eb
      .selectFrom("paymentRequest as r")
      .select(sql<string>`COALESCE(SUM(r."amount"), 0)`.as("total"))
      .where("r.companyId", "=", companyId)
      .where("r.status", "in", [...OPEN_PAYMENT_REQUEST_STATUSES])
      .where("r.id", "!=", args.excludeRequestId ?? "")
      .where(
        target.purchaseInvoiceId ? "r.purchaseInvoiceId" : "r.purchaseOrderId",
        "=",
        target.purchaseInvoiceId ?? target.purchaseOrderId!
      );

  let openBalance: number;
  let requested: number;
  if (target.purchaseInvoiceId) {
    const row = await db
      .selectFrom("purchaseInvoices as pi")
      .select((eb) => ["pi.balance", openRequests(eb).as("requested")])
      .where("pi.id", "=", target.purchaseInvoiceId)
      .where("pi.companyId", "=", companyId)
      .executeTakeFirst();
    openBalance = Number(row?.balance ?? 0);
    requested = Number(row?.requested ?? 0);
  } else {
    const row = await db
      .selectFrom("purchaseOrders as po")
      .select((eb) => [
        "po.orderTotal",
        eb
          .selectFrom("payment as p")
          .select(
            sql<string>`COALESCE(SUM(CASE WHEN p."paymentType" = 'Receipt' THEN -p."totalAmount" ELSE p."totalAmount" END), 0)`.as(
              "total"
            )
          )
          .where("p.companyId", "=", companyId)
          .whereRef("p.purchaseOrderId", "=", "po.id")
          .where("p.status", "in", ["Draft", "Posted"])
          .as("prepaid"),
        openRequests(eb).as("requested")
      ])
      .where("po.id", "=", target.purchaseOrderId!)
      .where("po.companyId", "=", companyId)
      .executeTakeFirst();
    openBalance = money(
      Number(row?.orderTotal ?? 0) - Number(row?.prepaid ?? 0)
    );
    requested = Number(row?.requested ?? 0);
  }
  return {
    openBalance: money(openBalance),
    requested: money(requested),
    allowance: Math.max(0, money(openBalance - requested))
  };
}

function refuseOverAllowance(
  amount: number | null | undefined,
  allowance: number,
  currencyCode: string
) {
  if (amount != null && money(amount) > allowance) {
    throw new PaymentRequestRefusal(
      `The amount is more than the ${allowance.toFixed(CENTS)} ${currencyCode} this document still allows`
    );
  }
}

/** The request Carbon already handed to a spend platform (it holds the bill). */
export const PAYMENT_REQUEST_MAPPING_ENTITY = "paymentRequest";

async function refuseIfHandedOff(db: Db, companyId: string, requestId: string) {
  const mapped = await db
    .selectFrom("externalIntegrationMapping")
    .select("id")
    .where("companyId", "=", companyId)
    .where("entityType", "=", PAYMENT_REQUEST_MAPPING_ENTITY)
    .where("entityId", "=", requestId)
    .executeTakeFirst();
  if (mapped) {
    throw new PaymentRequestRefusal(
      "Ramp already has this request's bill. Cancel the request and add a new one instead."
    );
  }
}

/**
 * Adds a request on its document. A repeated idempotency key returns the first
 * request unchanged. Run inside a transaction: it locks the document.
 */
export async function createPaymentRequest(
  db: Db,
  input: {
    companyId: string;
    userId: string;
    target: PaymentRequestTarget;
    status: "Planned" | "Ready";
    amount?: number | null;
    dueDate?: string | null;
    description?: string | null;
    isAutomatic?: boolean;
    idempotencyKey?: string | null;
  }
) {
  const { companyId, target } = input;
  const findByKey = () =>
    db
      .selectFrom("paymentRequest")
      .select(PAYMENT_REQUEST_COLUMNS)
      .where("companyId", "=", companyId)
      .where("idempotencyKey", "=", input.idempotencyKey!)
      .executeTakeFirst();
  if (input.idempotencyKey) {
    const existing = await findByKey();
    if (existing) return { request: existing, replayed: true };
  }

  const document = await lockPaymentRequestTarget(db, companyId, target);
  refuseUnlessTakesRequests(document);
  if (input.status === "Ready" && (!input.amount || !input.dueDate)) {
    throw new PaymentRequestRefusal(
      "A Ready request needs an amount and a due date"
    );
  }
  const { allowance } = await getRequestAllowance(db, { companyId, target });
  refuseOverAllowance(input.amount, allowance, document.currencyCode);

  const inserted = await db
    .insertInto("paymentRequest")
    .values((eb) => ({
      companyId,
      purchaseInvoiceId: target.purchaseInvoiceId ?? null,
      purchaseOrderId: target.purchaseOrderId ?? null,
      // The document lock serializes numbering.
      requestNumber: eb
        .selectFrom("paymentRequest")
        .select(sql<number>`COALESCE(MAX("requestNumber"), 0) + 1`.as("n"))
        .where("companyId", "=", companyId)
        .where(
          target.purchaseInvoiceId ? "purchaseInvoiceId" : "purchaseOrderId",
          "=",
          target.purchaseInvoiceId ?? target.purchaseOrderId!
        ),
      status: input.status,
      amount: input.amount ?? null,
      currencyCode: document.currencyCode,
      dueDate: input.dueDate ?? null,
      description: input.description ?? null,
      isAutomatic: input.isAutomatic ?? false,
      idempotencyKey: input.idempotencyKey ?? null,
      createdBy: input.userId
    }))
    .onConflict((oc) =>
      oc
        .columns(["companyId", "idempotencyKey"])
        .where("idempotencyKey", "is not", null)
        .doNothing()
    )
    .returning(PAYMENT_REQUEST_COLUMNS)
    .executeTakeFirst();
  if (inserted) return { request: inserted, replayed: false };
  // A concurrent call with the same key won the insert.
  const winner = await findByKey();
  if (!winner) throw new Error("Failed to create the payment request");
  return { request: winner, replayed: true };
}

/** A request by id, or undefined. Ramp finds a request's bill by its `remote_id`. */
export function findPaymentRequest(db: Db, companyId: string, id: string) {
  return db
    .selectFrom("paymentRequest")
    .select(PAYMENT_REQUEST_COLUMNS)
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
}

export type PaymentRequestRow = NonNullable<
  Awaited<ReturnType<typeof findPaymentRequest>>
>;

/** Payment request ids carry this prefix (`id('preq')`). */
export const PAYMENT_REQUEST_ID_PREFIX = "preq_";

async function readRequest(db: Db, companyId: string, requestId: string) {
  const row = await db
    .selectFrom("paymentRequest")
    .select(PAYMENT_REQUEST_COLUMNS)
    .where("id", "=", requestId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!row) throw new PaymentRequestRefusal("Payment request not found");
  return row;
}

/**
 * Edits a Planned or Ready request. A field left undefined keeps its value;
 * null clears it. Runs the allowance check on the result.
 */
export async function updatePaymentRequest(
  db: Db,
  input: {
    companyId: string;
    userId: string;
    requestId: string;
    amount?: number | null;
    dueDate?: string | null;
    description?: string | null;
    status: "Planned" | "Ready";
  }
) {
  const { companyId } = input;
  const current = await readRequest(db, companyId, input.requestId);
  const target = targetOf(current);
  // Document first, then the request: the same lock order as create.
  const document = await lockPaymentRequestTarget(db, companyId, target);
  refuseUnlessTakesRequests(document);
  if (
    !(EDITABLE_PAYMENT_REQUEST_STATUSES as readonly string[]).includes(
      current.status
    )
  ) {
    throw new PaymentRequestRefusal(
      `A ${current.status} request can no longer be edited`
    );
  }
  await refuseIfHandedOff(db, companyId, current.id);
  const next = {
    amount:
      input.amount === undefined
        ? current.amount == null
          ? null
          : Number(current.amount)
        : input.amount,
    dueDate:
      input.dueDate === undefined
        ? current.dueDate == null
          ? null
          : String(current.dueDate).slice(0, 10)
        : input.dueDate,
    description:
      input.description === undefined ? current.description : input.description
  };
  if (input.status === "Ready" && (!next.amount || !next.dueDate)) {
    throw new PaymentRequestRefusal(
      "A Ready request needs an amount and a due date"
    );
  }
  const { allowance } = await getRequestAllowance(db, {
    companyId,
    target,
    excludeRequestId: current.id
  });
  refuseOverAllowance(next.amount, allowance, document.currencyCode);

  return transitionPaymentRequest(db, {
    companyId,
    userId: input.userId,
    requestId: current.id,
    from: [current.status],
    to: input.status,
    patch: next
  });
}

/**
 * Planned to Ready: the request is due. It needs an amount and a due date, and
 * the amount must still fit the document's allowance, which a payment or a
 * prepayment applied since planning may have lowered.
 */
export async function markPaymentRequestReady(
  db: Db,
  args: { companyId: string; userId: string; requestId: string }
) {
  const current = await readRequest(db, args.companyId, args.requestId);
  const target = targetOf(current);
  const document = await lockPaymentRequestTarget(db, args.companyId, target);
  refuseUnlessTakesRequests(document);
  if (current.amount == null || current.dueDate == null) {
    throw new PaymentRequestRefusal(
      "Add an amount and a due date before marking the request Ready"
    );
  }
  const { allowance } = await getRequestAllowance(db, {
    companyId: args.companyId,
    target,
    excludeRequestId: current.id
  });
  refuseOverAllowance(Number(current.amount), allowance, document.currencyCode);
  return transitionPaymentRequest(db, {
    ...args,
    from: ["Planned"],
    to: "Ready"
  });
}

/** Ready to Planned: only while no spend platform holds the bill. */
export async function markPaymentRequestPlanned(
  db: Db,
  args: { companyId: string; userId: string; requestId: string }
) {
  await refuseIfHandedOff(db, args.companyId, args.requestId);
  return transitionPaymentRequest(db, {
    ...args,
    from: ["Ready"],
    to: "Planned"
  });
}

/**
 * A payment was voided or deleted: the requests it settled are unpaid again.
 * They go back to Planned with their amounts, for the user to decide.
 */
export async function releasePaymentRequestsOfPayment(
  db: Db,
  args: { companyId: string; userId: string; paymentId: string }
) {
  return db
    .updateTable("paymentRequest")
    .set({
      status: "Planned",
      paymentId: null,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .where("companyId", "=", args.companyId)
    .where("paymentId", "=", args.paymentId)
    .where("status", "=", "Paid")
    .execute();
}

/**
 * Moves a request from one of `from` to `to` with one conditional UPDATE.
 * A stale or repeated call changes no row and is refused.
 */
export async function transitionPaymentRequest(
  db: Db,
  args: {
    companyId: string;
    userId: string;
    requestId: string;
    from: readonly PaymentRequestStatus[];
    to: PaymentRequestStatus;
    patch?: {
      amount?: number | null;
      dueDate?: string | null;
      description?: string | null;
      paymentId?: string;
    };
  }
) {
  const from = args.from.filter((status) =>
    status === args.to
      ? (EDITABLE_PAYMENT_REQUEST_STATUSES as readonly string[]).includes(
          status
        )
      : canTransitionPaymentRequest(status, args.to)
  );
  if (!from.length) {
    throw new PaymentRequestRefusal(
      `A request cannot move to ${args.to} from ${args.from.join(" or ")}`
    );
  }
  const row = await db
    .updateTable("paymentRequest")
    .set({
      ...args.patch,
      status: args.to,
      updatedBy: args.userId,
      updatedAt: new Date().toISOString()
    })
    .where("id", "=", args.requestId)
    .where("companyId", "=", args.companyId)
    .where("status", "in", from)
    .returning(PAYMENT_REQUEST_COLUMNS)
    .executeTakeFirst();
  if (!row) {
    throw new PaymentRequestRefusal(
      "This request changed. Reload and try again."
    );
  }
  return row;
}

/** The statuses a request may be settled from. */
const SETTLEABLE: readonly PaymentRequestStatus[] = [
  "Planned",
  "Ready",
  "Sent",
  "Cancelled"
];

/**
 * The only writer of Paid. Links the payment and sets Paid. A request that is
 * already Paid by this payment returns null, so a repeated sync is a no-op.
 * The caller runs it in the transaction that writes the payment.
 */
export async function settlePaymentRequest(
  db: Db,
  args: {
    companyId: string;
    userId: string;
    requestId: string;
    paymentId: string;
  }
) {
  const current = await readRequest(db, args.companyId, args.requestId);
  if (current.status === "Paid") {
    if (current.paymentId === args.paymentId) return null;
    throw new PaymentRequestRefusal(
      "This request is already paid by another payment"
    );
  }
  const payment = await db
    .selectFrom("payment")
    .select(["id", "status", "supplierId", "purchaseOrderId"])
    .where("id", "=", args.paymentId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!payment) throw new PaymentRequestRefusal("Payment not found");
  if (payment.status !== "Posted") {
    throw new PaymentRequestRefusal("Post the payment before linking it");
  }
  const document = await lockPaymentRequestTarget(
    db,
    args.companyId,
    targetOf(current)
  );
  if (payment.supplierId !== document.supplierId) {
    throw new PaymentRequestRefusal(
      "The payment is to another supplier than the request's document"
    );
  }
  if (
    current.purchaseOrderId &&
    payment.purchaseOrderId !== current.purchaseOrderId
  ) {
    throw new PaymentRequestRefusal(
      "A deposit request is paid by a prepayment on its own purchase order"
    );
  }
  return transitionPaymentRequest(db, {
    companyId: args.companyId,
    userId: args.userId,
    requestId: current.id,
    from: SETTLEABLE,
    to: "Paid",
    patch: { paymentId: args.paymentId }
  });
}

/**
 * The automatic request a posting creates, in the posting's transaction.
 * Created only when a spend integration pushes bills, the supplier is not an
 * employee, the invoice has no live request, and it did not come from Ramp. Planned when an order on the
 * invoice still holds unapplied prepayment, so Ramp never receives a balance
 * a prepayment still covers; Ready otherwise.
 */
export async function createAutomaticPaymentRequest(
  db: Db,
  args: {
    companyId: string;
    userId: string;
    invoiceId: string;
    dueDate: string | null;
    purchaseOrderIds: readonly string[];
  }
) {
  const { companyId, invoiceId } = args;
  const gate = await db
    .selectFrom("purchaseInvoices as pi")
    .innerJoin("supplier as s", "s.id", "pi.supplierId")
    .leftJoin("supplierType as st", "st.id", "s.supplierTypeId")
    .select((eb) => [
      "pi.balance",
      "pi.dateDue",
      "st.name as supplierType",
      eb
        .exists(
          eb
            .selectFrom("companyIntegration as ci")
            .select("ci.id")
            .where("ci.companyId", "=", companyId)
            .where("ci.id", "=", "ramp")
            .where("ci.active", "=", true)
            .where(
              sql<boolean>`COALESCE(ci."metadata"->>'pushInvoices', 'true') <> 'false'`
            )
        )
        .as("pushesBills"),
      eb
        .exists(
          eb
            .selectFrom("paymentRequest as r")
            .select("r.id")
            .where("r.companyId", "=", companyId)
            .where("r.purchaseInvoiceId", "=", invoiceId)
            .where("r.status", "!=", "Cancelled")
        )
        .as("hasRequest"),
      // A bill entered in Ramp is staged with this mapping, then posted
      // through the same code: Ramp already has it.
      eb
        .exists(
          eb
            .selectFrom("externalIntegrationMapping as m")
            .select("m.id")
            .where("m.companyId", "=", companyId)
            .where("m.integration", "=", "ramp")
            .where("m.entityType", "=", "bill")
            .where("m.entityId", "=", invoiceId)
        )
        .as("fromRamp")
    ])
    .where("pi.id", "=", invoiceId)
    .where("pi.companyId", "=", companyId)
    .executeTakeFirst();
  if (!gate || !gate.pushesBills || gate.hasRequest || gate.fromRamp) {
    return null;
  }
  if (gate.supplierType === "Employee") return null;
  const amount = money(Number(gate.balance ?? 0));
  if (amount <= 0) return null;

  const status = (await hasUnappliedPrepayment(
    db,
    companyId,
    args.purchaseOrderIds
  ))
    ? "Planned"
    : "Ready";
  const dueDate = args.dueDate ?? gate.dateDue ?? null;
  const { request } = await createPaymentRequest(db, {
    companyId,
    userId: args.userId,
    target: { purchaseInvoiceId: invoiceId },
    status: dueDate ? status : "Planned",
    amount,
    dueDate,
    isAutomatic: true
  });
  return request;
}

/** Whether a Posted prepayment on one of the orders still holds cash. */
async function hasUnappliedPrepayment(
  db: Db,
  companyId: string,
  purchaseOrderIds: readonly string[]
) {
  if (!purchaseOrderIds.length) return false;
  const row = await db
    .selectFrom("payment as p")
    .select("p.id")
    .where("p.companyId", "=", companyId)
    .where("p.purchaseOrderId", "in", [...purchaseOrderIds])
    .where("p.status", "=", "Posted")
    .where("p.paymentType", "=", "Disbursement")
    .where(
      sql<boolean>`p."totalAmount" > COALESCE((
        SELECT SUM(COALESCE(s."sourceAmount", s."appliedAmount"))
        FROM "invoiceSettlement" s
        JOIN "payment" via ON via."id" = s."paymentId" AND via."companyId" = s."companyId"
        WHERE s."companyId" = p."companyId"
          AND via."status" = 'Posted'
          AND (s."sourcePaymentId" = p."id" OR s."paymentId" = p."id")
      ), 0) + 0.005`
    )
    .limit(1)
    .executeTakeFirst();
  return Boolean(row);
}

/** The requests of one document, with the figures the card and form show. */
export async function getPaymentRequestsForDocument(
  db: Db,
  args: { companyId: string; target: PaymentRequestTarget }
) {
  const [requests, totals] = await Promise.all([
    db
      .selectFrom("paymentRequest")
      .select(PAYMENT_REQUEST_COLUMNS)
      .where("companyId", "=", args.companyId)
      .where(
        args.target.purchaseInvoiceId ? "purchaseInvoiceId" : "purchaseOrderId",
        "=",
        args.target.purchaseInvoiceId ?? args.target.purchaseOrderId!
      )
      .orderBy("requestNumber")
      .execute(),
    getRequestAllowance(db, args)
  ]);
  const planned = money(
    requests
      .filter((r) => r.status === "Planned")
      .reduce((sum, r) => sum + Number(r.amount ?? 0), 0)
  );
  return { requests, ...totals, planned };
}
