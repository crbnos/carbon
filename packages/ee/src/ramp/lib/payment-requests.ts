// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Ready payment requests → Ramp draft bills, one bill per request.
 *
 * Spec: .ai/specs/2026-11-23-supplier-payment-requests.md ("Ramp: outbound").
 * Selection is by status, not by a posting-date window, so a request on an old
 * (even pre-cutover) invoice still goes out. The bill has ONE line coded to a
 * balance-sheet account: the AP control account for an invoice request (it pays
 * a liability Carbon already booked), the supplier prepayment account for a
 * deposit request. So the push needs no posted journal.
 *
 * Retry safety (Ramp documents no idempotency window on bill create):
 *   1. a request already mapped skips straight to step 4;
 *   2. otherwise Ramp is asked for a draft or bill with this `remote_id`;
 *   3. only when it has neither is the draft created;
 *   4. the mapping and Ready → Sent commit in one transaction.
 * A run that stops between 3 and 4 finds its bill at step 2 next time, and
 * Ramp itself refuses a second draft with the same `remote_id`
 * (`409 DEVELOPER_7153`, verified live 2026-09-27).
 */

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  PAYMENT_REQUEST_MAPPING_ENTITY,
  PaymentRequestRefusal,
  transitionPaymentRequest
} from "@carbon/database/payment-requests";
import { sql } from "kysely";
import { createMappingService } from "../../accounting/core/external-mapping";
import { loadPushedCoding } from "../../spend/bill-source";
import {
  describeMissingVendorFields,
  loadSpendVendorParties
} from "../../spend/parties";
import { buildRampIdempotencyKey, type RampClient } from "./client";
import { buildLineCodingSelections } from "./coding";
import {
  prepareRampVendorResolution,
  resolveOrCreateRampSpendVendor
} from "./spend";

/** The mapping a pushed request keeps: request id → Ramp draft bill id. */
export const RAMP_PAYMENT_REQUEST_ENTITY = PAYMENT_REQUEST_MAPPING_ENTITY;

export type ReadyPaymentRequest = {
  id: string;
  requestNumber: number;
  amount: string;
  currencyCode: string;
  dueDate: string;
  description: string | null;
  supplierId: string;
  /** "invoice" pays part of a posted invoice; "order" is a deposit. */
  kind: "invoice" | "order";
  readableId: string;
  supplierReference: string | null;
  issuedAt: string | null;
  purchaseOrderReadableIds: string[];
  accountId: string | null;
  draftBillId: string | null;
};

/** Ramp's `invoice_number` must differ per bill: the supplier's (or Carbon's) number plus `-R{n}`. */
export function paymentRequestInvoiceNumber(r: {
  supplierReference: string | null;
  readableId: string;
  requestNumber: number;
}) {
  return `${(r.supplierReference ?? "").trim() || r.readableId}-R${r.requestNumber}`;
}

/** `APV-000500 · PO-000300 · request 2`: a human trace back to Carbon. */
export function paymentRequestMemo(r: {
  readableId: string;
  purchaseOrderReadableIds: string[];
  requestNumber: number;
  description: string | null;
}) {
  return [
    r.readableId,
    ...r.purchaseOrderReadableIds.filter((id) => id !== r.readableId),
    `request ${r.requestNumber}`,
    r.description?.trim() || null
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Every Ready request with what its bill needs, in one read. */
export async function loadReadyPaymentRequests(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<ReadyPaymentRequest[]> {
  const rows = await db
    .selectFrom("paymentRequest as r")
    .leftJoin("purchaseInvoice as pi", "pi.id", "r.purchaseInvoiceId")
    .leftJoin("purchaseOrder as po", (join) =>
      join
        .onRef("po.id", "=", "r.purchaseOrderId")
        .onRef("po.companyId", "=", "r.companyId")
    )
    .leftJoin("accountDefault as ad", "ad.companyId", "r.companyId")
    .leftJoin("externalIntegrationMapping as m", (join) =>
      join
        .onRef("m.entityId", "=", "r.id")
        .onRef("m.companyId", "=", "r.companyId")
        .on("m.integration", "=", "ramp")
        .on("m.entityType", "=", RAMP_PAYMENT_REQUEST_ENTITY)
    )
    .select([
      "r.id",
      "r.requestNumber",
      "r.amount",
      "r.currencyCode",
      "r.dueDate",
      "r.description",
      "r.purchaseInvoiceId",
      "pi.invoiceId as invoiceReadableId",
      "po.purchaseOrderId as orderReadableId",
      sql<string>`COALESCE(pi."supplierId", po."supplierId")`.as("supplierId"),
      sql<
        string | null
      >`COALESCE(pi."supplierReference", po."supplierReference")`.as(
        "supplierReference"
      ),
      "pi.dateIssued",
      sql<string | null>`CASE WHEN r."purchaseInvoiceId" IS NOT NULL
        THEN ad."payablesAccount" ELSE ad."supplierPrepaymentAccount" END`.as(
        "accountId"
      ),
      sql<string[] | null>`(
        SELECT array_agg(DISTINCT o."purchaseOrderId" ORDER BY o."purchaseOrderId")
        FROM "purchaseInvoiceLine" l
        JOIN "purchaseOrder" o ON o."id" = l."purchaseOrderId"
        WHERE l."invoiceId" = r."purchaseInvoiceId"
      )`.as("invoiceOrderIds"),
      "m.externalId as draftBillId"
    ])
    .where("r.companyId", "=", companyId)
    .where("r.status", "=", "Ready")
    // An invoice's requests go out once it is posted, and never for a void.
    .where((eb) =>
      eb.or([
        eb("r.purchaseInvoiceId", "is", null),
        eb("pi.status", "not in", ["Draft", "Pending", "Voided"])
      ])
    )
    .orderBy("r.dueDate")
    .orderBy("r.id")
    .execute();

  return rows.map((row) => {
    const isInvoice = Boolean(row.purchaseInvoiceId);
    return {
      id: row.id,
      requestNumber: row.requestNumber,
      amount: String(row.amount),
      currencyCode: row.currencyCode,
      dueDate: String(row.dueDate).slice(0, 10),
      description: row.description,
      supplierId: row.supplierId,
      kind: isInvoice ? "invoice" : "order",
      readableId:
        (isInvoice ? row.invoiceReadableId : row.orderReadableId) ?? row.id,
      supplierReference: row.supplierReference,
      issuedAt: row.dateIssued ? String(row.dateIssued).slice(0, 10) : null,
      purchaseOrderReadableIds: isInvoice
        ? (row.invoiceOrderIds ?? [])
        : row.orderReadableId
          ? [row.orderReadableId]
          : [],
      accountId: row.accountId,
      draftBillId: row.draftBillId
    };
  });
}

export type PaymentRequestPushResult = {
  sent: Array<{ id: string; draftBillId: string }>;
  failed: Array<{ id: string; message: string }>;
};

/**
 * Sends every Ready request to Ramp and marks it Sent. One request's failure
 * is reported and does not stop the others.
 */
export async function pushReadyPaymentRequests(args: {
  db: Kysely<KyselyDatabase>;
  ramp: RampClient;
  companyId: string;
  userId: string;
  /** The integration whose coding options Ramp shows (see `RampProvider`). */
  codingIdentityIntegrationId?: string;
}): Promise<PaymentRequestPushResult> {
  const { db, ramp, companyId } = args;
  const result: PaymentRequestPushResult = { sent: [], failed: [] };
  const requests = await loadReadyPaymentRequests(db, companyId);
  if (requests.length === 0) return result;

  const mapping = createMappingService(db, companyId);
  const delegatedTo = args.codingIdentityIntegrationId;
  const unsent = requests.filter((r) => !r.draftBillId);
  // Vendors, their resolution and the coding options: once per run.
  const parties = unsent.length
    ? await loadSpendVendorParties(db, companyId, [
        ...new Set(unsent.map((r) => r.supplierId))
      ])
    : new Map();
  const [resolution, pushed] = unsent.length
    ? await Promise.all([
        prepareRampVendorResolution(mapping, ramp, [...parties.values()], {
          accountingIntegration: delegatedTo
        }),
        loadPushedCoding(mapping, delegatedTo ?? "ramp", {
          useExternalIds: Boolean(delegatedTo)
        })
      ])
    : [null, null];

  for (const request of requests) {
    try {
      const draftBillId =
        request.draftBillId ??
        (await ramp.findBillIdByRemoteId(request.id)) ??
        (await createDraft(request));
      await db.transaction().execute(async (tx) => {
        await createMappingService(tx, companyId).link(
          RAMP_PAYMENT_REQUEST_ENTITY,
          request.id,
          "ramp",
          draftBillId,
          { createdBy: args.userId }
        );
        try {
          await transitionPaymentRequest(tx, {
            companyId,
            userId: args.userId,
            requestId: request.id,
            from: ["Ready"],
            to: "Sent"
          });
        } catch (err) {
          // Cancelled or moved back while the draft was being made: the
          // mapping still records the draft Ramp now holds.
          if (!(err instanceof PaymentRequestRefusal)) throw err;
        }
      });
      result.sent.push({ id: request.id, draftBillId });
    } catch (err) {
      result.failed.push({
        id: request.id,
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return result;

  async function createDraft(request: ReadyPaymentRequest): Promise<string> {
    const supplier = parties.get(request.supplierId);
    if (!supplier || !resolution || !pushed) {
      throw new Error(`Supplier ${request.supplierId} not found`);
    }
    const vendorId = await resolveOrCreateRampSpendVendor(
      mapping,
      ramp,
      supplier,
      companyId,
      resolution,
      { surfaceCreateError: true }
    );
    if (!vendorId) {
      throw new Error(
        `Cannot send ${request.readableId} request ${request.requestNumber} to Ramp: ${describeMissingVendorFields(supplier)}`
      );
    }
    const created = await ramp.createDraftBill<{ id?: string }>(
      {
        vendor_id: vendorId,
        remote_id: request.id,
        invoice_number: paymentRequestInvoiceNumber(request),
        invoice_currency: request.currencyCode,
        due_at: request.dueDate,
        ...(request.issuedAt ? { issued_at: request.issuedAt } : {}),
        memo: paymentRequestMemo(request),
        line_items: [
          {
            memo: request.description ?? undefined,
            amount: Number(request.amount),
            accounting_field_selections: buildLineCodingSelections(
              {
                accountId: request.accountId,
                costCenterId: null,
                projectId: null
              },
              pushed
            )
          }
        ]
      },
      buildRampIdempotencyKey({
        companyId,
        operation: "createPaymentRequestBill",
        scope: request.id
      })
    );
    if (!created?.id) {
      throw new Error(
        `Ramp did not return a draft bill for ${request.readableId} request ${request.requestNumber}`
      );
    }
    return created.id;
  }
}
