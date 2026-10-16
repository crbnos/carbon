// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isDataLayerError } from "@carbon/api/errors";
import {
  CarbonError,
  type ErrorCategory,
  type ServiceContext
} from "@carbon/api/service-fn.server";
import { hasPermission } from "@carbon/auth";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database, Json } from "@carbon/database";
import {
  fetchAllByIds,
  fetchAllFromTable,
  fetchAllRecords,
  getCompanyTimeZone
} from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  convertUnitPrice,
  supplierPartCurrency
} from "@carbon/database/supplier-part-price";
import { PurchaseOrderEmail } from "@carbon/documents/email";
import { getPurchaseOrderDisplayId } from "@carbon/documents/pdf";
import { insertAuditLogEntries } from "@carbon/ee/audit.server";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { type ServerFnInput, serverFns } from "@carbon/server-functions";
import {
  cutLeasePaymentRows,
  type DraftedLeaseInvoice
} from "@carbon/server-functions/create-lease-invoices";
import {
  async,
  datetime,
  EPSILON,
  getPurchaseOrderStatus,
  getPurchaseReturnOrderStatus,
  openEndedLeaseHorizon,
  RoundingMode,
  round
} from "@carbon/utils";
import { renderAsync } from "@react-email/components";
import {
  PostgrestError,
  type PostgrestResponse,
  type PostgrestSingleResponse,
  type SupabaseClient
} from "@supabase/supabase-js";
import { sql, type Transaction } from "kysely";
import type { z } from "zod";
import { getPaymentTermsList } from "~/modules/accounting/accounting.service";
import {
  createDocumentUploadUrl,
  upsertDocument
} from "~/modules/documents/documents.service";
import { getEmployeeJob } from "~/modules/people/people.service";
import {
  getCompany,
  getCompanySettings
} from "~/modules/settings/settings.service";
import { getUser } from "~/modules/users/users.service";
import { path } from "~/utils/path";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { stripSpecialCharacters } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import {
  getCurrencyByCode,
  getExchangeRate
} from "../accounting/accounting.service";
import type { PurchaseInvoice } from "../invoicing/types";
import {
  claimPlanningActions,
  releasePlanningActionClaims
} from "../production/planning-action-claims";
import { upsertExternalLink } from "../shared/shared.service";
import { updateSortOrder } from "../shared/sort-order";
import type {
  leasePaymentValidator,
  leaseValidator,
  purchaseOrderDeliveryValidator,
  purchaseOrderLineValidator,
  purchaseOrderPaymentValidator,
  purchaseOrderStatusType,
  purchaseOrderTypeType,
  purchaseOrderValidator,
  purchaseReturnOrderLineValidator,
  purchaseReturnOrderStatusType,
  purchaseReturnOrderValidator,
  purchasingRfqStatusType,
  selectedLinesValidator,
  supplierAccountingValidator,
  supplierBankAccountValidator,
  supplierContactValidator,
  supplierPaymentValidator,
  supplierProcessValidator,
  supplierQuoteLineValidator,
  supplierQuoteStatusType,
  supplierQuoteValidator,
  supplierShippingValidator,
  supplierTaxValidator,
  supplierTypeValidator,
  supplierValidator
} from "./purchasing.models";
import {
  leaseDetailFields,
  leaseLineColumns,
  leaseLinePaymentFields,
  type leaseLineValidator,
  leasePaymentTermFields,
  leaseTermColumns,
  PLANNING_EDITABLE_PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_LOCKED_STATUSES,
  type PURCHASE_ORDER_REOPEN_STATUSES,
  taxPairForQuantity
} from "./purchasing.models";
import { renderPurchaseOrderPdf } from "./purchasing.pdf";
import type { PurchaseOrder, PurchasingRFQ, SupplierQuote } from "./types";

const PURCHASE_ORDERS_LIST_COLUMNS =
  "id,purchaseOrderId,revisionId,status,orderDate,supplierId,supplierReference,assignee,companyId,customFields,createdAt,createdBy,updatedAt,updatedBy,thumbnailPath,itemType,orderTotal,receivableQuantity,receivedQuantity,shippingMethodId,receiptRequestedDate,receiptPromisedDate,deliveryDate,dropShipment,paymentTermId,createdByFullName,assigneeFullName" as const;

const logger = getLogger("erp", "purchasing-service");

export async function closePurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string,
  userId: string
) {
  const purchaseOrder = await client
    .from("purchaseOrder")
    .select("companyId")
    .eq("id", purchaseOrderId)
    .single();
  const companyTz = await getCompanyTimeZone(
    client,
    purchaseOrder.data?.companyId ?? ""
  );
  return client
    .from("purchaseOrder")
    .update({
      status: "Closed",
      closedAt: datetime.today(companyTz).toString(),
      closedBy: userId,
      updatedBy: userId
    })
    .eq("id", purchaseOrderId)
    .select("id")
    .single();
}

export async function convertSupplierQuoteToOrder(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  payload: {
    id: string;
    selectedLines: z.infer<typeof selectedLinesValidator>;
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, ...input } = payload;
  return serverFns.as({ client, db, companyId, userId }).invoke("convert", {
    type: "supplierQuoteToPurchaseOrder",
    ...input
  });
}

/** Not published: `purchasing_deletePurchaseOrders` deletes, with the status and approval checks this skips. */
export async function deletePurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client.from("purchaseOrder").delete().eq("id", purchaseOrderId);
}

/**
 * A purchase order raised by the planning pages skips the approval rule
 * (`purchaseOrder.createdFromPlanning`, with the company's
 * `skipApprovalForPlanningPurchaseOrders`). Any manual change to its lines
 * forfeits that, so an MRP order cannot be padded to dodge approval: the line
 * writers below clear the flag BEFORE they write — a failed clear stops the
 * write, so a line never changes while the PO still skips approval. Planning
 * restores the flag after its own line writes (`planning.update.tsx`).
 */
async function clearPlanningOrigin(
  client: SupabaseClient<Database>,
  where: { purchaseOrderId: string } | { purchaseOrderLineId: string }
) {
  let purchaseOrderId: string | null;
  if ("purchaseOrderId" in where) {
    purchaseOrderId = where.purchaseOrderId;
  } else {
    const line = await client
      .from("purchaseOrderLine")
      .select("purchaseOrderId")
      .eq("id", where.purchaseOrderLineId)
      .maybeSingle();
    if (line.error) return { error: line.error };
    purchaseOrderId = line.data?.purchaseOrderId ?? null;
  }
  if (!purchaseOrderId) return { error: null };
  const cleared = await client
    .from("purchaseOrder")
    .update({ createdFromPlanning: false })
    .eq("id", purchaseOrderId)
    .eq("createdFromPlanning", true);
  return { error: cleared.error };
}

export async function deletePurchaseOrderLine(
  client: SupabaseClient<Database>,
  purchaseOrderLineId: string
) {
  const cleared = await clearPlanningOrigin(client, { purchaseOrderLineId });
  if (cleared.error) return { data: null, error: cleared.error };
  return client
    .from("purchaseOrderLine")
    .delete()
    .eq("id", purchaseOrderLineId);
}

// Creates a new Draft PO header + delivery + payment via insertPurchaseOrder
// and copies the source PO's lines into it. Receipt/invoice progress is
// reset; only the order/line definition is duplicated.
export async function duplicatePurchaseOrder(
  client: SupabaseClient<Database>,
  {
    sourcePurchaseOrderId,
    companyId,
    companyGroupId,
    userId
  }: {
    sourcePurchaseOrderId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
  }
): Promise<{
  data: { id: string; purchaseOrderId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const [source, sourceDelivery, sourceLines] = await Promise.all([
    client
      .from("purchaseOrder")
      .select(
        "id, supplierId, supplierContactId, supplierLocationId, supplierReference, currencyCode, purchaseOrderType, internalNotes, externalNotes"
      )
      .eq("id", sourcePurchaseOrderId)
      .eq("companyId", companyId)
      .single(),
    client
      .from("purchaseOrderDelivery")
      .select("locationId, receiptRequestedDate")
      .eq("id", sourcePurchaseOrderId)
      .maybeSingle(),
    client
      .from("purchaseOrderLine")
      .select(
        "purchaseOrderLineType, itemId, assetId, description, purchaseQuantity, supplierUnitPrice, inventoryUnitOfMeasureCode, purchaseUnitOfMeasureCode, locationId, storageUnitId, setupPrice, customFields, conversionFactor, tags, internalNotes, externalNotes, exchangeRate, supplierShippingCost, modelUploadId, supplierTaxAmount, taxPercent, jobId, jobOperationId, promisedDate, requiredDate, accountId, costCenterId, ownerId, sortOrder, supplierPartId"
      )
      .eq("purchaseOrderId", sourcePurchaseOrderId)
      .eq("companyId", companyId)
  ]);

  if (source.error || !source.data) {
    return { data: null, error: source.error };
  }
  if (sourceLines.error) {
    return { data: null, error: sourceLines.error };
  }

  const insertResult = await insertPurchaseOrder(client, {
    supplierId: source.data.supplierId,
    supplierContactId: source.data.supplierContactId ?? undefined,
    supplierLocationId: source.data.supplierLocationId ?? undefined,
    supplierReference: source.data.supplierReference ?? undefined,
    currencyCode: source.data.currencyCode ?? undefined,
    purchaseOrderType: source.data.purchaseOrderType ?? undefined,
    notes: source.data.internalNotes ?? undefined,
    externalNotes: source.data.externalNotes ?? undefined,
    locationId: sourceDelivery.data?.locationId ?? undefined,
    receiptRequestedDate:
      sourceDelivery.data?.receiptRequestedDate ?? undefined,
    status: "Draft",
    companyId,
    companyGroupId,
    createdBy: userId
  });

  if (insertResult.error || !insertResult.data) {
    return insertResult;
  }

  const newId = insertResult.data.id;

  if (sourceLines.data && sourceLines.data.length > 0) {
    const lineRows = sourceLines.data.map((line) => ({
      ...line,
      purchaseOrderId: newId,
      companyId,
      createdBy: userId
    }));
    const lineInsert = await client
      .from("purchaseOrderLine")
      .insert(lineRows as never);
    if (lineInsert.error) {
      // Best-effort rollback so we don't leave an orphan header.
      await deletePurchaseOrder(client, newId);
      return { data: null, error: lineInsert.error };
    }
  }

  return insertResult;
}

export async function deleteSupplier(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client.from("supplier").delete().eq("id", supplierId);
}

export async function deleteSupplierContact(
  client: SupabaseClient<Database>,
  supplierId: string,
  supplierContactId: string
) {
  const supplierContact = await client
    .from("supplierContact")
    .select("contactId")
    .eq("supplierId", supplierId)
    .eq("id", supplierContactId)
    .single();
  if (supplierContact.data) {
    const contactDelete = await client
      .from("contact")
      .delete()
      .eq("id", supplierContact.data.contactId);

    if (contactDelete.error) {
      return contactDelete;
    }
  }
  return supplierContact;
}

export async function deleteSupplierLocation(
  client: SupabaseClient<Database>,
  supplierId: string,
  supplierLocationId: string
) {
  const { data: supplierLocation } = await client
    .from("supplierLocation")
    .select("addressId")
    .eq("supplierId", supplierId)
    .eq("id", supplierLocationId)
    .single();

  if (supplierLocation?.addressId) {
    return client.from("address").delete().eq("id", supplierLocation.addressId);
  } else {
    // The supplierLocation should always have an addressId, but just in case
    return client
      .from("supplierLocation")
      .delete()
      .eq("supplierId", supplierId)
      .eq("id", supplierLocationId);
  }
}

export async function deleteSupplierBankAccount(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("supplierBankAccount").delete().eq("id", id);
}

/**
 * Lists a supplier's bank accounts.
 *
 * Gated on accounting, as the table's RLS and every bank-account screen are:
 * a changed payee account is how payment fraud starts.
 */
export async function getSupplierBankAccounts(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierBankAccount")
    .select("*")
    .eq("supplierId", supplierId)
    .order("name");
}

export async function upsertSupplierBankAccount(
  db: Kysely<KyselyDatabase>,
  bankAccount:
    | (Omit<z.infer<typeof supplierBankAccountValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierBankAccountValidator>, "id"> & {
        id: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  const { supplierId, companyId } = bankAccount;

  if ("createdBy" in bankAccount) {
    return await db
      .insertInto("supplierBankAccount")
      .values(bankAccount)
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  const { id, ...update } = bankAccount;

  // supplierId and companyId are scoping columns, not editable fields. They are
  // also re-asserted in the WHERE clause so a forged form value cannot move
  // this row to another supplier.
  return await db
    .updateTable("supplierBankAccount")
    .set({ ...update, updatedAt: datetime.timestamp() })
    .where("id", "=", id)
    .where("supplierId", "=", supplierId)
    .where("companyId", "=", companyId)
    .returning("id")
    .executeTakeFirstOrThrow();
}

export async function deleteSupplierProcess(
  client: SupabaseClient<Database>,
  supplierProcessId: string
) {
  return client.from("supplierProcess").delete().eq("id", supplierProcessId);
}

export async function deleteSupplierQuote(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
) {
  return client.from("supplierQuote").delete().eq("id", supplierQuoteId);
}

export async function deleteSupplierQuoteLine(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("supplierQuoteLine").delete().eq("id", id);
}

export async function deleteSupplierType(
  client: SupabaseClient<Database>,
  supplierTypeId: string
) {
  return client.from("supplierType").delete().eq("id", supplierTypeId);
}

export async function getPurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchaseOrders")
    .select("*")
    .eq("id", purchaseOrderId)
    .single();
}

/** Not published: `purchasing_finalizeSupplierQuoteWithLink` finalizes, with the supplier contact rule and share link. */
export async function finalizeSupplierQuote(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  payload: { supplierQuoteId: string; companyId: string; userId: string }
) {
  const { companyId, userId, ...input } = payload;
  return serverFns
    .as({ client, db, companyId, userId })
    .invoke("finalize-supplier-quote", input);
}

/** Not published: `purchasing_finalizePurchasingRfqAndNotify` sends an RFQ, and emails the suppliers. */
export async function finalizePurchasingRfq(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  payload: { rfqId: string; companyId: string; userId: string }
) {
  const { companyId, userId, ...input } = payload;
  return serverFns
    .as({ client, db, companyId, userId })
    .invoke("finalize-purchasing-rfq", input);
}

export async function getPurchaseOrders(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("purchaseOrders")
    .select(PURCHASE_ORDERS_LIST_COLUMNS, { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `purchaseOrderId.ilike.%${args.search}%,supplierReference.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.eq("supplierId", args.supplierId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "purchaseOrderId", ascending: false }
  ]);

  return query;
}

export async function getPurchaseOrderDelivery(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchaseOrderDelivery")
    .select("*")
    .eq("id", purchaseOrderId)
    .single();
}

export async function getPurchaseOrderLocations(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchaseOrderLocations")
    .select("*")
    .eq("id", purchaseOrderId)
    .single();
}

export async function getPurchaseOrderPayment(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchaseOrderPayment")
    .select("*")
    .eq("id", purchaseOrderId)
    .single();
}

export async function getPurchaseOrderLines(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchaseOrderLines")
    .select("*")
    .eq("purchaseOrderId", purchaseOrderId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getPurchaseOrderLine(
  client: SupabaseClient<Database>,
  purchaseOrderLineId: string
) {
  return client
    .from("purchaseOrderLines")
    .select("*")
    .eq("id", purchaseOrderLineId)
    .single();
}

export async function getPurchaseOrderSuppliers(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("purchaseOrderSuppliers")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getPurchasingDocumentsAssignedToMe(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  const [purchaseOrders, supplierQuotes, purchaseInvoices] = await Promise.all([
    client
      .from("purchaseOrder")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId),
    client
      .from("supplierQuote")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId),
    client
      .from("purchaseInvoice")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId)
  ]);

  const merged = [
    ...(purchaseOrders.data?.map((doc) => ({
      ...doc,
      type: "purchaseOrder"
    })) ?? []),
    ...(supplierQuotes.data?.map((doc) => ({
      ...doc,
      type: "supplierQuote"
    })) ?? []),
    ...(purchaseInvoices.data?.map((doc) => ({
      ...doc,
      type: "purchaseInvoice"
    })) ?? [])
  ].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  return merged;
}

export async function getPurchasingPlanning(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  periods: string[],
  args: GenericQueryFilters & {
    search: string | null;
    /** Today on the location's calendar (ISO date): the day each item's
     *  planning horizon is counted from. */
    asOf: string;
    /** Keep only items with an OPEN planning action of one of these types
     *  inside the item's planning horizon (the grid's Actions filter). */
    actionTypes?: string[];
    /** Keep only items with such an action assigned to this user ("Assigned
     *  to me"). Combined with `actionTypes` on the SAME action. */
    actionAssignees?: string[];
  }
) {
  // The grid RPC wraps get_purchasing_planning: same rows and projection, plus the
  // item group, the planning horizon / time fence date, the first week the
  // projection goes negative and the latest order date — and it evaluates the
  // action filter in the database, so it is complete at any volume and paging
  // stays correct.
  let query = client.rpc(
    "get_purchasing_planning_grid",
    {
      location_id: locationId,
      company_id: companyId,
      periods,
      as_of: args.asOf,
      action_types: args.actionTypes,
      action_assignees: args.actionAssignees
    },
    {
      count: LIST_COUNT
    }
  );

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
    );
  }

  // What the row's Order / Make button offers (the grid RPC's orderQuantity,
  // from MRP's open new-supply actions), then the part number so a page is
  // stable when many rows have nothing to order.
  query = setGenericQueryFilters(query, args, [
    { column: "orderQuantity", ascending: false },
    { column: "readableIdWithRevision", ascending: true }
  ]);

  return query;
}

export async function getPurchasingTerms(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("terms")
    .select("purchasingTerms")
    .eq("id", companyId)
    .single();
}

export async function getSupplier(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client.from("suppliers").select("*").eq("id", supplierId).single();
}

export async function getSupplierContact(
  client: SupabaseClient<Database>,
  supplierContactId: string,
  companyId?: string
) {
  let query = client
    .from("supplierContact")
    .select(
      "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes)"
    )
    .eq("id", supplierContactId);
  if (companyId) query = query.eq("companyId", companyId);
  return query.single();
}

export async function getSupplierContacts(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierContact")
    .select(
      "*, contact(id, fullName, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes), user(id, active)"
    )
    .eq("supplierId", supplierId);
}

export async function getSupplierInteraction(
  client: SupabaseClient<Database>,
  opportunityId: string | null
): Promise<
  PostgrestSingleResponse<{
    id: string;
    companyId: string;
    purchasingRfq: PurchasingRFQ | null;
    supplierQuotes: SupplierQuote[];
    purchaseOrders: PurchaseOrder[];
    purchaseInvoices: PurchaseInvoice[];
  } | null>
> {
  if (!opportunityId) {
    // @ts-expect-error
    return {
      data: null,
      error: null
    };
  }

  const response = await client.rpc(
    "get_supplier_interaction_with_related_records",
    {
      supplier_interaction_id: opportunityId
    }
  );

  return {
    data: response.data?.[0],
    error: response.error
  } as unknown as PostgrestSingleResponse<{
    id: string;
    companyId: string;
    purchasingRfq: PurchasingRFQ;
    supplierQuotes: SupplierQuote[];
    purchaseOrders: PurchaseOrder[];
    purchaseInvoices: PurchaseInvoice[];
  }>;
}

export async function getSupplierInteractionDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  interactionId: string
) {
  const result = await storage(client)
    .company(companyId)
    .list(`${companyId}/supplier-interaction/${interactionId}`);

  if (result.error) {
    logger.error("Failed to list supplier interaction documents", {
      error: result.error
    });
    return [];
  }

  return result.data.map((f) => ({
    ...f,
    bucket: "supplier-interaction"
  }));
}

export async function getSupplierInteractionLineDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  lineId: string
) {
  const result = await storage(client)
    .company(companyId)
    .list(`${companyId}/supplier-interaction-line/${lineId}`);

  if (result.error) {
    logger.error("Failed to list supplier interaction line documents", {
      error: result.error
    });
    return [];
  }

  return result.data.map((f) => ({
    ...f,
    bucket: "supplier-interaction-line"
  }));
}

/**
 * Signed links to every document attached to the given lines, for an email's
 * attachments. Lines are listed and signed together, in the lines' order.
 */
export async function getSupplierInteractionLineAttachments(
  client: SupabaseClient<Database>,
  companyId: string,
  lineIds: string[]
): Promise<{ filename: string; path: string }[]> {
  const perLine = await async.map(lineIds, async (lineId) => {
    const docs = await getSupplierInteractionLineDocuments(
      client,
      companyId,
      lineId
    );
    return async.map(docs, async (doc) => {
      const storagePath = `${companyId}/supplier-interaction-line/${lineId}/${doc.name}`;
      const { data, error } = await storage(client)
        .company(companyId)
        .createSignedUrl(storagePath, 3600);
      if (!data) {
        logger.error("Failed to create signed URL for attachment", {
          storagePath,
          error
        });
        return null;
      }
      return { filename: doc.name, path: data.signedUrl };
    });
  });
  return perLine
    .flat()
    .flatMap((attachment) => (attachment ? [attachment] : []));
}

export async function getSupplierLocations(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, stateProvince, country(alpha2, name), postalCode)"
    )
    .eq("supplierId", supplierId);
}

export async function getSupplierLocation(
  client: SupabaseClient<Database>,
  supplierContactId: string
) {
  return client
    .from("supplierLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, stateProvince, country(alpha2, name), postalCode)"
    )
    .eq("id", supplierContactId)
    .single();
}

export async function getSupplierPayment(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierPayment")
    .select("*")
    .eq("supplierId", supplierId)
    .single();
}

export async function getSupplierProcessById(
  client: SupabaseClient<Database>,
  supplierProcessId: string
) {
  return client
    .from("supplierProcesses")
    .select("*")
    .eq("id", supplierProcessId)
    .single();
}

export async function getSupplierProcessesByProcess(
  client: SupabaseClient<Database>,
  processId: string
) {
  return client
    .from("supplierProcesses")
    .select("*")
    .eq("processId", processId);
}

export async function getSupplierProcessesBySupplier(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierProcesses")
    .select("*")
    .eq("supplierId", supplierId);
}

export async function getSupplierQuote(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
) {
  return client
    .from("supplierQuotes")
    .select("*")
    .eq("id", supplierQuoteId)
    .single();
}

export async function getSupplierQuoteByInteractionId(
  client: SupabaseClient<Database>,
  interactionId: string
) {
  return client
    .from("supplierQuotes")
    .select("*")
    .eq("supplierInteractionId", interactionId)
    .single();
}

export async function getSupplierQuoteByExternalLinkId(
  client: SupabaseClient<Database>,
  externalLinkId: string
) {
  return client
    .from("supplierQuote")
    .select("*")
    .eq("externalLinkId", externalLinkId)
    .single();
}

export async function getSupplierQuotes(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("supplierQuotes")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `supplierQuoteId.ilike.%${args.search}%,name.ilike.%${args.search}%,supplierReference.ilike%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "supplierQuoteId", ascending: false }
  ]);
  return query;
}

export async function getSupplierQuoteLine(
  client: SupabaseClient<Database>,
  supplierQuoteLineId: string
) {
  return client
    .from("supplierQuoteLines")
    .select("*")
    .eq("id", supplierQuoteLineId)
    .single();
}

export async function getSupplierQuoteLines(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
) {
  return client
    .from("supplierQuoteLines")
    .select("*")
    .eq("supplierQuoteId", supplierQuoteId)
    .order("sortOrder", { ascending: true });
}

export async function getSupplierQuoteLinePrices(
  client: SupabaseClient<Database>,
  supplierQuoteLineId: string
) {
  return client
    .from("supplierQuoteLinePrice")
    .select("*")
    .eq("supplierQuoteLineId", supplierQuoteLineId);
}

export async function getSupplierQuoteLinePricesByQuoteId(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
) {
  return client
    .from("supplierQuoteLinePrice")
    .select("*")
    .eq("supplierQuoteId", supplierQuoteId)
    .order("supplierQuoteLineId", { ascending: true });
}

export async function getSupplierQuotesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    supplierQuoteId: string;
  }>(client, "supplierQuote", "id, supplierQuoteId", (query) =>
    query.eq("companyId", companyId).order("createdAt", { ascending: false })
  );
}

export async function getSupplierShipping(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierShipping")
    .select("*")
    .eq("supplierId", supplierId)
    .single();
}

// Batched report data for the Suppliers CSV export: the Purchasing/Invoice/Shipping
// contact + address, one query per role. Queries supplierPayment/supplierShipping as
// the FROM table (forward FK to supplierContact/supplierLocation) rather than
// embedding them into `suppliers` — their FK back to supplier is composite
// (supplierId, companyId), which supabase-js's type generator marks `isOneToOne:
// false` even though supplierId alone is the real PK, so a reverse embed would type
// (and risk behaving) as an array instead of a single object.
export async function getSupplierReportContacts(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierIds: string[]
) {
  return Promise.all([
    client
      .from("supplier")
      .select(
        `id, purchasingContact:supplierContact!supplier_purchasingContactId_fkey(contact(fullName, email, workPhone))`
      )
      .eq("companyId", companyId)
      .in("id", supplierIds),
    client
      .from("supplierPayment")
      .select(
        `supplierId,
         invoiceContact:supplierContact!supplierPayment_invoiceSupplierContactId_fkey(contact(fullName, email, workPhone)),
         invoiceLocation:supplierLocation!supplierPayment_invoiceSupplierLocationId_fkey(address(addressLine1, addressLine2, city, stateProvince, postalCode, country(name)))`
      )
      .eq("companyId", companyId)
      .in("supplierId", supplierIds),
    client
      .from("supplierShipping")
      .select(
        `supplierId,
         shippingContact:supplierContact!supplierShipping_shippingSupplierContactId_fkey(contact(fullName, email, workPhone)),
         shippingLocation:supplierLocation!supplierShipping_shippingSupplierLocationId_fkey(address(addressLine1, addressLine2, city, stateProvince, postalCode, country(name)))`
      )
      .eq("companyId", companyId)
      .in("supplierId", supplierIds)
  ]);
}

export async function getSuppliers(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    type: string | null;
    status: string | null;
  }
) {
  let query = client
    .from("suppliers")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args.type) {
    query = query.eq("supplierTypeId", args.type);
  }

  if (args.status) {
    query = query.eq(
      "status",
      args.status as "Active" | "Inactive" | "Pending" | "Rejected"
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getSuppliersList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "supplier", "id, name", (query) =>
    query.eq("companyId", companyId).order("name")
  );
}

export async function getSupplierType(
  client: SupabaseClient<Database>,
  supplierTypeId: string
) {
  return client
    .from("supplierType")
    .select("*")
    .eq("id", supplierTypeId)
    .single();
}

export async function getSupplierTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("supplierType")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getSupplierTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("supplierType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function insertSupplier(
  client: SupabaseClient<Database>,
  supplier: Omit<z.infer<typeof supplierValidator>, "id"> & {
    companyId: string;
    createdBy: string;
    customFields?: Json;
  }
) {
  return client.from("supplier").insert([supplier]).select("*").single();
}

export async function insertSupplierContact(
  client: SupabaseClient<Database>,
  supplierContact: {
    supplierId: string;
    companyId: string;
    contact: z.infer<typeof supplierContactValidator>;
    supplierLocationId?: string;
    customFields?: Json;
  }
) {
  const insertContact = await client
    .from("contact")
    .insert([
      {
        ...supplierContact.contact,
        companyId: supplierContact.companyId,
        isCustomer: false
      }
    ])
    .select("id")
    .single();

  if (insertContact.error) {
    return insertContact;
  }

  const contactId = insertContact.data?.id;
  if (!contactId) {
    return { data: null, error: new Error("Contact ID not found") };
  }

  return client
    .from("supplierContact")
    .insert([
      {
        supplierId: supplierContact.supplierId,
        contactId,
        supplierLocationId: supplierContact.supplierLocationId,
        companyId: supplierContact.companyId,
        customFields: supplierContact.customFields
      }
    ])
    .select("id")
    .single();
}

export async function insertSupplierInteraction(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierId: string
) {
  return client
    .from("supplierInteraction")
    .insert([{ companyId, supplierId }])
    .select("id")
    .single();
}

export async function insertSupplierLocation(
  client: SupabaseClient<Database>,
  supplierLocation: {
    supplierId: string;
    companyId: string;
    name: string;
    address: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      stateProvince?: string;
      postalCode?: string;
      countryCode?: string;
    };
    customFields?: Json;
  }
) {
  const insertAddress = await client
    .from("address")
    .insert([
      { ...supplierLocation.address, companyId: supplierLocation.companyId }
    ])
    .select("id")
    .single();
  if (insertAddress.error) {
    return insertAddress;
  }

  const addressId = insertAddress.data?.id;
  if (!addressId) {
    return { data: null, error: new Error("Address ID not found") };
  }

  return client
    .from("supplierLocation")
    .insert([
      {
        supplierId: supplierLocation.supplierId,
        addressId,
        name: supplierLocation.name,
        companyId: supplierLocation.companyId,
        customFields: supplierLocation.customFields
      }
    ])
    .select("id")
    .single();
}

/** Not published: `purchasing_finalizePurchaseOrderAndNotify` finalizes, and runs the approval rule this skips. */
export async function finalizePurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string,
  userId: string
) {
  const [purchaseOrder, lines] = await Promise.all([
    getPurchaseOrder(client, purchaseOrderId),
    getPurchaseOrderLines(client, purchaseOrderId)
  ]);
  const { status } = getPurchaseOrderStatus(lines.data || []);

  const updateData: Database["public"]["Tables"]["purchaseOrder"]["Update"] = {
    status,
    updatedAt: datetime.timestamp(),
    updatedBy: userId
  };

  // Only set orderDate if it's not already set
  if (!purchaseOrder.data?.orderDate) {
    const companyTz = await getCompanyTimeZone(
      client,
      purchaseOrder.data?.companyId ?? ""
    );
    updateData.orderDate = datetime.today(companyTz).toString();
  }

  return client
    .from("purchaseOrder")
    .update(updateData)
    .eq("id", purchaseOrderId);
}

/** Not published: `purchasing_sendSupplierQuoteToSupplier` sends a quote, with its share link and email. */
export async function sendSupplierQuote(
  client: SupabaseClient<Database>,
  supplierQuoteId: string,
  userId: string
) {
  // Send keeps status as Draft, just updates timestamp
  const quoteUpdate = await client
    .from("supplierQuote")
    .update({
      updatedAt: datetime.timestamp(),
      updatedBy: userId
    })
    .eq("id", supplierQuoteId);

  if (quoteUpdate.error) {
    return quoteUpdate;
  }

  return { data: null, error: null };
}

/** @deprecated Use updatePurchaseOrderStatus or the new updatePurchaseOrder instead */
export async function updatePurchaseOrderStatusLegacy(
  client: SupabaseClient<Database>,
  purchaseOrder: {
    id: string;
    status: (typeof purchaseOrderStatusType)[number];
    updatedBy: string;
  }
) {
  return client
    .from("purchaseOrder")
    .update(purchaseOrder)
    .eq("id", purchaseOrder.id);
}

export async function updatePurchaseOrderExchangeRate(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    exchangeRate: number;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString()
  };

  return client.from("purchaseOrder").update(update).eq("id", update.id);
}

export async function updatePurchaseOrderFavorite(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    favorite: boolean;
    userId: string;
  }
) {
  const { id, favorite, userId } = args;
  if (!favorite) {
    return client
      .from("purchaseOrderFavorite")
      .delete()
      .eq("purchaseOrderId", id)
      .eq("userId", userId);
  } else {
    return client
      .from("purchaseOrderFavorite")
      .insert({ purchaseOrderId: id, userId: userId });
  }
}

/** Not published: a bare status write skips approval. Use `purchasing_finalizePurchaseOrderAndNotify`, `_reopen` or `_close`. */
export async function updatePurchaseOrderStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof purchaseOrderStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  return client.from("purchaseOrder").update(update).eq("id", update.id);
}

/**
 * Reopens a released purchase order as its next revision — to Draft from the
 * PO page, or to Planned from planning (see `PURCHASE_ORDER_REOPEN_STATUSES`).
 *
 * Compare-and-swap: the increment and the eligibility conditions are both in
 * SQL, so concurrent requests can't share a revision number and an ineligible
 * order matches no rows. Returns rows updated — 0 means it was not eligible.
 *
 * Not published: `purchasing_reopenPurchaseOrder` with `createRevision` does it, with the permission and approval checks.
 */
export async function reopenPurchaseOrderAsRevision(
  db: Kysely<KyselyDatabase>,
  {
    id,
    companyId,
    updatedBy,
    status = "Draft"
  }: {
    id: string;
    companyId: string;
    updatedBy: string;
    status?: (typeof PURCHASE_ORDER_REOPEN_STATUSES)[number];
  }
) {
  const result = await db
    .updateTable("purchaseOrder")
    .set((eb) => ({
      status,
      assignee: null,
      revisionId: eb("revisionId", "+", 1),
      updatedBy,
      updatedAt: datetime.timestamp()
    }))
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .where("status", "in", [...PURCHASE_ORDER_LOCKED_STATUSES])
    .where("orderDate", "is not", null)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0);
}

export async function updateSupplierAccounting(
  client: SupabaseClient<Database>,
  supplierAccounting: z.infer<typeof supplierAccountingValidator> & {
    updatedBy: string;
  }
) {
  return client
    .from("supplier")
    .update(sanitize(supplierAccounting))
    .eq("id", supplierAccounting.id);
}

export async function updateSupplierContact(
  client: SupabaseClient<Database>,
  supplierContact: {
    contactId: string;
    contact: z.infer<typeof supplierContactValidator>;
    supplierLocationId?: string;
    customFields?: Json;
  }
) {
  if (supplierContact.customFields) {
    const customFieldUpdate = await client
      .from("supplierContact")
      .update({
        customFields: supplierContact.customFields,
        supplierLocationId: supplierContact.supplierLocationId
      })
      .eq("contactId", supplierContact.contactId);

    if (customFieldUpdate.error) {
      return customFieldUpdate;
    }
  }
  // The contact id is the row key and the location is set on supplierContact
  // above; neither is a contact column.
  const {
    contactId: _contactId,
    supplierLocationId: _supplierLocationId,
    ...contact
  } = supplierContact.contact;
  return client
    .from("contact")
    .update(sanitize(contact))
    .eq("id", supplierContact.contactId)
    .select("id")
    .single();
}

export async function updateSupplierLocation(
  client: SupabaseClient<Database>,
  supplierLocation: {
    addressId: string;
    name: string;
    address: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      stateProvince?: string;
      countryCode?: string;
      postalCode?: string;
    };
    customFields?: Json;
  }
) {
  if (supplierLocation.customFields) {
    const customFieldUpdate = await client
      .from("supplierLocation")
      .update({
        name: supplierLocation.name,
        customFields: supplierLocation.customFields
      })
      .eq("addressId", supplierLocation.addressId);

    if (customFieldUpdate.error) {
      return customFieldUpdate;
    }
  }
  return client
    .from("address")
    .update(sanitize(supplierLocation.address))
    .eq("id", supplierLocation.addressId)
    .select("id")
    .single();
}

export async function updateSupplierPayment(
  client: SupabaseClient<Database>,
  supplierPayment: z.infer<typeof supplierPaymentValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("supplierPayment")
    .update(sanitize(supplierPayment))
    .eq("supplierId", supplierPayment.supplierId);
}

export async function updateSupplierQuoteExchangeRate(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    exchangeRate: number;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString()
  };

  return client.from("supplierQuote").update(update).eq("id", update.id);
}

export async function updateSupplierQuoteFavorite(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    favorite: boolean;
    userId: string;
  }
) {
  const { id, favorite, userId } = args;
  if (!favorite) {
    return client
      .from("supplierQuoteFavorite")
      .delete()
      .eq("supplierQuoteId", id)
      .eq("userId", userId);
  } else {
    return client
      .from("supplierQuoteFavorite")
      .insert({ supplierQuoteId: id, userId: userId });
  }
}

export async function updateSupplierQuoteStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof supplierQuoteStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  return client.from("supplierQuote").update(update).eq("id", update.id);
}

export async function updateSupplierShipping(
  client: SupabaseClient<Database>,
  supplierShipping: z.infer<typeof supplierShippingValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("supplierShipping")
    .update(sanitize(supplierShipping))
    .eq("supplierId", supplierShipping.supplierId);
}

export async function getSupplierTax(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierTax")
    .select("*")
    .eq("supplierId", supplierId)
    .maybeSingle();
}

export async function updateSupplierTax(
  client: SupabaseClient<Database>,
  supplierTax: z.infer<typeof supplierTaxValidator> & {
    companyId: string;
    updatedBy: string;
    taxExemptionCertificatePath?: string | null;
  }
) {
  return client
    .from("supplierTax")
    .update(sanitize({ ...supplierTax, updatedAt: new Date().toISOString() }))
    .eq("supplierId", supplierTax.supplierId)
    .eq("companyId", supplierTax.companyId);
}

export async function insertPurchaseOrder(
  client: SupabaseClient<Database>,
  input: {
    supplierId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    purchaseOrderId?: string;
    purchaseOrderType?: "Purchase" | "Return" | "Outside Processing";
    locationId?: string;
    status?: (typeof purchaseOrderStatusType)[number];
    currencyCode?: string;
    orderDate?: string;
    supplierContactId?: string;
    supplierLocationId?: string;
    supplierQuoteId?: string;
    receiptRequestedDate?: string;
    supplierReference?: string;
    notes?: Json;
    externalNotes?: Json;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; purchaseOrderId: string; exchangeRate: number } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let purchaseOrderId: string;
  if (input.purchaseOrderId) {
    purchaseOrderId = input.purchaseOrderId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "purchaseOrder",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate PO sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    purchaseOrderId = seq.data;
  }

  // Resolve the rate BEFORE inserting the supplier interaction — a resolver
  // failure must not leave an orphaned interaction row behind.
  let exchangeRate = 1;
  let exchangeRateUpdatedAt = new Date().toISOString();
  if (input.currencyCode) {
    const rate = await getExchangeRate(
      client,
      input.companyId,
      input.currencyCode
    );
    if (rate.error) return { data: null, error: rate.error };
    exchangeRate = rate.data;
    exchangeRateUpdatedAt = new Date().toISOString();
  }

  const [supplierInteraction, supplierPayment, supplierShipping, purchaser] =
    await Promise.all([
      insertSupplierInteraction(client, input.companyId, input.supplierId),
      getSupplierPayment(client, input.supplierId),
      getSupplierShipping(client, input.supplierId),
      getEmployeeJob(client, input.createdBy, input.companyId)
    ]);

  if (supplierInteraction.error)
    return { data: null, error: supplierInteraction.error };
  if (supplierPayment.error)
    return { data: null, error: supplierPayment.error };
  if (supplierShipping.error)
    return { data: null, error: supplierShipping.error };

  const {
    paymentTermId,
    invoiceSupplierId,
    invoiceSupplierContactId,
    invoiceSupplierLocationId
  } = supplierPayment.data;

  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    supplierShipping.data;

  const locationId = input.locationId ?? purchaser?.data?.locationId ?? null;

  const order = await client
    .from("purchaseOrder")
    .insert({
      purchaseOrderId,
      purchaseOrderType: input.purchaseOrderType,
      supplierId: input.supplierId,
      supplierContactId: input.supplierContactId,
      supplierLocationId: input.supplierLocationId,
      supplierInteractionId: supplierInteraction.data?.id,
      status: input.status ?? "Draft",
      orderDate:
        input.orderDate ??
        datetime
          .today(await getCompanyTimeZone(client, input.companyId))
          .toString(),
      currencyCode: input.currencyCode,
      exchangeRate,
      exchangeRateUpdatedAt,
      supplierReference: input.supplierReference ?? null,
      internalNotes: input.notes ?? null,
      externalNotes: input.externalNotes ?? null,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, purchaseOrderId")
    .single();

  if (order.error) return { data: null, error: order.error };

  const orderId = order.data.id;

  const [delivery, payment] = await Promise.all([
    client.from("purchaseOrderDelivery").insert({
      id: orderId,
      locationId,
      receiptRequestedDate: input.receiptRequestedDate ?? null,
      shippingMethodId,
      shippingTermId,
      incoterm,
      incotermLocation,
      companyId: input.companyId
    }),
    client.from("purchaseOrderPayment").insert({
      id: orderId,
      paymentTermId,
      invoiceSupplierId: invoiceSupplierId ?? input.supplierId,
      invoiceSupplierContactId,
      invoiceSupplierLocationId,
      companyId: input.companyId
    })
  ]);

  if (delivery.error || payment.error) {
    await deletePurchaseOrder(client, orderId);
    return { data: null, error: delivery.error ?? payment.error };
  }

  return { data: { id: orderId, purchaseOrderId, exchangeRate }, error: null };
}

export async function updatePurchaseOrder(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    status?: (typeof purchaseOrderStatusType)[number];
    currencyCode?: string;
    orderDate?: string;
    supplierId?: string;
    supplierContactId?: string | null;
    supplierLocationId?: string | null;
    supplierReference?: string;
    purchaseOrderType?: (typeof purchaseOrderTypeType)[number];
    notes?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, updatedBy, notes, ...updates } = input;

  let exchangeRate: number | undefined;
  let exchangeRateUpdatedAt: string | undefined;
  if (updates.currencyCode) {
    const existing = await client
      .from("purchaseOrder")
      .select("companyId")
      .eq("id", id)
      .single();
    if (existing.error) return { data: null, error: existing.error };

    const rate = await getExchangeRate(
      client,
      existing.data.companyId,
      updates.currencyCode
    );
    if (rate.error) return { data: null, error: rate.error };
    exchangeRate = rate.data;
    exchangeRateUpdatedAt = new Date().toISOString();
  }

  return client
    .from("purchaseOrder")
    .update({
      ...sanitize(updates),
      ...(exchangeRate !== undefined && { exchangeRate }),
      ...(exchangeRateUpdatedAt && { exchangeRateUpdatedAt }),
      ...(notes !== undefined && { internalNotes: notes }),
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

/**
 * @deprecated Use insertPurchaseOrder for new orders, updatePurchaseOrder for existing orders
 */
export async function upsertPurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrder:
    | (Omit<
        z.infer<typeof purchaseOrderValidator>,
        "id" | "purchaseOrderId"
      > & {
        purchaseOrderId: string;
        status?: (typeof purchaseOrderStatusType)[number];
        companyId: string;
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<
        z.infer<typeof purchaseOrderValidator>,
        "id" | "purchaseOrderId"
      > & {
        id: string;
        purchaseOrderId: string;
        companyGroupId?: string;
        updatedBy: string;
        customFields?: Json;
      }),
  receiptRequestedDate?: string
) {
  if ("id" in purchaseOrder) {
    // locationId belongs on the delivery record, as in the insert below, and
    // notes are stored as internalNotes/externalNotes. companyGroupId is not a
    // column of the order at all.
    const {
      locationId: _locationId,
      companyGroupId: _companyGroupId,
      notes: _notes,
      ...orderUpdate
    } = purchaseOrder;
    return client
      .from("purchaseOrder")
      .update(sanitize(orderUpdate))
      .eq("id", purchaseOrder.id)
      .select("id, purchaseOrderId");
  }

  // Resolve the rate BEFORE inserting the supplier interaction — a resolver
  // failure must not leave an orphaned interaction row behind.
  if (purchaseOrder.currencyCode) {
    const rate = await getExchangeRate(
      client,
      purchaseOrder.companyId,
      purchaseOrder.currencyCode
    );
    if (rate.error) return { data: null, error: rate.error };
    purchaseOrder.exchangeRate = rate.data;
    purchaseOrder.exchangeRateUpdatedAt = new Date().toISOString();
  } else {
    purchaseOrder.exchangeRate = 1;
    purchaseOrder.exchangeRateUpdatedAt = new Date().toISOString();
  }

  const [supplierInteraction, supplierPayment, supplierShipping, purchaser] =
    await Promise.all([
      insertSupplierInteraction(
        client,
        purchaseOrder.companyId,
        purchaseOrder.supplierId
      ),
      getSupplierPayment(client, purchaseOrder.supplierId),
      getSupplierShipping(client, purchaseOrder.supplierId),
      getEmployeeJob(client, purchaseOrder.createdBy, purchaseOrder.companyId)
    ]);

  if (supplierInteraction.error) return supplierInteraction;
  if (supplierPayment.error) return supplierPayment;
  if (supplierShipping.error) return supplierShipping;

  const {
    paymentTermId,
    invoiceSupplierId,
    invoiceSupplierContactId,
    invoiceSupplierLocationId
  } = supplierPayment.data;

  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    supplierShipping.data;

  const locationId =
    purchaseOrder.locationId ?? purchaser?.data?.locationId ?? null;

  // locationId is not a column on purchaseOrder -- it belongs on the delivery record
  const {
    locationId: _locationId,
    companyGroupId: _companyGroupId,
    ...purchaseOrderData
  } = purchaseOrder;

  const order = await client
    .from("purchaseOrder")
    .insert([
      {
        ...purchaseOrderData,
        supplierInteractionId: supplierInteraction.data?.id,
        status: purchaseOrder.status ?? "Draft"
      }
    ])
    .select("id, purchaseOrderId");

  if (order.error) return order;

  const purchaseOrderId = order.data[0].id;

  const [delivery, payment] = await Promise.all([
    client.from("purchaseOrderDelivery").insert([
      {
        id: purchaseOrderId,
        receiptRequestedDate: receiptRequestedDate ?? null,
        locationId: locationId,
        shippingMethodId: shippingMethodId,
        shippingTermId: shippingTermId,
        incoterm: incoterm,
        incotermLocation: incotermLocation,
        companyId: purchaseOrder.companyId
      }
    ]),
    client.from("purchaseOrderPayment").insert([
      {
        id: purchaseOrderId,
        invoiceSupplierId: invoiceSupplierId,
        invoiceSupplierContactId: invoiceSupplierContactId,
        invoiceSupplierLocationId: invoiceSupplierLocationId,
        paymentTermId: paymentTermId,
        companyId: purchaseOrder.companyId
      }
    ])
  ]);

  if (delivery.error) {
    await deletePurchaseOrder(client, purchaseOrderId);
    return payment;
  }
  if (payment.error) {
    await deletePurchaseOrder(client, purchaseOrderId);
    return payment;
  }

  return order;
}

export async function upsertPurchaseOrderDelivery(
  client: SupabaseClient<Database>,
  purchaseOrderDelivery:
    | (z.infer<typeof purchaseOrderDeliveryValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof purchaseOrderDeliveryValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in purchaseOrderDelivery) {
    return client
      .from("purchaseOrderDelivery")
      .update(sanitize(purchaseOrderDelivery))
      .eq("id", purchaseOrderDelivery.id)
      .select("id")
      .single();
  }
  return client
    .from("purchaseOrderDelivery")
    .insert([purchaseOrderDelivery])
    .select("id")
    .single();
}

const PURCHASE_ORDER_LINE_ITEM_TYPES = [
  "Part",
  "Material",
  "Tool",
  "Service",
  "Consumable",
  "Fixture"
];

/**
 * Force the mutually-exclusive reference columns (`itemId`, `accountId`,
 * `assetId`) to match the line's `purchaseOrderLineType`, nulling the ones that
 * don't apply. `purchaseOrderLineType_check` requires exactly one of these set
 * per type, but the form only submits the active tab's field and `sanitize()`
 * turns *absent* keys into nothing (not null), so switching a G/L Account or
 * Fixed Asset line to an item type would otherwise leave a stale `accountId`/
 * `assetId` on the row and violate the check (23514). Setting the inapplicable
 * ids to explicit `null` clears them on update and hardens every caller (form,
 * public API, MCP) at once.
 */
function normalizePurchaseOrderLineReferences<
  T extends {
    purchaseOrderLineType: string;
    itemId?: string | null;
    accountId?: string | null;
    assetId?: string | null;
  }
>(line: T): T {
  if (PURCHASE_ORDER_LINE_ITEM_TYPES.includes(line.purchaseOrderLineType)) {
    return { ...line, accountId: null, assetId: null };
  }
  if (line.purchaseOrderLineType === "G/L Account") {
    return { ...line, itemId: null, assetId: null };
  }
  if (line.purchaseOrderLineType === "Fixed Asset") {
    return { ...line, itemId: null, accountId: null };
  }
  // Comment (and any other non-reference type) carries no reference id.
  return { ...line, itemId: null, accountId: null, assetId: null };
}

export async function upsertPurchaseOrderLine(
  client: SupabaseClient<Database>,
  purchaseOrderLine:
    | (Omit<z.infer<typeof purchaseOrderLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof purchaseOrderLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  const normalized = normalizePurchaseOrderLineReferences(purchaseOrderLine);

  // a manual line change forfeits the planning approval bypass
  const cleared = await clearPlanningOrigin(client, {
    purchaseOrderId: normalized.purchaseOrderId
  });
  if (cleared.error) return { data: null, error: cleared.error };

  if ("id" in normalized) {
    return client
      .from("purchaseOrderLine")
      .update(sanitize(normalized))
      .eq("id", normalized.id)
      .select("id")
      .single();
  }

  const existing = await client
    .from("purchaseOrderLine")
    .select("sortOrder")
    .eq("purchaseOrderId", normalized.purchaseOrderId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("purchaseOrderLine")
    .insert([{ ...normalized, sortOrder: maxSortOrder + 1 }])
    .select("id")
    .single();
}

export async function updatePurchaseOrderLineOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  purchaseOrderId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "purchaseOrderLine",
    column: "sortOrder",
    companyId,
    userId,
    parent: { column: "purchaseOrderId", id: purchaseOrderId },
    updates
  });
}

/**
 * Short-close ("stop receiving") or reopen a purchase order line whose
 * remaining quantity will never arrive. Sets `receivedComplete` without
 * touching quantities or pricing, then recomputes the header status from the
 * line completeness flags. Open-PO supply queries (get_inventory_quantities,
 * openPurchaseOrderLines) exclude `receivedComplete` lines, so the undelivered
 * remainder stops counting as incoming stock.
 *
 * Closing also caps the billable quantity at what was received (the convert
 * and post-purchase-invoice functions apply the same rule), so a line whose
 * received quantity is already fully invoiced gets `invoicedComplete` too —
 * otherwise the order could never reach Completed. Reopening restores the
 * natural rule (fully invoiced = ordered quantity).
 */
export async function shortClosePurchaseOrderLine(
  db: Kysely<KyselyDatabase>,
  {
    lineId,
    purchaseOrderId,
    companyId,
    userId,
    intent
  }: {
    lineId: string;
    purchaseOrderId: string;
    companyId: string;
    userId: string;
    intent: "close" | "reopen";
  }
) {
  return db.transaction().execute(async (trx) => {
    const line = await trx
      .selectFrom("purchaseOrderLine")
      .select(["purchaseQuantity", "quantityReceived", "quantityInvoiced"])
      .where("id", "=", lineId)
      .where("purchaseOrderId", "=", purchaseOrderId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    if (!line) throw new Error("Purchase order line not found");

    // NUMERIC columns come back from the pg driver as strings
    const ordered = Number(line.purchaseQuantity ?? 0);
    const received = Number(line.quantityReceived ?? 0);
    const invoiced = Number(line.quantityInvoiced ?? 0);

    const invoicedComplete =
      intent === "close" ? invoiced >= received : invoiced >= ordered;

    await trx
      .updateTable("purchaseOrderLine")
      .set({
        receivedComplete: intent === "close",
        invoicedComplete,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", lineId)
      .where("purchaseOrderId", "=", purchaseOrderId)
      .where("companyId", "=", companyId)
      .execute();

    const lines = await trx
      .selectFrom("purchaseOrderLine")
      .select(["purchaseOrderLineType", "invoicedComplete", "receivedComplete"])
      .where("purchaseOrderId", "=", purchaseOrderId)
      .where("companyId", "=", companyId)
      .execute();

    const { status } = getPurchaseOrderStatus(lines);

    await trx
      .updateTable("purchaseOrder")
      .set({
        status,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", purchaseOrderId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

// ── Planning actions: Apply, set-based ──────────────────────────────────────

export type PurchasingPlanningApplyAction = {
  planningActionId: string;
  type: "Expedite" | "Defer" | "Increase" | "Decrease" | "Cancel";
  lineId: string;
  purchaseOrderId: string;
  /** Expedite / Defer: the new required date */
  suggestedDate: string | null;
  /** Increase / Decrease: the new quantity, in INVENTORY units */
  suggestedQuantity: number | null;
};

export type PurchasingPlanningApplyResult = {
  /** changed and marked Actioned */
  applied: string[];
  /** marked Actioned by another apply since the page loaded; nothing changed */
  alreadyApplied: string[];
  /** the write was refused (PO sent or in approval, line received or invoiced
   *  since it was read): the action stays Open for review on the PO */
  refused: { id: string; purchaseOrderId: string }[];
  /** could not be computed (a currency with no precision): the action stays Open */
  failed: { id: string; message: string }[];
};

/**
 * Apply a batch of planning actions to their purchase order lines in ONE
 * transaction, set-based: every date change is one statement, every quantity
 * change one, every cancel one, and the claim one — about five round trips
 * for any batch size. It used to be one claim and one to three round trips
 * per action, in sequence, which made a large batch run into the request's
 * time limit with the rest of it still unapplied.
 *
 * Order inside the transaction:
 *   1. claim: every Open action flips to Actioned; one that does not flip was
 *      applied by someone else since the page loaded, and its line is left
 *      alone — a stale page never overwrites a later manual edit.
 *   2. write: each claimed action's change, with the same guards as the
 *      single-line writers (a Draft / Planned PO; nothing received or invoiced
 *      on a line to cancel). A refused write un-claims its action.
 *   3. un-claim: back to Open — or deleted when an MRP run has meanwhile written
 *      a fresh Open row for the same need (the natural-key index), as
 *      `releasePlanningActionClaim` does.
 * A failure anywhere rolls the whole batch back: nothing is half-applied.
 *
 * A quantity change restates the line's tax pair (`taxPairForQuantity`): the
 * extended price is generated from the quantity, the tax amount is stored.
 * `suggestedQuantity` is in INVENTORY units; the line stores PURCHASE units,
 * converted by the line's own `conversionFactor` and rounded up to a whole
 * purchase unit, as the drawer shows it. It is what the line should still
 * BRING — MRP reads a line's `quantityToReceive` — so what was already
 * received is added back: a PO reopened from planning after a partial receipt
 * would otherwise lose it (an Increase to 16 on a line with 5 received left
 * only 11 to come).
 */
export async function applyPurchasingPlanningActions(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    actions: PurchasingPlanningApplyAction[];
  }
): Promise<PurchasingPlanningApplyResult> {
  const { companyId, companyGroupId, userId, actions } = args;
  const result: PurchasingPlanningApplyResult = {
    applied: [],
    alreadyApplied: [],
    refused: [],
    failed: []
  };
  if (actions.length === 0) return result;

  const now = datetime.timestamp();
  const editableStatuses = [...PLANNING_EDITABLE_PURCHASE_ORDER_STATUSES];

  await db.transaction().execute(async (trx) => {
    // 1. claim
    const claimed = await claimPlanningActions(trx, {
      ids: actions.map((a) => a.planningActionId),
      companyId,
      userId,
      now
    });
    // The quantity and date come from the claim, not from the page's read
    // (see claimPlanningActions); the page's values are only the fallback.
    const held = actions.flatMap((a) => {
      const claim = claimed.get(a.planningActionId);
      if (!claim) return [];
      return [
        {
          ...a,
          suggestedDate: claim.suggestedDate ?? a.suggestedDate,
          suggestedQuantity: claim.suggestedQuantity ?? a.suggestedQuantity
        }
      ];
    });
    for (const action of actions) {
      if (!claimed.has(action.planningActionId)) {
        result.alreadyApplied.push(action.planningActionId);
      }
    }

    const editablePurchaseOrders = trx
      .selectFrom("purchaseOrder")
      .select("id")
      .where("companyId", "=", companyId)
      .where("status", "in", editableStatuses);

    const changedLines = new Set<string>();

    // 2a. dates
    const dates = held.filter(
      (a) => (a.type === "Expedite" || a.type === "Defer") && a.suggestedDate
    );
    if (dates.length > 0) {
      const rows = await sql<{ id: string }>`
        UPDATE "purchaseOrderLine" AS l
        SET "requiredDate" = v."requiredDate"::date,
            "updatedBy" = ${userId},
            "updatedAt" = ${now}
        FROM (VALUES ${sql.join(
          dates.map((a) => sql`(${a.lineId}, ${a.suggestedDate})`)
        )}) AS v("id", "requiredDate")
        WHERE l."id" = v."id"
          AND l."companyId" = ${companyId}
          AND l."purchaseOrderId" IN (${editablePurchaseOrders})
        RETURNING l."id"
      `.execute(trx);
      for (const row of rows.rows) changedLines.add(row.id);
    }

    // 2b. quantities — the tax pair is computed here, in TypeScript, from one
    //     read of the lines' pricing and one of their currencies
    const quantities = held.filter(
      (a) =>
        (a.type === "Increase" || a.type === "Decrease") &&
        a.suggestedQuantity !== null
    );
    if (quantities.length > 0) {
      const lineIds = [...new Set(quantities.map((a) => a.lineId))];
      // A PO with no currency is in the company's base currency, as the PO
      // line form reads it; refusing it failed every Increase / Decrease on
      // such a PO with "Currency (none) has no precision".
      const lines = (
        await trx
          .selectFrom("purchaseOrderLine as pol")
          .innerJoin("purchaseOrder as po", "po.id", "pol.purchaseOrderId")
          .innerJoin("company as c", "c.id", "po.companyId")
          .select([
            "pol.id",
            "pol.supplierUnitPrice",
            "pol.supplierShippingCost",
            "pol.purchaseQuantity",
            "pol.quantityReceived",
            "pol.taxPercent",
            "pol.supplierTaxAmount",
            "pol.conversionFactor",
            "po.currencyCode",
            "c.baseCurrencyCode"
          ])
          .where("pol.id", "in", lineIds)
          .where("pol.companyId", "=", companyId)
          .execute()
      ).map(({ baseCurrencyCode, ...line }) => ({
        ...line,
        currencyCode: line.currencyCode ?? baseCurrencyCode
      }));
      const lineById = new Map(lines.map((line) => [line.id, line]));
      const codes = [
        ...new Set(
          lines.flatMap((l) => (l.currencyCode ? [l.currencyCode] : []))
        )
      ];
      const currencies =
        codes.length > 0
          ? await trx
              .selectFrom("currencies")
              .select(["code", "decimalPlaces"])
              .where("companyGroupId", "=", companyGroupId)
              .where("code", "in", codes)
              .execute()
          : [];
      const decimalsByCode = new Map(
        currencies.flatMap((c) =>
          c.code && c.decimalPlaces != null ? [[c.code, c.decimalPlaces]] : []
        )
      );

      const values: {
        lineId: string;
        quantity: number;
        percent: number;
        amount: number;
      }[] = [];
      const unheld: string[] = [];
      for (const action of quantities) {
        const line = lineById.get(action.lineId);
        const decimals = line?.currencyCode
          ? decimalsByCode.get(line.currencyCode)
          : undefined;
        if (!line || decimals === undefined) {
          result.failed.push({
            id: action.planningActionId,
            message: line
              ? `Currency ${line.currencyCode ?? "(none)"} has no precision`
              : "Purchase order line not found"
          });
          unheld.push(action.planningActionId);
          continue;
        }
        const conversionFactor = Number(line.conversionFactor) || 1;
        // MRP suggests a whole number of purchase units already
        // (`quantityAfterApply`, @carbon/planning); the inner round strips
        // float noise (1.1 / 0.1 = 11.000000000000002) that would otherwise
        // ceil it a whole purchase unit up.
        const toReceive =
          conversionFactor > 0
            ? round(
                round(Number(action.suggestedQuantity) / conversionFactor),
                0,
                RoundingMode.Up
              )
            : Number(action.suggestedQuantity);
        const quantity = round(
          (Number(line.quantityReceived) || 0) + toReceive
        );
        const pair = taxPairForQuantity(line, quantity, decimals);
        values.push({
          lineId: action.lineId,
          quantity,
          percent: pair.percent,
          amount: pair.amount
        });
      }
      // a failed computation never holds its claim
      for (const id of unheld) claimed.delete(id);

      if (values.length > 0) {
        const rows = await sql<{ id: string }>`
          UPDATE "purchaseOrderLine" AS l
          SET "purchaseQuantity" = v."purchaseQuantity"::numeric,
              "taxPercent" = v."taxPercent"::numeric,
              "supplierTaxAmount" = v."supplierTaxAmount"::numeric,
              "updatedBy" = ${userId},
              "updatedAt" = ${now}
          FROM (VALUES ${sql.join(
            values.map(
              (v) =>
                sql`(${v.lineId}, ${v.quantity}, ${v.percent}, ${v.amount})`
            )
          )}) AS v("id", "purchaseQuantity", "taxPercent", "supplierTaxAmount")
          WHERE l."id" = v."id"
            AND l."companyId" = ${companyId}
            AND l."purchaseOrderId" IN (${editablePurchaseOrders})
          RETURNING l."id"
        `.execute(trx);
        for (const row of rows.rows) changedLines.add(row.id);
      }
    }

    // 2c. cancels — a Draft / Planned PO and nothing received or invoiced on
    //     the line, in the one DELETE, so a finalize or a receipt that lands
    //     after the caller read the PO cannot slip in between. Not
    //     shortClosePurchaseOrderLine: that recomputes the header status from
    //     the lines and turned an unsent one-line Draft into "Completed". The
    //     delete cascades to the action rows themselves, so these need no
    //     claim to keep and nothing to un-claim.
    const cancels = held.filter((a) => a.type === "Cancel");
    if (cancels.length > 0) {
      const deleted = await trx
        .deleteFrom("purchaseOrderLine")
        .where(
          "id",
          "in",
          cancels.map((a) => a.lineId)
        )
        .where("companyId", "=", companyId)
        .where((eb) =>
          eb.and([
            eb(eb.fn.coalesce("quantityReceived", eb.val(0)), "=", 0),
            eb(eb.fn.coalesce("quantityInvoiced", eb.val(0)), "=", 0)
          ])
        )
        .where("purchaseOrderId", "in", editablePurchaseOrders)
        // A draft invoice line holds an ON DELETE RESTRICT reference: deleting
        // under it threw and rolled the whole batch back. Left alone, the
        // action goes to review like any other refused Cancel.
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom("purchaseInvoiceLine")
                .select("purchaseInvoiceLine.id")
                .whereRef(
                  "purchaseInvoiceLine.purchaseOrderLineId",
                  "=",
                  "purchaseOrderLine.id"
                )
            )
          )
        )
        .returning("id")
        .execute();
      for (const row of deleted) changedLines.add(row.id);
    }

    // 3. settle: applied, or refused and un-claimed
    const refusedIds: string[] = [];
    for (const action of held) {
      if (result.failed.some((f) => f.id === action.planningActionId)) continue;
      if (changedLines.has(action.lineId)) {
        result.applied.push(action.planningActionId);
      } else {
        refusedIds.push(action.planningActionId);
        result.refused.push({
          id: action.planningActionId,
          purchaseOrderId: action.purchaseOrderId
        });
      }
    }
    await releasePlanningActionClaims(trx, {
      ids: [...refusedIds, ...result.failed.map((f) => f.id)],
      companyId,
      userId,
      now
    });
  });

  return result;
}

export async function upsertPurchaseOrderPayment(
  client: SupabaseClient<Database>,
  purchaseOrderPayment:
    | (z.infer<typeof purchaseOrderPaymentValidator> & {
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof purchaseOrderPaymentValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in purchaseOrderPayment) {
    return client
      .from("purchaseOrderPayment")
      .update(sanitize(purchaseOrderPayment))
      .eq("id", purchaseOrderPayment.id)
      .select("id")
      .single();
  }
  return client
    .from("purchaseOrderPayment")
    .insert([purchaseOrderPayment])
    .select("id")
    .single();
}

export async function upsertSupplier(
  client: SupabaseClient<Database>,
  supplier:
    | (Omit<z.infer<typeof supplierValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplier) {
    return client
      .from("supplier")
      .insert([supplier])
      .select("id, name, website, supplierStatus, readableId")
      .single();
  }
  return client
    .from("supplier")
    .update({
      ...sanitize(supplier),
      updatedAt: datetime.timestamp()
    })
    .eq("id", supplier.id)
    .select("id")
    .single();
}

export async function upsertSupplierProcess(
  client: SupabaseClient<Database>,
  supplierProcess:
    | (Omit<z.infer<typeof supplierProcessValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierProcessValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplierProcess) {
    return client
      .from("supplierProcess")
      .insert([supplierProcess])
      .select("id")
      .single();
  }
  return client
    .from("supplierProcess")
    .update(sanitize(supplierProcess))
    .eq("id", supplierProcess.id)
    .select("id")
    .single();
}

export async function insertSupplierQuote(
  client: SupabaseClient<Database>,
  input: {
    supplierId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    supplierQuoteId?: string;
    locationId?: string;
    status?: (typeof supplierQuoteStatusType)[number];
    currencyCode?: string;
    expirationDate?: string;
    supplierContactId?: string;
    supplierLocationId?: string;
    notes?: string;
    customFields?: Json;
    quotedDate?: string;
    supplierReference?: string;
    supplierQuoteType?: (typeof purchaseOrderTypeType)[number];
  }
): Promise<{
  data: { id: string; supplierQuoteId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let supplierQuoteId: string;
  if (input.supplierQuoteId) {
    supplierQuoteId = input.supplierQuoteId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "supplierQuote",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate supplier quote sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    supplierQuoteId = seq.data;
  }

  let exchangeRate = 1;
  let exchangeRateUpdatedAt = new Date().toISOString();
  if (input.currencyCode) {
    const rate = await getExchangeRate(
      client,
      input.companyId,
      input.currencyCode
    );
    if (rate.error) return { data: null, error: rate.error };
    exchangeRate = rate.data;
    exchangeRateUpdatedAt = new Date().toISOString();
  }

  const supplierInteraction = await insertSupplierInteraction(
    client,
    input.companyId,
    input.supplierId
  );

  if (supplierInteraction.error)
    return { data: null, error: supplierInteraction.error };

  const quote = await client
    .from("supplierQuote")
    .insert({
      supplierQuoteId,
      supplierId: input.supplierId,
      supplierContactId: input.supplierContactId,
      supplierLocationId: input.supplierLocationId,
      supplierInteractionId: supplierInteraction.data?.id,
      status: input.status ?? "Draft",
      expirationDate: input.expirationDate,
      currencyCode: input.currencyCode,
      exchangeRate,
      exchangeRateUpdatedAt,
      internalNotes: input.notes,
      customFields: input.customFields,
      quotedDate: input.quotedDate ?? new Date().toISOString(),
      supplierReference: input.supplierReference ?? null,
      supplierQuoteType: input.supplierQuoteType ?? "Purchase",
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, supplierQuoteId, externalLinkId")
    .single();

  if (quote.error) return { data: null, error: quote.error };

  const createdQuoteId = quote.data.id;

  if (!quote.data.externalLinkId) {
    const externalLink = await upsertExternalLink(client, {
      documentType: "SupplierQuote",
      documentId: createdQuoteId,
      supplierId: input.supplierId,
      expiresAt: input.expirationDate,
      companyId: input.companyId
    });

    if (externalLink.data) {
      await client
        .from("supplierQuote")
        .update({ externalLinkId: externalLink.data.id })
        .eq("id", createdQuoteId);
    }
  }

  return { data: { id: createdQuoteId, supplierQuoteId }, error: null };
}

export async function updateSupplierQuote(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    status?: (typeof supplierQuoteStatusType)[number];
    currencyCode?: string;
    expirationDate?: string | null;
    supplierContactId?: string | null;
    supplierLocationId?: string | null;
    notes?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, updatedBy, notes, ...updates } = input;

  let exchangeRate: number | undefined;
  let exchangeRateUpdatedAt: string | undefined;

  const existing = await client
    .from("supplierQuote")
    .select("currencyCode, companyId")
    .eq("id", id)
    .single();

  if (existing.error) return { data: null, error: existing.error };

  if (
    updates.currencyCode &&
    existing.data.currencyCode !== updates.currencyCode
  ) {
    const rate = await getExchangeRate(
      client,
      existing.data.companyId,
      updates.currencyCode
    );
    if (rate.error) return { data: null, error: rate.error };
    exchangeRate = rate.data;
    exchangeRateUpdatedAt = new Date().toISOString();
  }

  return client
    .from("supplierQuote")
    .update({
      ...sanitize(updates),
      ...(exchangeRate !== undefined && { exchangeRate }),
      ...(exchangeRateUpdatedAt && { exchangeRateUpdatedAt }),
      ...(notes !== undefined && { internalNotes: notes }),
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

/** @deprecated Use insertSupplierQuote for new quotes, updateSupplierQuote for existing quotes */
export async function upsertSupplierQuote(
  client: SupabaseClient<Database>,
  supplierQuote:
    | (Omit<
        z.infer<typeof supplierQuoteValidator>,
        "id" | "supplierQuoteId"
      > & {
        supplierQuoteId: string;
        companyId: string;
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<
        z.infer<typeof supplierQuoteValidator>,
        "id" | "supplierQuoteId"
      > & {
        id: string;
        supplierQuoteId: string;
        companyGroupId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplierQuote) {
    if (supplierQuote.currencyCode) {
      const rate = await getExchangeRate(
        client,
        supplierQuote.companyId,
        supplierQuote.currencyCode
      );
      if (rate.error) return { data: null, error: rate.error };
      supplierQuote.exchangeRate = rate.data;
      supplierQuote.exchangeRateUpdatedAt = new Date().toISOString();
    } else {
      supplierQuote.exchangeRate = 1;
      supplierQuote.exchangeRateUpdatedAt = new Date().toISOString();
    }

    const supplierInteraction = await insertSupplierInteraction(
      client,
      supplierQuote.companyId,
      supplierQuote.supplierId
    );

    if (supplierInteraction.error) return supplierInteraction;

    // supplierQuote stores notes as internalNotes/externalNotes, not `notes`.
    const {
      companyGroupId: _companyGroupId,
      notes: _notes,
      ...supplierQuoteData
    } = supplierQuote;
    const insert = await client
      .from("supplierQuote")
      .insert([
        {
          ...supplierQuoteData,
          status: supplierQuoteData.status ?? "Draft",
          supplierInteractionId: supplierInteraction.data?.id
        }
      ])
      .select("id, supplierQuoteId, externalLinkId")
      .single();

    if (insert.error) {
      return insert;
    }

    const supplierQuoteId = insert.data?.id;
    if (!supplierQuoteId) return insert;

    // Only create external link if one doesn't exist
    if (!insert.data.externalLinkId) {
      const externalLink = await upsertExternalLink(client, {
        documentType: "SupplierQuote",
        documentId: supplierQuoteId,
        supplierId: supplierQuote.supplierId,
        expiresAt: supplierQuote.expirationDate,
        companyId: supplierQuote.companyId
      });

      if (externalLink.data) {
        const update = await client
          .from("supplierQuote")
          .update({ externalLinkId: externalLink.data.id })
          .eq("id", supplierQuoteId);

        if (update.error) {
          return update;
        }
      }
    }

    return insert;
  } else {
    // Only update the exchange rate if the currency code has changed
    const existingQuote = await client
      .from("supplierQuote")
      .select("currencyCode, status, companyId")
      .eq("id", supplierQuote.id)
      .single();

    if (existingQuote.error) return existingQuote;

    const {
      currencyCode,
      status: existingStatus,
      companyId
    } = existingQuote.data;

    if (
      supplierQuote.currencyCode &&
      currencyCode !== supplierQuote.currencyCode
    ) {
      const rate = await getExchangeRate(
        client,
        companyId,
        supplierQuote.currencyCode
      );
      if (rate.error) return { data: null, error: rate.error };
      supplierQuote.exchangeRate = rate.data;
      supplierQuote.exchangeRateUpdatedAt = new Date().toISOString();
    }
    const {
      companyGroupId: _companyGroupId2,
      notes: _notes,
      ...supplierQuoteUpdateData
    } = supplierQuote;
    const companyTz = await getCompanyTimeZone(client, companyId);
    return client
      .from("supplierQuote")
      .update({
        ...sanitize(supplierQuoteUpdateData),
        status:
          supplierQuote.expirationDate &&
          datetime.today(companyTz).toString() > supplierQuote.expirationDate
            ? "Expired"
            : (supplierQuote.status ?? existingStatus ?? "Draft"),
        updatedAt: datetime.timestamp()
      })
      .eq("id", supplierQuote.id);
  }
}

export async function upsertSupplierQuoteLine(
  client: SupabaseClient<Database>,
  supplierQuoteLine:
    | (Omit<z.infer<typeof supplierQuoteLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierQuoteLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in supplierQuoteLine) {
    return client
      .from("supplierQuoteLine")
      .update(sanitize(supplierQuoteLine))
      .eq("id", supplierQuoteLine.id)
      .select("id")
      .single();
  }

  const existing = await client
    .from("supplierQuoteLine")
    .select("sortOrder")
    .eq("supplierQuoteId", supplierQuoteLine.supplierQuoteId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("supplierQuoteLine")
    .insert([
      {
        ...supplierQuoteLine,
        description: supplierQuoteLine.description ?? "",
        sortOrder: maxSortOrder + 1
      }
    ])
    .select("id")
    .single();
}

export async function updateSupplierQuoteLineOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  supplierQuoteId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "supplierQuoteLine",
    column: "sortOrder",
    companyId,
    userId,
    parent: { column: "supplierQuoteId", id: supplierQuoteId },
    updates
  });
}

export async function upsertSupplierType(
  client: SupabaseClient<Database>,
  supplierType:
    | (Omit<z.infer<typeof supplierTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplierType) {
    return client
      .from("supplierType")
      .insert([supplierType])
      .select("id")
      .single();
  } else {
    return client
      .from("supplierType")
      .update(sanitize(supplierType))
      .eq("id", supplierType.id);
  }
}

// ============================================================
// PURCHASING RFQ FUNCTIONS
// ============================================================

export async function deletePurchasingRFQ(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
) {
  return client.from("purchasingRfq").delete().eq("id", purchasingRfqId);
}

export async function deletePurchasingRFQLine(
  client: SupabaseClient<Database>,
  purchasingRfqLineId: string
) {
  return client
    .from("purchasingRfqLine")
    .delete()
    .eq("id", purchasingRfqLineId);
}

export async function getPurchasingRFQ(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("purchasingRfqs").select("*").eq("id", id).single();
}

export async function getPurchasingRFQs(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("purchasingRfqs")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("rfqId", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "rfqId", ascending: false }
  ]);
  return query;
}

export async function getPurchasingRFQLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client
    .from("purchasingRfqLines")
    .select("*")
    .eq("id", lineId)
    .single();
}

export async function getPurchasingRFQLines(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
) {
  return client
    .from("purchasingRfqLines")
    .select("*")
    .eq("purchasingRfqId", purchasingRfqId)
    .order("order", { ascending: true });
}

type PurchasingRfqSupplierWithSupplier =
  Database["public"]["Tables"]["purchasingRfqSupplier"]["Row"] & {
    supplier: { id: string; name: string };
  };

type LinkedSupplierQuote = {
  supplierQuoteId: string;
  supplierQuote:
    | (Database["public"]["Tables"]["supplierQuote"]["Row"] & {
        supplier: Database["public"]["Tables"]["supplier"]["Row"] | null;
      })
    | null;
};

export async function getPurchasingRFQSuppliers(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
): Promise<PostgrestResponse<PurchasingRfqSupplierWithSupplier>> {
  // tsgo's limit; the cliff shifts as unrelated modules join the program.
  // ts-ignore, not ts-expect-error, so it satisfies both tsc and tsgo.
  return client
    .from("purchasingRfqSupplier")
    .select("*, supplier(id, name)")
    .eq("purchasingRfqId", purchasingRfqId);
}

/** Not published: `purchasing_createPurchasingRfq` creates an RFQ with its suppliers. */
export async function insertPurchasingRFQ(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    rfqId?: string;
    rfqDate?: string;
    expirationDate?: string;
    locationId?: string;
    employeeId?: string;
    status?: (typeof purchasingRfqStatusType)[number];
    notes?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; rfqId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let rfqId: string;
  if (input.rfqId) {
    rfqId = input.rfqId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "purchasingRfq",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate purchasingRfq sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    rfqId = seq.data;
  }

  const rfq = await client
    .from("purchasingRfq")
    .insert({
      rfqId,
      rfqDate:
        input.rfqDate ??
        datetime
          .today(await getCompanyTimeZone(client, input.companyId))
          .toString(),
      expirationDate: input.expirationDate,
      locationId: input.locationId,
      employeeId: input.employeeId,
      status: input.status ?? "Draft",
      notes: input.notes,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, rfqId")
    .single();

  if (rfq.error) return { data: null, error: rfq.error };

  return { data: { id: rfq.data.id, rfqId: rfq.data.rfqId }, error: null };
}

export async function updatePurchasingRFQ(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    rfqDate?: string;
    expirationDate?: string | null;
    locationId?: string;
    employeeId?: string | null;
    status?: (typeof purchasingRfqStatusType)[number];
    notes?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, updatedBy, ...updates } = input;

  return client
    .from("purchasingRfq")
    .update({
      ...sanitize(updates),
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

/**
 * @deprecated Use insertPurchasingRFQ for new RFQs, updatePurchasingRFQ for existing RFQs
 */
export async function upsertPurchasingRFQ(
  client: SupabaseClient<Database>,
  purchasingRfq: {
    id?: string;
    rfqId: string;
    rfqDate: string;
    expirationDate?: string;
    locationId?: string;
    employeeId?: string;
    status?: (typeof purchasingRfqStatusType)[number];
    companyId: string;
    createdBy?: string;
    updatedBy?: string;
    customFields?: Json;
  }
) {
  if (purchasingRfq.id) {
    return client
      .from("purchasingRfq")
      .update(sanitize(purchasingRfq))
      .eq("id", purchasingRfq.id)
      .select("id")
      .single();
  }
  return client
    .from("purchasingRfq")
    .insert([purchasingRfq])
    .select("id")
    .single();
}

export async function upsertPurchasingRFQLine(
  client: SupabaseClient<Database>,
  purchasingRfqLine:
    | {
        purchasingRfqId: string;
        itemId: string;
        description?: string;
        quantity: number[];
        purchaseUnitOfMeasureCode: string;
        inventoryUnitOfMeasureCode: string;
        conversionFactor?: number;
        order: number;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      }
    | {
        id: string;
        purchasingRfqId: string;
        itemId: string;
        description?: string;
        quantity: number[];
        purchaseUnitOfMeasureCode: string;
        inventoryUnitOfMeasureCode: string;
        conversionFactor?: number;
        order: number;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      }
) {
  if ("id" in purchasingRfqLine) {
    return client
      .from("purchasingRfqLine")
      .update(sanitize(purchasingRfqLine))
      .eq("id", purchasingRfqLine.id)
      .select("id")
      .single();
  }
  return client
    .from("purchasingRfqLine")
    .insert([purchasingRfqLine])
    .select("id")
    .single();
}

export async function updatePurchasingRFQLineOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  purchasingRfqId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "purchasingRfqLine",
    column: "order",
    companyId,
    userId,
    parent: { column: "purchasingRfqId", id: purchasingRfqId },
    updates
  });
}

export async function upsertPurchasingRFQSuppliers(
  client: SupabaseClient<Database>,
  purchasingRfqId: string,
  supplierIds: string[],
  companyId: string,
  createdBy: string
) {
  // Delete existing suppliers for this RFQ
  await client
    .from("purchasingRfqSupplier")
    .delete()
    .eq("purchasingRfqId", purchasingRfqId);

  // Insert new suppliers
  if (supplierIds.length === 0) {
    return { data: [], error: null };
  }

  const suppliersToInsert = supplierIds.map((supplierId) => ({
    purchasingRfqId,
    supplierId,
    companyId,
    createdBy
  }));

  return client
    .from("purchasingRfqSupplier")
    .insert(suppliersToInsert)
    .select("id");
}

export async function updatePurchasingRFQStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    status: (typeof purchasingRfqStatusType)[number];
    assignee?: string | null;
    updatedBy: string;
  }
) {
  return client
    .from("purchasingRfq")
    .update({
      status: args.status,
      assignee: args.assignee,
      updatedBy: args.updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.id)
    .select("id")
    .single();
}

export async function getLinkedSupplierQuotes(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
): Promise<PostgrestResponse<LinkedSupplierQuote>> {
  return client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier(*))
    `
    )
    .eq("purchasingRfqId", purchasingRfqId);
}

export async function getLinkedPurchasingRfqs(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
) {
  return client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      purchasingRfqId,
      purchasingRfq:purchasingRfqId (*)
    `
    )
    .eq("supplierQuoteId", supplierQuoteId);
}

export async function getLinkedPurchasingRfqsForInteraction(
  client: SupabaseClient<Database>,
  supplierInteractionId: string
) {
  // First get all supplier quote IDs in this interaction
  const { data: quotes, error: quotesError } = await client
    .from("supplierQuote")
    .select("id")
    .eq("supplierInteractionId", supplierInteractionId);

  if (quotesError || !quotes || quotes.length === 0) {
    return { data: [], error: quotesError };
  }

  const quoteIds = quotes.map((q) => q.id);

  // Then get all purchasing RFQs linked to any of these quotes
  return client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      purchasingRfqId,
      purchasingRfq:purchasingRfqId (*)
    `
    )
    .in("supplierQuoteId", quoteIds);
}

// Get sibling quotes (quotes sharing any RFQ with current quote)
export async function getSiblingQuotesForQuote(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
): Promise<PostgrestResponse<LinkedSupplierQuote>> {
  // First get all RFQ IDs linked to this quote
  const { data: linkedRfqs, error: rfqError } = await client
    .from("purchasingRfqToSupplierQuote")
    .select("purchasingRfqId")
    .eq("supplierQuoteId", supplierQuoteId);

  if (rfqError || !linkedRfqs || linkedRfqs.length === 0) {
    return {
      data: [],
      error: rfqError
    } as unknown as PostgrestResponse<LinkedSupplierQuote>;
  }

  const rfqIds = linkedRfqs.map((r) => r.purchasingRfqId);

  // Get all quotes linked to any of these RFQs (excluding current quote)
  return client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier(*))
    `
    )
    .in("purchasingRfqId", rfqIds)
    .neq("supplierQuoteId", supplierQuoteId);
}

// Direct Order→RFQ lookup (more efficient than going through interaction)
export async function getLinkedPurchasingRfqsForOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchasingRfqToPurchaseOrder")
    .select(
      `
      purchasingRfqId,
      purchasingRfq:purchasingRfqId (*)
    `
    )
    .eq("purchaseOrderId", purchaseOrderId);
}

export async function getSupplierQuotesForComparison(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
) {
  // 1. Get all supplier quote IDs linked to this RFQ with supplier info
  const linksResult: PostgrestResponse<LinkedSupplierQuote> = await client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier(*))
    `
    )
    .eq("purchasingRfqId", purchasingRfqId);
  const { data: links, error: linksError } = linksResult;

  if (linksError || !links?.length) {
    return { data: { quotes: [], lines: [], prices: [] }, error: linksError };
  }

  // Extract all quotes (for comparison header count)
  const allQuotes = links
    .map((l) => l.supplierQuote)
    .filter((q): q is NonNullable<typeof q> => q !== null);

  if (allQuotes.length === 0) {
    return { data: { quotes: [], lines: [], prices: [] }, error: null };
  }

  // Get IDs of Active quotes only (for fetching lines/prices)
  const activeQuoteIds = allQuotes
    .filter((q) => q.status === "Active")
    .map((q) => q.id)
    .filter((id): id is string => !!id);

  // 2. Fetch lines and pricing for active quotes only (if any)
  if (activeQuoteIds.length === 0) {
    return {
      data: { quotes: allQuotes, lines: [], prices: [] },
      error: null
    };
  }

  const lines = await client
    .from("supplierQuoteLines")
    .select("*")
    .in("supplierQuoteId", activeQuoteIds);

  const prices = await client
    .from("supplierQuoteLinePrice")
    .select("*")
    .in("supplierQuoteId", activeQuoteIds);

  return {
    data: {
      quotes: allQuotes,
      lines: lines.data ?? [],
      prices: prices.data ?? []
    },
    error: lines.error || prices.error
  };
}

// Get RFQ suppliers with their supplier info
export async function getPurchasingRFQSuppliersWithLinks(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
): Promise<PostgrestResponse<PurchasingRfqSupplierWithSupplier>> {
  return client
    .from("purchasingRfqSupplier")
    .select("*, supplier(id, name)")
    .eq("purchasingRfqId", purchasingRfqId);
}

export type PoDefaultAttachment = {
  source: "company" | "supplier" | "item";
  name: string;
  size: number | null;
  path: string;
};

export async function getDefaultAttachmentsForPO(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    supplierId: string | null;
    itemIds: string[];
  }
): Promise<PoDefaultAttachment[]> {
  const { companyId, supplierId, itemIds } = args;

  const prefixes: { source: PoDefaultAttachment["source"]; path: string }[] = [
    { source: "company", path: `${companyId}/default-attachments/company` }
  ];
  if (supplierId) {
    prefixes.push({
      source: "supplier",
      path: `${companyId}/default-attachments/supplier/${supplierId}`
    });
  }
  // One listing of the item folder says which items have default attachments
  // at all, so only those are listed. A listing per PO line item, almost
  // always empty, was most of the storage calls a PO page made. A failed
  // listing falls back to checking every item.
  const bucket = storage(client).company(companyId);
  const itemFolders =
    itemIds.length === 0
      ? null
      : await bucket.list(`${companyId}/default-attachments/item`);
  const withAttachments = itemFolders?.error
    ? null
    : new Set(
        (itemFolders?.data ?? [])
          .filter((entry) => entry.id === null)
          .map((entry) => entry.name)
      );
  for (const id of itemIds ?? []) {
    if (withAttachments && !withAttachments.has(id)) continue;
    prefixes.push({
      source: "item",
      path: `${companyId}/default-attachments/item/${id}`
    });
  }

  const results = await Promise.all(
    prefixes.map(({ path }) => bucket.list(path))
  );

  return results.flatMap((result, idx) => {
    const { source, path: prefix } = prefixes[idx];
    // the union helper's structural type omits supabase's metadata field
    return (result.data ?? []).map((f) => ({
      source,
      name: f.name,
      size:
        (f.metadata as { size?: number } | null | undefined)?.size != null
          ? Math.round(
              ((f.metadata as { size?: number }).size as number) / 1024
            )
          : null,
      path: `${prefix}/${f.name}`
    }));
  });
}

/**
 * Apply a planning schedule/quantity change to a PO line.
 * `purchaseQuantity` is in PURCHASE units — the caller converts from inventory
 * units via the line's conversionFactor.
 *
 * A quantity change also restates the line's tax pair (`taxPairForQuantity`):
 * the extended price is generated from the quantity, the tax amount is stored,
 * so writing the quantity alone left the old amount against a new base.
 *
 * The Draft / Planned condition (`PLANNING_EDITABLE_PURCHASE_ORDER_STATUSES`)
 * is part of the UPDATE, so a PO sent or put in approval after the caller read
 * it is left alone: `updated` is false, and the caller sends the planner to
 * the PO instead.
 */
export async function updatePurchaseOrderLineSchedule(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    lineId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
    requiredDate?: string;
    purchaseQuantity?: number;
  }
): Promise<{ updated: boolean; error: { message: string } | null }> {
  let tax: { taxPercent: number; supplierTaxAmount: number } | undefined;

  if (args.purchaseQuantity !== undefined) {
    const line = await client
      .from("purchaseOrderLine")
      .select(
        "supplierUnitPrice, supplierShippingCost, purchaseQuantity, taxPercent, supplierTaxAmount, purchaseOrder!inner(currencyCode)"
      )
      .eq("id", args.lineId)
      .eq("companyId", args.companyId)
      .single();
    if (line.error) return { updated: false, error: line.error };

    // A PO with no currency is in the company's base currency, as the PO
    // line form reads it.
    let currencyCode = line.data.purchaseOrder?.currencyCode ?? null;
    if (!currencyCode) {
      const company = await client
        .from("company")
        .select("baseCurrencyCode")
        .eq("id", args.companyId)
        .single();
      if (company.error) return { updated: false, error: company.error };
      currencyCode = company.data.baseCurrencyCode;
    }
    if (!currencyCode) {
      return {
        updated: false,
        error: { message: "Purchase order has no currency" }
      };
    }
    const currency = await getCurrencyByCode(
      client,
      args.companyGroupId,
      currencyCode
    );
    if (currency.error) return { updated: false, error: currency.error };
    if (currency.data?.decimalPlaces == null) {
      return {
        updated: false,
        error: { message: `Currency ${currencyCode} has no precision` }
      };
    }

    const pair = taxPairForQuantity(
      line.data,
      args.purchaseQuantity,
      currency.data.decimalPlaces
    );
    tax = { taxPercent: pair.percent, supplierTaxAmount: pair.amount };
  }

  try {
    const updated = await db
      .updateTable("purchaseOrderLine")
      .set({
        ...(args.requiredDate !== undefined
          ? { requiredDate: args.requiredDate }
          : {}),
        ...(args.purchaseQuantity !== undefined
          ? { purchaseQuantity: args.purchaseQuantity }
          : {}),
        ...(tax ?? {}),
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", args.lineId)
      .where("companyId", "=", args.companyId)
      .where("purchaseOrderId", "in", (eb) =>
        eb
          .selectFrom("purchaseOrder")
          .select("id")
          .where("companyId", "=", args.companyId)
          .where("status", "in", [...PLANNING_EDITABLE_PURCHASE_ORDER_STATUSES])
      )
      .returning("id")
      .execute();
    return { updated: updated.length > 0, error: null };
  } catch (err) {
    return {
      updated: false,
      error: {
        message: err instanceof Error ? err.message : "Failed to update line"
      }
    };
  }
}

// ─── Purchase Return Orders (Supplier Returns) ───

export async function getPurchaseReturnOrders(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("purchaseReturnOrders")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `purchaseReturnOrderId.ilike.%${args.search}%,supplierReference.ilike.%${args.search}%`
    );
  }

  if (args.status) {
    query = query.eq(
      "status",
      args.status as (typeof purchaseReturnOrderStatusType)[number]
    );
  }

  if (args.supplierId) {
    query = query.eq("supplierId", args.supplierId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

export async function getPurchaseReturnOrder(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string
) {
  return client
    .from("purchaseReturnOrders")
    .select("*")
    .eq("id", purchaseReturnOrderId)
    .single();
}

export async function getPurchaseReturnOrderLines(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string,
  companyId: string
) {
  return client
    .from("purchaseReturnOrderLine")
    .select(
      "*, returnReason(name), item(name, readableIdWithRevision, itemTrackingType, thumbnailPath)"
    )
    .eq("purchaseReturnOrderId", purchaseReturnOrderId)
    .eq("companyId", companyId)
    .order("lineNumber");
}

export async function getPurchaseReturnOrderLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client
    .from("purchaseReturnOrderLine")
    .select("*")
    .eq("id", lineId)
    .single();
}

export async function getPurchaseReturnOrderLineTrackedEntities(
  client: SupabaseClient<Database>,
  lineIds: string[]
) {
  return client
    .from("purchaseReturnOrderLineTrackedEntity")
    .select("*, trackedEntity(id, readableId, status, quantity)")
    .in("purchaseReturnOrderLineId", lineIds);
}

export async function insertPurchaseReturnOrder(
  client: SupabaseClient<Database>,
  input: {
    supplierId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    purchaseReturnOrderId?: string;
    orderDate: string;
    supplierLocationId?: string;
    supplierContactId?: string;
    supplierReference?: string;
    locationId?: string;
    purchaseOrderId?: string;
    currencyCode?: string;
    expirationDate?: string;
    assignee?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; purchaseReturnOrderId: string } | null;
  error: PostgrestError | null;
}> {
  let purchaseReturnOrderId: string;
  if (input.purchaseReturnOrderId) {
    purchaseReturnOrderId = input.purchaseReturnOrderId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "purchaseReturnOrder",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate return order sequence"
          } as PostgrestError)
      };
    }
    purchaseReturnOrderId = seq.data;
  }

  let currencyCode = input.currencyCode;
  if (!currencyCode) {
    const [supplier, company] = await Promise.all([
      client
        .from("supplier")
        .select("currencyCode")
        .eq("id", input.supplierId)
        .single(),
      client
        .from("company")
        .select("baseCurrencyCode")
        .eq("id", input.companyId)
        .single()
    ]);
    currencyCode =
      supplier.data?.currencyCode ?? company.data?.baseCurrencyCode ?? "USD";
  }

  let exchangeRate = 1;
  if (currencyCode) {
    // Main's currency refactor: rates come from the get_exchange_rate RPC
    // (base=1, per-company override, else global market store) — the old
    // currency.exchangeRate column was dropped.
    const exchangeRateResult = await getExchangeRate(
      client,
      input.companyId,
      currencyCode
    );
    if (exchangeRateResult.error) {
      return { data: null, error: exchangeRateResult.error };
    }
    exchangeRate = exchangeRateResult.data;
  }

  const order = await client
    .from("purchaseReturnOrder")
    .insert({
      purchaseReturnOrderId,
      supplierId: input.supplierId,
      supplierLocationId: input.supplierLocationId,
      supplierContactId: input.supplierContactId,
      supplierReference: input.supplierReference ?? null,
      locationId: input.locationId,
      purchaseOrderId: input.purchaseOrderId,
      currencyCode,
      exchangeRate,
      orderDate: input.orderDate,
      expirationDate: input.expirationDate,
      assignee: input.assignee,
      companyId: input.companyId,
      createdBy: input.createdBy,
      customFields: input.customFields
    })
    .select("id, purchaseReturnOrderId")
    .single();

  return order;
}

export async function updatePurchaseReturnOrder(
  client: SupabaseClient<Database>,
  purchaseReturnOrder: Omit<
    z.infer<typeof purchaseReturnOrderValidator>,
    "id" | "purchaseReturnOrderId" | "status"
  > & {
    id: string;
    updatedBy: string;
    customFields?: Json;
  }
) {
  const { id, ...update } = purchaseReturnOrder;
  return client
    .from("purchaseReturnOrder")
    .update({ ...sanitize(update), updatedAt: datetime.timestamp() })
    .eq("id", id)
    .select("id")
    .single();
}

/** Not published: `purchasing_addReturnOrderLine` / `_updateLine` write a line, with the Draft and post-confirm checks this skips. */
export async function upsertPurchaseReturnOrderLine(
  client: SupabaseClient<Database>,
  line:
    | (Omit<
        z.infer<typeof purchaseReturnOrderLineValidator>,
        "id" | "trackedEntityIds"
      > & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<
        z.infer<typeof purchaseReturnOrderLineValidator>,
        "id" | "trackedEntityIds"
      > & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in line) {
    const existing = await client
      .from("purchaseReturnOrderLine")
      .select("lineNumber")
      .eq("purchaseReturnOrderId", line.purchaseReturnOrderId)
      .eq("companyId", line.companyId)
      .order("lineNumber", { ascending: false })
      .limit(1)
      .maybeSingle();

    return client
      .from("purchaseReturnOrderLine")
      .insert([
        {
          ...line,
          lineNumber: (existing.data?.lineNumber ?? 0) + 1
        }
      ])
      .select("id")
      .single();
  }
  const { id, ...update } = line;
  return client
    .from("purchaseReturnOrderLine")
    .update({ ...sanitize(update), updatedAt: datetime.timestamp() })
    .eq("id", id)
    .select("id")
    .single();
}

export async function deletePurchaseReturnOrder(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string
) {
  return client
    .from("purchaseReturnOrder")
    .delete()
    .eq("id", purchaseReturnOrderId);
}

export async function deletePurchaseReturnOrderLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client.from("purchaseReturnOrderLine").delete().eq("id", lineId);
}

/** Not published: `purchasing_updateReturnOrderLine` sets a line's entities, with its lock check. */
export async function setPurchaseReturnOrderLineTrackedEntities(
  client: SupabaseClient<Database>,
  lineId: string,
  companyId: string,
  entityIds: string[],
  userId: string
) {
  const deleteExisting = await client
    .from("purchaseReturnOrderLineTrackedEntity")
    .delete()
    .eq("purchaseReturnOrderLineId", lineId)
    .eq("companyId", companyId);
  if (deleteExisting.error) return deleteExisting;
  if (entityIds.length === 0) return deleteExisting;

  return client.from("purchaseReturnOrderLineTrackedEntity").insert(
    entityIds.map((trackedEntityId) => ({
      purchaseReturnOrderLineId: lineId,
      trackedEntityId,
      quantity: 1,
      companyId,
      createdBy: userId
    }))
  );
}

export async function getPurchaseReturnOrderShipments(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string,
  companyId: string
) {
  return client
    .from("shipment")
    .select("id, shipmentId, status, postingDate, createdAt")
    .eq("sourceDocumentId", purchaseReturnOrderId)
    .eq("sourceDocument", "Purchase Return Order")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

export async function getPurchaseReturnOrderCredits(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string,
  companyId: string
) {
  return client
    .from("memo")
    .select("id, memoId, status, amount, currencyCode, memoDate, postingDate")
    .eq("purchaseReturnOrderId", purchaseReturnOrderId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

export async function getPurchaseReturnOrderIssues(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string,
  companyId: string
) {
  return client
    .from("nonConformancePurchaseReturnOrderLine")
    .select(
      "id, purchaseReturnOrderLineId, nonConformance(id, nonConformanceId, name, status)"
    )
    .eq("purchaseReturnOrderId", purchaseReturnOrderId)
    .eq("companyId", companyId);
}

/**
 * Confirm a supplier return. The reversible-quantity cap is a transactional
 * invariant: the governing SOURCE rows (receipt/PO/invoice lines) are
 * row-locked so two concurrent confirms against the same source line
 * serialize, and the aggregates are re-read under that lock
 * (replaceInvoiceSettlements pattern).
 *
 * Not published: `purchasing_confirmReturnOrder` confirms, and stores the PDF.
 */
export async function confirmPurchaseReturnOrder(
  db: Kysely<KyselyDatabase>,
  { id, companyId }: { id: string; companyId: string },
  userId: string
) {
  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("purchaseReturnOrder")
      .select(["id", "status"])
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();

    if (!order) throw new Error("Return order not found");
    if (order.status !== "Draft") {
      throw new Error(
        `Cannot confirm a return order in ${order.status} status`
      );
    }

    const lines = await trx
      .selectFrom("purchaseReturnOrderLine")
      .select([
        "id",
        "lineNumber",
        "quantity",
        "purchaseOrderLineId",
        "receiptLineId",
        "purchaseInvoiceLineId"
      ])
      .where("purchaseReturnOrderId", "=", id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .execute();

    if (lines.length === 0) {
      throw new Error("Cannot confirm a return order with no lines");
    }

    // Reversible caps, checked per source-line link under a row lock on the
    // governing source row. Blind lines (no links) skip the check.
    const checks: {
      lineNumbers: number[];
      requested: number;
      linkColumn:
        | "receiptLineId"
        | "purchaseOrderLineId"
        | "purchaseInvoiceLineId";
      linkId: string;
    }[] = [];

    const byLink = new Map<string, (typeof checks)[number]>();
    for (const line of lines) {
      const linkColumn = line.receiptLineId
        ? ("receiptLineId" as const)
        : line.purchaseOrderLineId
          ? ("purchaseOrderLineId" as const)
          : line.purchaseInvoiceLineId
            ? ("purchaseInvoiceLineId" as const)
            : null;
      if (!linkColumn) continue;
      const linkId = line[linkColumn]!;
      const key = `${linkColumn}:${linkId}`;
      const existing = byLink.get(key);
      if (existing) {
        existing.requested += Number(line.quantity);
        existing.lineNumbers.push(line.lineNumber);
      } else {
        const check = {
          lineNumbers: [line.lineNumber],
          requested: Number(line.quantity),
          linkColumn,
          linkId
        };
        byLink.set(key, check);
        checks.push(check);
      }
    }

    for (const check of checks) {
      // Lock the governing source row, then read its received base. Receipt
      // line quantities are already inventory units; PO/invoice lines are in
      // purchase units and convert via conversionFactor.
      let base = 0;
      if (check.linkColumn === "receiptLineId") {
        const src = await trx
          .selectFrom("receiptLine")
          .select(["receivedQuantity"])
          .where("id", "=", check.linkId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        base = Number(src?.receivedQuantity ?? 0);
      } else if (check.linkColumn === "purchaseOrderLineId") {
        const src = await trx
          .selectFrom("purchaseOrderLine")
          .select(["quantityReceived", "conversionFactor"])
          .where("id", "=", check.linkId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        base =
          Number(src?.quantityReceived ?? 0) *
          Number(src?.conversionFactor ?? 1);
      } else {
        const src = await trx
          .selectFrom("purchaseInvoiceLine")
          .select(["quantity", "conversionFactor"])
          .where("id", "=", check.linkId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        base = Number(src?.quantity ?? 0) * Number(src?.conversionFactor ?? 1);
      }

      // Everything already authorized against this source line by OTHER
      // non-cancelled return orders (re-read under the source-row lock).
      // A PO-line check must ALSO count returns linked via a receipt line OF
      // that PO line: receipt-linked and PO-linked returns draw on the same
      // received base, and per-column counting let the two link types jointly
      // over-authorize the same goods. (A line carrying both links matches
      // the OR once — rows are counted, not columns.) The receipt-line check
      // deliberately does NOT count PO-linked returns the other way: they
      // cannot be attributed to one receipt line of a multi-receipt PO line,
      // and blocking on them would refuse legitimate returns.
      let siblingReceiptLineIds: string[] = [];
      if (check.linkColumn === "purchaseOrderLineId") {
        const receiptLinesOfPoLine = await trx
          .selectFrom("receiptLine")
          .select(["id"])
          .where("lineId", "=", check.linkId)
          .where("companyId", "=", companyId)
          .execute();
        siblingReceiptLineIds = receiptLinesOfPoLine.map((r) => r.id);
      }

      const others = await trx
        .selectFrom("purchaseReturnOrderLine")
        .innerJoin(
          "purchaseReturnOrder",
          "purchaseReturnOrder.id",
          "purchaseReturnOrderLine.purchaseReturnOrderId"
        )
        .select(({ fn }) => [
          fn
            .coalesce(
              fn.sum("purchaseReturnOrderLine.quantity"),
              sql<number>`0`
            )
            .as("authorized")
        ])
        .where((eb) =>
          siblingReceiptLineIds.length > 0
            ? eb.or([
                eb(
                  `purchaseReturnOrderLine.${check.linkColumn}`,
                  "=",
                  check.linkId
                ),
                eb(
                  "purchaseReturnOrderLine.receiptLineId",
                  "in",
                  siblingReceiptLineIds
                )
              ])
            : eb(
                `purchaseReturnOrderLine.${check.linkColumn}`,
                "=",
                check.linkId
              )
        )
        .where("purchaseReturnOrderLine.companyId", "=", companyId)
        .where("purchaseReturnOrder.status", "!=", "Cancelled")
        .where("purchaseReturnOrder.id", "!=", id)
        .executeTakeFirst();

      const alreadyAuthorized = Number(others?.authorized ?? 0);
      const cap = base - alreadyAuthorized;
      if (check.requested > cap + EPSILON) {
        throw new Error(
          `Line ${check.lineNumbers.join(", ")}: cannot authorize ${
            check.requested
          } — only ${Math.max(0, cap)} of ${base} remains returnable for the linked document line`
        );
      }
    }

    // Confirm releases the return for shipping. Status is derived, not fixed —
    // a fresh confirm from Draft has nothing shipped, so it lands on "To Ship",
    // but deriving keeps this consistent with the shipment/short-close paths.
    const { status } = getPurchaseReturnOrderStatus(
      lines.map((line) => ({
        quantity: line.quantity,
        quantityShipped: 0,
        closedComplete: false
      }))
    );

    await trx
      .updateTable("purchaseReturnOrder")
      .set({
        status,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/**
 * Reopen a supplier return back to Draft so its lines can be edited. THROWS.
 * Row-locked so a shipment posting racing this reopen serializes: only a
 * "To Ship" return with NOTHING shipped yet (or a "Cancelled" one) may reopen —
 * once any quantity has shipped, or the return is terminal ("Completed"),
 * reopening would strand shipped stock. "To Ship" no longer implies nothing
 * shipped (it also covers partially shipped), so the nothing-shipped invariant
 * is enforced on the line quantities directly.
 *
 * No cap is released: a Draft return still counts as authorized against its
 * source lines (the confirm check excludes only "Cancelled"), so the
 * authorization it holds is unchanged — only its editability.
 *
 * Not published: `purchasing_reopenReturnOrder` runs it.
 */
export async function reopenPurchaseReturnOrder(
  db: Kysely<KyselyDatabase>,
  { id, companyId, userId }: { id: string; companyId: string; userId: string }
) {
  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("purchaseReturnOrder")
      .select(["id", "status"])
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();

    if (!order) throw new Error("Return order not found");
    // To Ship → Draft (un-confirm) and Cancelled → Draft (revive). A Cancelled
    // return has no shipments and nothing shipped (the cancel guard enforces
    // that), so reviving it to Draft is safe.
    if (!["To Ship", "Cancelled"].includes(order.status)) {
      throw new Error(
        `Only a to-ship or cancelled return can be reopened — this one is ${order.status}`
      );
    }

    // "To Ship" can be partially shipped; reopening one that has shipped stock
    // would strand it. Refuse unless nothing has shipped yet.
    if (order.status === "To Ship") {
      const shippedLines = await trx
        .selectFrom("purchaseReturnOrderLine")
        .select(["quantityShipped"])
        .where("purchaseReturnOrderId", "=", id)
        .where("companyId", "=", companyId)
        .execute();
      if (shippedLines.some((l) => Number(l.quantityShipped) > EPSILON)) {
        throw new Error(
          "Cannot reopen: quantity has already shipped. Void the shipment first."
        );
      }
    }

    await trx
      .updateTable("purchaseReturnOrder")
      .set({
        status: "Draft",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/**
 * Cancel a supplier return. THROWS. A Kysely transaction that locks the order
 * row first — post-shipment re-checks the order status under the same lock, so
 * a shipment posting racing this cancel serializes: whichever commits first
 * wins, and the loser sees the new state instead of producing a Cancelled
 * order with shipped stock (whose caps and Issue coverage then vanish).
 *
 * Not published: `purchasing_cancelReturnOrder` runs it.
 */
export async function cancelPurchaseReturnOrder(
  db: Kysely<KyselyDatabase>,
  { id, companyId, userId }: { id: string; companyId: string; userId: string }
) {
  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("purchaseReturnOrder")
      .select(["status"])
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Return order not found");
    if (["Completed", "Cancelled"].includes(order.status)) {
      throw new Error(`Cannot cancel a return order in ${order.status} status`);
    }

    const [shipments, lines] = await Promise.all([
      trx
        .selectFrom("shipment")
        .select(["id"])
        .where("sourceDocumentId", "=", id)
        .where("sourceDocument", "=", "Purchase Return Order")
        .where("companyId", "=", companyId)
        .where("status", "!=", "Voided")
        .execute(),
      trx
        .selectFrom("purchaseReturnOrderLine")
        .select(["quantityShipped"])
        .where("purchaseReturnOrderId", "=", id)
        .where("companyId", "=", companyId)
        .execute()
    ]);

    if (shipments.length > 0) {
      throw new Error(
        "Cannot cancel: a shipment exists for this return order. Delete or void it first."
      );
    }
    if (lines.some((l) => Number(l.quantityShipped) > 0)) {
      throw new Error("Cannot cancel: quantity has already been shipped");
    }

    await trx
      .updateTable("purchaseReturnOrder")
      .set({
        status: "Cancelled",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .execute();

    return { id };
  });
}

/**
 * Short-close ("stop expecting") a supplier return line — the
 * shortClosePurchaseOrderLine mechanic. The header status is derived from the
 * lines afterwards, so short-closing the last open line completes the return
 * (there is no separate manual Complete action, mirroring the Purchase Order).
 */
export async function shortClosePurchaseReturnOrderLine(
  db: Kysely<KyselyDatabase>,
  {
    lineId,
    purchaseReturnOrderId,
    companyId,
    userId,
    intent
  }: {
    lineId: string;
    purchaseReturnOrderId: string;
    companyId: string;
    userId: string;
    intent: "close" | "reopen";
  }
) {
  return db.transaction().execute(async (trx) => {
    const line = await trx
      .selectFrom("purchaseReturnOrderLine")
      .select(["id"])
      .where("id", "=", lineId)
      .where("purchaseReturnOrderId", "=", purchaseReturnOrderId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    if (!line) throw new Error("Return order line not found");

    await trx
      .updateTable("purchaseReturnOrderLine")
      .set({
        closedComplete: intent === "close",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", lineId)
      .where("companyId", "=", companyId)
      .execute();

    const [order, lines] = await Promise.all([
      trx
        .selectFrom("purchaseReturnOrder")
        .select(["status"])
        .where("id", "=", purchaseReturnOrderId)
        .where("companyId", "=", companyId)
        .executeTakeFirst(),
      trx
        .selectFrom("purchaseReturnOrderLine")
        .select(["quantity", "quantityShipped", "closedComplete"])
        .where("purchaseReturnOrderId", "=", purchaseReturnOrderId)
        .where("companyId", "=", companyId)
        .execute()
    ]);

    // Recompute in both the To Ship and Completed working states: short-closing
    // the last open line completes the return, and reopening a line on a
    // completed return drops it back to To Ship.
    if (!order || !["To Ship", "Completed"].includes(order.status)) {
      return;
    }

    const { status } = getPurchaseReturnOrderStatus(lines);

    if (status !== order.status) {
      await trx
        .updateTable("purchaseReturnOrder")
        .set({
          status,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", purchaseReturnOrderId)
        .where("companyId", "=", companyId)
        .execute();
    }
  });
}

/**
 * "From document" picker source: posted receipt lines for the supplier with
 * their reversible remainders (received − already authorized on non-cancelled
 * supplier returns). BC's "Show Reversible Lines Only".
 */
/**
 * Returnable receipt lines for a supplier, searched + paginated in the database
 * via the get_returnable_receipt_lines RPC. The `received − already-authorized
 * > 0` filter, the text search (receipt #, PO #, item readable id, item name),
 * the recency ordering, and pagination all run in SQL so the "Add lines from
 * receipt" modal stays responsive when a supplier has thousands of receipt
 * lines. Each row carries `totalCount` — the size of the full returnable set
 * before limit/offset — so the UI can page through the rest.
 */
export async function getReturnableLinesForSupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierId: string,
  args?: {
    purchaseOrderId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }
) {
  return client.rpc("get_returnable_receipt_lines", {
    company_id: companyId,
    supplier_id: supplierId,
    purchase_order_id: args?.purchaseOrderId || undefined,
    search: args?.search?.trim() || undefined,
    limit_count: args?.limit ?? 5,
    offset_count: args?.offset ?? 0
  });
}

/**
 * Entity picker source for supplier return lines: serials/batches on hand
 * that were received from this supplier. Provenance is the Receipt attribute
 * (written by the receipt tracking route) resolved to the receipt's supplier
 * — no code writes a Supplier attribute onto tracked entities.
 */
export async function getReturnableEntitiesForSupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierId: string,
  itemId: string
) {
  const receipts = await client
    .from("receipt")
    .select("id")
    .eq("companyId", companyId)
    .eq("supplierId", supplierId)
    .eq("status", "Posted");
  if (receipts.error) {
    return { data: null, error: receipts.error };
  }
  const receiptIds = (receipts.data ?? []).map((r) => r.id);
  if (receiptIds.length === 0) {
    return { data: [], error: null };
  }
  return client
    .from("trackedEntity")
    .select("id, readableId, quantity, status, attributes")
    .eq("companyId", companyId)
    .eq("itemId", itemId)
    .eq("status", "Available")
    .in("attributes ->> Receipt", receiptIds);
}

/**
 * The Available tracked entities that came in on ONE receipt line, for the item.
 * Used to pre-select the batch/serial when a return line is added from a specific
 * receipt — provenance is the `Receipt Line` attribute stamped at receipt.
 */
export async function getReturnableEntitiesForReceiptLine(
  client: SupabaseClient<Database>,
  companyId: string,
  itemId: string,
  receiptLineId: string
) {
  return client
    .from("trackedEntity")
    .select("id, readableId, quantity, status")
    .eq("companyId", companyId)
    .eq("itemId", itemId)
    .eq("status", "Available")
    .eq("attributes ->> Receipt Line", receiptLineId);
}

/**
 * Per-line creditable pool = shipped − already credited. Draft memos count
 * against the pool (two Drafts must not double-credit); the VIEW's displayed
 * quantityCredited still derives from Posted memos only.
 */
export async function getCreditableQuantitiesForPurchaseReturn(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string,
  companyId: string
) {
  const lines = await client
    .from("purchaseReturnOrderLine")
    .select("id, lineNumber, quantityShipped, unitPrice, restockFeePercent")
    .eq("purchaseReturnOrderId", purchaseReturnOrderId)
    .eq("companyId", companyId)
    .order("lineNumber");
  if (lines.error) return { data: null, error: lines.error };
  const lineIds = (lines.data ?? []).map((l) => l.id);
  if (lineIds.length === 0) return { data: [], error: null };

  const credits = await client
    .from("purchaseReturnOrderCreditLine")
    .select("purchaseReturnOrderLineId, quantity, memo!inner(status)")
    .in("purchaseReturnOrderLineId", lineIds)
    .eq("companyId", companyId)
    .neq("memo.status", "Voided");
  if (credits.error) return { data: null, error: credits.error };

  const creditedByLine = new Map<string, number>();
  for (const row of credits.data ?? []) {
    creditedByLine.set(
      row.purchaseReturnOrderLineId,
      (creditedByLine.get(row.purchaseReturnOrderLineId) ?? 0) +
        Number(row.quantity)
    );
  }

  return {
    data: (lines.data ?? []).map((line) => {
      const shipped = Number(line.quantityShipped);
      const credited = creditedByLine.get(line.id) ?? 0;
      return {
        purchaseReturnOrderLineId: line.id,
        lineNumber: line.lineNumber,
        quantityShipped: shipped,
        quantityCredited: credited,
        creditableQuantity: Math.max(0, shipped - credited),
        unitPrice: Number(line.unitPrice),
        restockFeePercent: Number(line.restockFeePercent)
      };
    }),
    error: null
  };
}

/**
 * Issue supplier credit: one AP memo + per-line purchaseReturnOrderCreditLine
 * breakdown. Cap = shipped − already credited over NON-VOIDED memos,
 * validated under a row lock. Amount rounded once at the currency's
 * decimals. Returns the memo id.
 *
 * The memo is a **Debit** memo (the `debitMemo` DR- sequence), NOT a Credit
 * memo. `direction` alone decides the control side for both AR and AP
 * (`buildMemoJournal`): a Credit memo CREDITS the control account, which on
 * AP — a liability — would INCREASE what we owe the supplier. Returning goods
 * must reduce it, so the control leg has to be a debit. That also makes the
 * reason leg CREDIT GRNI, clearing the debit the return shipment posted
 * (DR GRNI / CR Inventory) so the suspense account nets to zero over the
 * cycle. Net effect: DR AP / CR Inventory, which is the SAP/NetSuite/D365
 * vendor-return pattern. The sales side is the mirror image and correctly
 * stays `Credit` (crediting AR, an asset, reduces it).
 *
 * The rest of invoicing already assumes this: `getAvailableCredits` and
 * `getCompanyHasOpenCredits` select supplier memos with
 * `direction = "Debit"`, so a Credit-direction memo here is also invisible to
 * "Apply Credit" on a supplier invoice.
 */
export async function createPurchaseReturnOrderCredit(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    purchaseReturnOrderId,
    companyId,
    companyGroupId,
    userId,
    memoDate,
    lines
  }: {
    purchaseReturnOrderId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
    memoDate: string;
    lines: { purchaseReturnOrderLineId: string; quantity: number }[];
  }
) {
  const order = await client
    .from("purchaseReturnOrder")
    .select(
      "id, status, supplierId, currencyCode, exchangeRate, purchaseReturnOrderId"
    )
    .eq("id", purchaseReturnOrderId)
    .eq("companyId", companyId)
    .single();
  if (order.error) throw new Error("Return order not found");
  if (["Draft", "Cancelled"].includes(order.data.status)) {
    throw new Error(
      `Cannot issue credit for a return order in ${order.data.status} status`
    );
  }

  const currency = await getCurrencyByCode(
    client,
    companyGroupId,
    order.data.currencyCode
  );
  const decimalPlaces = currency.data?.decimalPlaces ?? 2;

  const seq = await client.rpc("get_next_sequence", {
    sequence_name: "debitMemo",
    company_id: companyId
  });
  if (seq.error || !seq.data) {
    throw new Error("Failed to allocate debit memo number");
  }
  const memoId = seq.data;

  const requested = new Map(
    lines
      .filter((l) => l.quantity > 0)
      .map((l) => [l.purchaseReturnOrderLineId, l.quantity])
  );
  if (requested.size === 0) {
    throw new Error("Nothing to credit");
  }

  return db.transaction().execute(async (trx) => {
    const orderLines = await trx
      .selectFrom("purchaseReturnOrderLine")
      .select([
        "id",
        "lineNumber",
        "quantityShipped",
        "unitPrice",
        "restockFeePercent"
      ])
      .where("purchaseReturnOrderId", "=", purchaseReturnOrderId)
      .where("companyId", "=", companyId)
      .where("id", "in", [...requested.keys()])
      .forUpdate()
      .execute();

    if (orderLines.length !== requested.size) {
      throw new Error(
        "One or more credit lines do not belong to this return order"
      );
    }

    const credited = await trx
      .selectFrom("purchaseReturnOrderCreditLine")
      .innerJoin("memo", "memo.id", "purchaseReturnOrderCreditLine.memoId")
      .select(({ fn }) => [
        "purchaseReturnOrderCreditLine.purchaseReturnOrderLineId",
        fn
          .coalesce(
            fn.sum("purchaseReturnOrderCreditLine.quantity"),
            sql<number>`0`
          )
          .as("credited")
      ])
      .where("purchaseReturnOrderCreditLine.purchaseReturnOrderLineId", "in", [
        ...requested.keys()
      ])
      .where("purchaseReturnOrderCreditLine.companyId", "=", companyId)
      .where("memo.status", "!=", "Voided")
      .groupBy("purchaseReturnOrderCreditLine.purchaseReturnOrderLineId")
      .execute();
    const creditedByLine = new Map(
      credited.map((row) => [
        row.purchaseReturnOrderLineId,
        Number(row.credited)
      ])
    );

    let total = 0;
    const creditLineValues: {
      memoId: string;
      purchaseReturnOrderLineId: string;
      quantity: number;
      unitPrice: number;
      restockFee: number;
      companyId: string;
      createdBy: string;
    }[] = [];

    for (const line of orderLines) {
      const quantity = requested.get(line.id)!;
      const shipped = Number(line.quantityShipped ?? 0);
      const alreadyCredited = creditedByLine.get(line.id) ?? 0;
      const creditable = shipped - alreadyCredited;
      if (quantity > creditable + EPSILON) {
        throw new Error(
          `Line ${line.lineNumber}: cannot credit ${quantity} — only ${Math.max(
            0,
            creditable
          )} of ${shipped} shipped remains creditable`
        );
      }
      const unitPrice = Number(line.unitPrice ?? 0);
      const feePercent = Number(line.restockFeePercent ?? 0);
      const gross = quantity * unitPrice;
      const restockFee = gross * feePercent;
      total += gross - restockFee;
      creditLineValues.push({
        memoId: "",
        purchaseReturnOrderLineId: line.id,
        quantity,
        unitPrice,
        restockFee,
        companyId,
        createdBy: userId
      });
    }

    if (total <= 0) {
      throw new Error("Credit amount must be positive");
    }

    const memo = await trx
      .insertInto("memo")
      .values({
        memoId,
        direction: "Debit",
        status: "Draft",
        supplierId: order.data.supplierId,
        memoDate,
        currencyCode: order.data.currencyCode,
        exchangeRate: order.data.exchangeRate ?? 1,
        amount: round(total, decimalPlaces),
        reference: order.data.purchaseReturnOrderId,
        purchaseReturnOrderId,
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("purchaseReturnOrderCreditLine")
      .values(creditLineValues.map((v) => ({ ...v, memoId: memo.id })))
      .execute();

    return memo.id;
  });
}

/**
 * Create Replacement Purchase Order: a draft PO from the return lines,
 * priced from the linked PO line (purchase-UOM price + conversion factor
 * copied) else the supplierPart default. One replacement per return.
 */
export async function createReplacementPurchaseOrder(
  client: SupabaseClient<Database>,
  {
    purchaseReturnOrderId,
    companyId,
    companyGroupId,
    userId
  }: {
    purchaseReturnOrderId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
  }
): Promise<{
  data: { id: string } | null;
  error: PostgrestError | null;
}> {
  const order = await client
    .from("purchaseReturnOrder")
    .select("*")
    .eq("id", purchaseReturnOrderId)
    .eq("companyId", companyId)
    .single();
  if (order.error) return { data: null, error: order.error };
  if (["Draft", "Cancelled"].includes(order.data.status)) {
    return {
      data: null,
      error: {
        message: `Cannot create a replacement for a ${order.data.status} return order`
      } as PostgrestError
    };
  }
  if (order.data.replacementPurchaseOrderId) {
    return {
      data: { id: order.data.replacementPurchaseOrderId },
      error: null
    };
  }

  const lines = await client
    .from("purchaseReturnOrderLine")
    .select("*, item(type)")
    .eq("purchaseReturnOrderId", purchaseReturnOrderId)
    .eq("companyId", companyId);
  if (lines.error) return { data: null, error: lines.error };
  if ((lines.data ?? []).length === 0) {
    return {
      data: null,
      error: { message: "Return order has no lines" } as PostgrestError
    };
  }

  const linkedPoLineIds = (lines.data ?? [])
    .map((l) => l.purchaseOrderLineId)
    .filter(Boolean) as string[];
  const poLines =
    linkedPoLineIds.length > 0
      ? await client
          .from("purchaseOrderLine")
          .select(
            "id, supplierUnitPrice, conversionFactor, purchaseUnitOfMeasureCode, inventoryUnitOfMeasureCode"
          )
          .in("id", linkedPoLineIds)
          .eq("companyId", companyId)
      : { data: [], error: null };
  if (poLines.error) return { data: null, error: poLines.error };
  const poLineById = new Map((poLines.data ?? []).map((l) => [l.id, l]));

  const supplierParts = await client
    .from("supplierPart")
    .select(
      "itemId, currencyCode, supplierUnitPrice, conversionFactor, supplierUnitOfMeasureCode"
    )
    .eq("supplierId", order.data.supplierId)
    .eq("companyId", companyId)
    .in(
      "itemId",
      (lines.data ?? []).map((l) => l.itemId)
    );
  if (supplierParts.error) {
    return { data: null, error: supplierParts.error };
  }
  const supplierPartByItem = new Map(
    (supplierParts.data ?? []).map((sp) => [sp.itemId, sp])
  );

  const purchaseOrder = await insertPurchaseOrder(client, {
    supplierId: order.data.supplierId,
    companyId,
    companyGroupId,
    createdBy: userId,
    currencyCode: order.data.currencyCode,
    locationId: order.data.locationId ?? undefined,
    supplierContactId: order.data.supplierContactId ?? undefined,
    supplierLocationId: order.data.supplierLocationId ?? undefined,
    supplierReference: order.data.purchaseReturnOrderId
  });
  if (purchaseOrder.error || !purchaseOrder.data) {
    return { data: null, error: purchaseOrder.error };
  }
  const purchaseOrderId = purchaseOrder.data.id;

  // A supplier part's price is in its own currency; the replacement order is
  // in the return's, so it converts at today's rate.
  const [company, exchangeRates] = await Promise.all([
    client
      .from("company")
      .select("baseCurrencyCode")
      .eq("id", companyId)
      .single(),
    client.rpc("get_exchange_rates", { p_company_id: companyId })
  ]);
  if (company.error || exchangeRates.error) {
    await deletePurchaseOrder(client, purchaseOrderId);
    return { data: null, error: company.error ?? exchangeRates.error };
  }
  const baseCurrencyCode = company.data.baseCurrencyCode;
  const exchangeRateByCurrency = new Map(
    exchangeRates.data.map((rate) => [rate.currencyCode, rate.rate])
  );
  const orderCurrency = {
    currencyCode: order.data.currencyCode ?? baseCurrencyCode,
    exchangeRate: purchaseOrder.data.exchangeRate
  };
  const supplierPartPrice = (
    supplierPart:
      | { currencyCode: string | null; supplierUnitPrice: number | null }
      | undefined
  ) => {
    if (supplierPart?.supplierUnitPrice == null) return null;
    const currencyCode = supplierPartCurrency(
      supplierPart.currencyCode,
      baseCurrencyCode
    );
    // Base is always 1, whether or not the group lists it.
    const exchangeRate =
      currencyCode === orderCurrency.currencyCode
        ? orderCurrency.exchangeRate
        : currencyCode === baseCurrencyCode
          ? 1
          : exchangeRateByCurrency.get(currencyCode);
    // No rate: leave it to the next fallback rather than price it at par.
    if (!exchangeRate) return null;
    return convertUnitPrice(
      supplierPart.supplierUnitPrice,
      { currencyCode, exchangeRate },
      orderCurrency
    );
  };

  const lineTypeFor = (
    itemType: string | null | undefined
  ): Database["public"]["Enums"]["purchaseOrderLineType"] => {
    switch (itemType) {
      case "Part":
      case "Material":
      case "Tool":
      case "Consumable":
      case "Service":
        return itemType;
      default:
        return "Part";
    }
  };

  const replacementLines = (lines.data ?? []).map((line) => {
    const poLine = line.purchaseOrderLineId
      ? poLineById.get(line.purchaseOrderLineId)
      : null;
    const supplierPart = supplierPartByItem.get(line.itemId);
    const conversionFactor = Number(
      poLine?.conversionFactor ?? supplierPart?.conversionFactor ?? 1
    );
    // supplierUnitPrice is the supplier-currency figure; the PO line's
    // unitPrice generated column is base currency and would double-convert
    const unitPrice = Number(
      poLine?.supplierUnitPrice ??
        supplierPartPrice(supplierPart) ??
        Number(line.unitPrice) * conversionFactor
    );
    const purchaseQuantity =
      conversionFactor > 0
        ? Number(line.quantity) / conversionFactor
        : Number(line.quantity);

    return {
      purchaseOrderId,
      purchaseOrderLineType: lineTypeFor(line.item?.type),
      itemId: line.itemId,
      purchaseQuantity,
      supplierUnitPrice: unitPrice,
      exchangeRate: orderCurrency.exchangeRate,
      conversionFactor,
      purchaseUnitOfMeasureCode:
        poLine?.purchaseUnitOfMeasureCode ??
        supplierPart?.supplierUnitOfMeasureCode ??
        line.unitOfMeasureCode,
      inventoryUnitOfMeasureCode:
        poLine?.inventoryUnitOfMeasureCode ?? line.unitOfMeasureCode,
      companyId,
      createdBy: userId
    };
  });

  const insertLines = await client
    .from("purchaseOrderLine")
    .insert(replacementLines);
  if (insertLines.error) {
    await deletePurchaseOrder(client, purchaseOrderId);
    return { data: null, error: insertLines.error };
  }

  const link = await client
    .from("purchaseReturnOrder")
    .update({
      replacementPurchaseOrderId: purchaseOrderId,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", purchaseReturnOrderId)
    .eq("companyId", companyId);
  if (link.error) return { data: null, error: link.error };

  return { data: { id: purchaseOrderId }, error: null };
}

/**
 * Create a presigned upload URL for a supplier interaction (purchase order/supplier
 * quote/RFQ) document. First step of the two-step upload flow: PUT the file bytes to
 * the returned `signedUrl`, then call `documents_insertUploadedDocument` with the
 * returned `path`, the document type as `sourceDocument`, and the document id as
 * `sourceDocumentId`. The storage folder is scoped by `interactionId`.
 *       (packages/files/AGENTS.md): a non-browser caller mints a staged
 *       upload URL, then insertUploadedDocument converts and lands it.
 */
export async function createSupplierInteractionDocumentUploadUrl(
  client: SupabaseClient<Database>,
  args: { companyId: string; interactionId: string; name: string }
) {
  return createDocumentUploadUrl(client, {
    companyId: args.companyId,
    folder: "supplier-interaction",
    entityId: args.interactionId,
    name: args.name
  });
}

/**
 * Create a presigned upload URL for a supplier interaction LINE document. First step
 * of the two-step upload flow: PUT the file bytes to the returned `signedUrl`, then
 * call `documents_insertUploadedDocument` with the returned `path`, the line's
 * document type as `sourceDocument`, and the line id as `sourceDocumentId`.
 *       (packages/files/AGENTS.md): a non-browser caller mints a staged
 *       upload URL, then insertUploadedDocument converts and lands it.
 */
export async function createSupplierInteractionLineDocumentUploadUrl(
  client: SupabaseClient<Database>,
  args: { companyId: string; lineId: string; name: string }
) {
  return createDocumentUploadUrl(client, {
    companyId: args.companyId,
    folder: "supplier-interaction-line",
    entityId: args.lineId,
    name: args.name
  });
}

// ----------------------------------------------------------------------
// Leases (lessee, ASC 842; spec `.ai/specs/2026-10-11-lessee-leases.md`).
// Lifecycle changes — activate, modify, terminate, purchase, cancel — go
// through the `post-lease` server function; invoices are drafted by
// `create-lease-invoices`. These are the plain reads and the Draft writes.
// ----------------------------------------------------------------------

/** A refusal shaped like a PostgREST error, so every caller's existing
 *  `result.error` handling (routes, MCP dispatch) reports it unchanged. */
function leaseRefusal(code: string, message: string) {
  return {
    data: null,
    error: new PostgrestError({ message, details: "", hint: "", code })
  };
}

export async function getLeases(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("leases")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `leaseId.ilike.%${args.search}%,name.ilike.%${args.search}%,supplierName.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

export async function getLease(
  client: SupabaseClient<Database>,
  leaseId: string,
  companyId: string
) {
  return client
    .from("leases")
    .select("*")
    .eq("id", leaseId)
    .eq("companyId", companyId)
    .single();
}

/** `leaseId` (the readable LSE number) comes from the caller — the route
 *  draws it from the sequence. The leased assets are added, and their
 *  payment rows cut, by `saveDraftLeaseLine` (`purchasing.server.ts`).
 */
export async function insertLease(
  client: SupabaseClient<Database>,
  lease: Omit<z.infer<typeof leaseValidator>, "id"> & {
    leaseId: string;
    companyId: string;
    createdBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("lease")
    .insert([
      {
        ...leaseTermColumns(lease),
        leaseId: lease.leaseId,
        companyId: lease.companyId,
        createdBy: lease.createdBy,
        customFields: lease.customFields
      }
    ])
    .select("id, leaseId")
    .single();
}

/** A lease's details — its name, notes, owner and notice date
 *  (`leaseDetailFields`) — which stay editable in every status: nothing was
 *  measured from them. A Draft's terms are saved with `updateDraftLease`
 *  (`purchasing.server.ts`), which cuts the payment rows again in the same
 *  transaction; an active lease's terms change only with Modify.
 */
export async function updateLeaseDetails(
  client: SupabaseClient<Database>,
  lease: {
    id: string;
    companyId: string;
    updatedBy: string;
    name?: string | null;
    description?: string | null;
    assignee?: string | null;
    /** `YYYY-MM-DD`; on or before the end date. */
    noticeDate?: string | null;
  }
) {
  const details = Object.fromEntries(
    leaseDetailFields
      .filter((field) => lease[field] !== undefined)
      .map((field) => [field, lease[field] || null])
  );
  if (Object.keys(details).length === 0) {
    return leaseRefusal("LEASE_NO_DETAILS", "Nothing to update");
  }
  const updated = await client
    .from("lease")
    .update({
      ...details,
      updatedBy: lease.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", lease.id)
    .eq("companyId", lease.companyId)
    .select("id")
    .maybeSingle();
  if (updated.error) return updated;
  if (!updated.data) return leaseRefusal("LEASE_NOT_FOUND", "Lease not found");
  return updated;
}

/** Only a Draft lease can be deleted; cancel an active one. */
export async function deleteLease(
  client: SupabaseClient<Database>,
  leaseId: string,
  companyId: string
) {
  const deleted = await client
    .from("lease")
    .delete()
    .eq("id", leaseId)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .select("id");
  if (deleted.error) return deleted;
  if (deleted.data.length === 0) {
    return leaseRefusal(
      "LEASE_NOT_DRAFT",
      "No Draft lease was found to delete. Cancel or terminate an active lease instead."
    );
  }
  return deleted;
}

/** The lease's assets in their order. */
export async function getLeaseLines(
  client: SupabaseClient<Database>,
  leaseId: string,
  companyId: string
) {
  return fetchAllRecords(() =>
    client
      .from("leaseLine")
      .select("*, fixedAsset(item(thumbnailPath))")
      .eq("leaseId", leaseId)
      .eq("companyId", companyId)
      .order("sortOrder")
      .order("createdAt")
      .order("id")
  );
}

/** Every payment row of every asset: a long lease of many assets runs past
 *  PostgREST's 1,000-row page. */
export async function getLeasePayments(
  client: SupabaseClient<Database>,
  leaseId: string,
  companyId: string
) {
  return fetchAllRecords(() =>
    client
      .from("leasePayment")
      .select("*")
      .eq("leaseId", leaseId)
      .eq("companyId", companyId)
      .order("dueDate")
      .order("paymentType")
      .order("leaseLineId")
      .order("id")
  );
}

/** The lease when it is a Draft, else why it cannot change. */
async function requireDraftLease(
  client: SupabaseClient<Database>,
  leaseId: string,
  companyId: string,
  what = "A payment row"
) {
  const lease = await client
    .from("lease")
    .select("status, invoiceFromDate")
    .eq("id", leaseId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (lease.error) return { lease: null, refusal: lease.error.message };
  if (!lease.data) return { lease: null, refusal: "Lease not found" };
  if (lease.data.status !== "Draft") {
    return {
      lease: null,
      refusal: `${what} changes only while the lease is Draft; modify an active lease instead`
    };
  }
  return { lease: lease.data, refusal: null };
}

/** Removes an asset, and its payment rows with it, from a Draft lease. */
export async function deleteLeaseLine(
  client: SupabaseClient<Database>,
  args: { leaseId: string; leaseLineId: string; companyId: string }
) {
  const { refusal } = await requireDraftLease(
    client,
    args.leaseId,
    args.companyId,
    "An asset"
  );
  if (refusal) return leaseRefusal("LEASE_NOT_DRAFT", refusal);
  const deleted = await client
    .from("leaseLine")
    .delete()
    .eq("id", args.leaseLineId)
    .eq("leaseId", args.leaseId)
    .eq("companyId", args.companyId)
    .select("id");
  if (deleted.error) return deleted;
  if (deleted.data.length === 0) {
    return leaseRefusal("LEASE_LINE_NOT_FOUND", "Asset not found");
  }
  return deleted;
}

/** Add or change one payment row of a Draft lease's asset (a rent holiday,
 *  an irregular step). A row due before the lease's invoice-from date was
 *  paid outside Carbon and is Skipped. */
export async function upsertLeasePayment(
  client: SupabaseClient<Database>,
  payment: z.infer<typeof leasePaymentValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const { lease, refusal } = await requireDraftLease(
    client,
    payment.leaseId,
    payment.companyId
  );
  if (refusal || !lease) {
    return leaseRefusal("LEASE_NOT_DRAFT", refusal ?? "Lease not found");
  }
  const line = await client
    .from("leaseLine")
    .select("id")
    .eq("id", payment.leaseLineId)
    .eq("leaseId", payment.leaseId)
    .eq("companyId", payment.companyId)
    .maybeSingle();
  if (line.error) return line;
  if (!line.data) {
    return leaseRefusal("LEASE_LINE_NOT_FOUND", "Asset not found");
  }

  const row = {
    leaseId: payment.leaseId,
    leaseLineId: payment.leaseLineId,
    paymentType: payment.paymentType,
    periodStart: payment.periodStart,
    periodEnd: payment.periodEnd,
    dueDate: payment.dueDate,
    amount: payment.amount,
    status:
      payment.dueDate < lease.invoiceFromDate
        ? ("Skipped" as const)
        : ("Pending" as const)
  };
  if (payment.id) {
    return client
      .from("leasePayment")
      .update({
        ...row,
        updatedBy: payment.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", payment.id)
      .eq("leaseId", payment.leaseId)
      .eq("companyId", payment.companyId)
      .select("id")
      .single();
  }
  return client
    .from("leasePayment")
    .insert([
      { ...row, companyId: payment.companyId, createdBy: payment.userId }
    ])
    .select("id")
    .single();
}

export async function deleteLeasePayment(
  client: SupabaseClient<Database>,
  args: { leaseId: string; paymentId: string; companyId: string }
) {
  const { refusal } = await requireDraftLease(
    client,
    args.leaseId,
    args.companyId
  );
  if (refusal) return leaseRefusal("LEASE_NOT_DRAFT", refusal);
  const deleted = await client
    .from("leasePayment")
    .delete()
    .eq("id", args.paymentId)
    .eq("leaseId", args.leaseId)
    .eq("companyId", args.companyId)
    .select("id");
  if (deleted.error) return deleted;
  if (deleted.data.length === 0) {
    return leaseRefusal("LEASE_PAYMENT_NOT_FOUND", "Payment not found");
  }
  return deleted;
}

/** The monthly schedule of every asset, each line with whether its lease run
 *  rows have posted: a long lease of many assets runs past PostgREST's
 *  1,000-row page. */
export async function getLeaseSchedule(
  client: SupabaseClient<Database>,
  leaseId: string,
  companyId: string
) {
  return fetchAllRecords(() =>
    client
      .from("leaseScheduleLine")
      .select(
        "*, rows:revenueRecognitionSchedule!revenueRecognitionSchedule_leaseScheduleLine_fkey(id, type, status, journalId)"
      )
      .eq("leaseId", leaseId)
      .eq("companyId", companyId)
      .order("periodDate")
      .order("id")
  );
}

export async function getLeaseEvents(
  client: SupabaseClient<Database>,
  leaseId: string,
  companyId: string
) {
  return fetchAllRecords(() =>
    client
      .from("leaseEvent")
      .select("*")
      .eq("leaseId", leaseId)
      .eq("companyId", companyId)
      .order("effectiveDate", { ascending: false })
      .order("id")
  );
}

/** The purchase invoices that bill the lease, and the journals that name it. */
export async function getLeaseRelatedDocuments(
  client: SupabaseClient<Database>,
  leaseId: string,
  companyId: string
) {
  // Plain id reads, then one read per document table: the embedded selects
  // trip TS2589 on these busy tables (.ai/lessons.md).
  // Paged: every lease run month adds journal lines.
  const [invoiceLines, journalLines] = await Promise.all([
    fetchAllRecords(() =>
      client
        .from("purchaseInvoiceLine")
        .select("id, invoiceId")
        .eq("leaseId", leaseId)
        .eq("companyId", companyId)
        .order("id")
    ),
    fetchAllRecords(() =>
      client
        .from("journalLine")
        .select("id, journalId")
        .eq("documentType", "Lease")
        .eq("documentId", leaseId)
        .eq("companyId", companyId)
        .order("id")
    )
  ]);
  if (invoiceLines.error) return { data: null, error: invoiceLines.error };
  if (journalLines.error) return { data: null, error: journalLines.error };

  const invoiceIds = [
    ...new Set((invoiceLines.data ?? []).map((line) => line.invoiceId))
  ];
  const journalIds = [
    ...new Set((journalLines.data ?? []).map((line) => line.journalId))
  ];
  // In groups of ids, so each `.in()` fits in the request URL.
  const [invoices, journals] = await Promise.all([
    fetchAllByIds(invoiceIds, (batch) =>
      client
        .from("purchaseInvoice")
        .select("id, invoiceId, status, dateIssued")
        .in("id", batch)
        .eq("companyId", companyId)
        .order("id")
    ),
    fetchAllByIds(journalIds, (batch) =>
      client
        .from("journal")
        .select("id, journalEntryId, postingDate, status, sourceType")
        .in("id", batch)
        .eq("companyId", companyId)
        .order("id")
    )
  ]);
  if (invoices.error) return { data: null, error: invoices.error };
  if (journals.error) return { data: null, error: journals.error };

  return {
    data: {
      // Newest first. ISO dates sort as strings.
      purchaseInvoices: invoices.data.sort((a, b) =>
        (b.dateIssued ?? "").localeCompare(a.dateIssued ?? "")
      ),
      journals: journals.data.sort((a, b) =>
        b.postingDate.localeCompare(a.postingDate)
      )
    },
    error: null
  };
}
/**
 * Server-only purchasing helpers: the lease writes that need a Kysely
 * transaction. Lives in a `.server.ts`, not the barrel-exported
 * `purchasing.service.ts`, because the module barrel is bundled for the
 * browser.
 */

type Trx = Transaction<KyselyDatabase>;

/** A Draft lease, locked for the rest of the transaction. Throws when it is
 *  missing or no longer a Draft: its rows were cut and measured at
 *  activation, and change only with Modify. */
async function lockDraftLease(
  trx: Trx,
  args: { leaseId: string; companyId: string; what: string }
) {
  const lease = await trx
    .selectFrom("lease")
    .select([
      "status",
      "currencyCode",
      "paymentFrequency",
      "paymentTiming",
      "annualEscalationPercent",
      sql<string>`"commencementDate"::text`.as("commencementDate"),
      sql<string | null>`"endDate"::text`.as("endDate"),
      sql<string>`"invoiceFromDate"::text`.as("invoiceFromDate")
    ])
    .where("id", "=", args.leaseId)
    .where("companyId", "=", args.companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!lease) throw new Error("Lease not found");
  if (lease.status !== "Draft") {
    throw new Error(
      `${args.what} changes only while the lease is Draft; modify an active lease instead`
    );
  }
  return lease;
}

/** Replaces the payment rows of a locked Draft lease's assets (one asset with
 *  `leaseLineId`) with the ones its terms cut (`cutLeasePaymentRows`). An
 *  asset with no payment has no rows. An open-ended lease is cut through one
 *  period past today (`openEndedLeaseHorizon`); the daily job rolls it
 *  forward from there. */
async function cutDraftLeasePayments(
  trx: Trx,
  args: {
    lease: Awaited<ReturnType<typeof lockDraftLease>>;
    leaseId: string;
    leaseLineId?: string;
    companyId: string;
    userId: string;
  }
): Promise<number> {
  const { lease, leaseId, companyId, userId } = args;
  let linesQuery = trx
    .selectFrom("leaseLine")
    .select([
      "id",
      "paymentAmount",
      "purchaseOptionAmount",
      "purchaseOptionReasonablyCertain"
    ])
    .where("leaseId", "=", leaseId)
    .where("companyId", "=", companyId);
  if (args.leaseLineId) {
    linesQuery = linesQuery.where("id", "=", args.leaseLineId);
  }
  const lines = await linesQuery.execute();
  if (args.leaseLineId && lines.length === 0) {
    throw new Error("Asset not found");
  }
  if (lines.length === 0) return 0;

  const currency = await trx
    .selectFrom("currency")
    .innerJoin("company", "company.companyGroupId", "currency.companyGroupId")
    .select("currency.decimalPlaces")
    .where("company.id", "=", companyId)
    .where("currency.code", "=", lease.currencyCode)
    .executeTakeFirst();
  if (!currency) {
    throw new Error(`Currency ${lease.currencyCode} is not set up`);
  }
  const through = lease.endDate
    ? undefined
    : openEndedLeaseHorizon(
        lease.commencementDate,
        datetime.today(await getCompanyTimeZone(trx, companyId)).toString(),
        lease.paymentFrequency
      );

  const rows = lines
    .filter((line) => line.paymentAmount > 0)
    .flatMap(
      (line) =>
        cutLeasePaymentRows({
          lease,
          asset: line,
          decimals: currency.decimalPlaces,
          through
        }).rows
    );

  await trx
    .deleteFrom("leasePayment")
    .where("leaseId", "=", leaseId)
    .where("companyId", "=", companyId)
    .where(
      "leaseLineId",
      "in",
      lines.map((line) => line.id)
    )
    .execute();
  if (rows.length > 0) {
    await trx
      .insertInto("leasePayment")
      .values(
        rows.map((row) => ({ ...row, leaseId, companyId, createdBy: userId }))
      )
      .execute();
  }
  return rows.length;
}

/** Whether any of `fields` differs between a saved row and its new values. */
function changed(
  saved: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly string[]
): boolean {
  return fields.some(
    (field) =>
      next[field] !== undefined &&
      String(saved[field] ?? "") !== String(next[field] ?? "")
  );
}

/**
 * Cuts a Draft lease's payment rows again from its terms, one set per asset
 * at the asset's payment amount, replacing the rows (and any edits to them)
 * in one transaction. Pass `leaseLineId` to cut one asset's rows only. A row
 * due before the lease's `invoiceFromDate` was paid outside Carbon and is
 * created `Skipped`, so the daily job never invoices it. A purchase option row
 * is added only when it is reasonably certain (it is then part of the lease
 * liability).
 */
export async function regenerateLeasePayments(
  db: Kysely<KyselyDatabase>,
  args: {
    leaseId: string;
    leaseLineId?: string;
    companyId: string;
    userId: string;
  }
): Promise<{ count: number }> {
  return db.transaction().execute(async (trx) => {
    const lease = await lockDraftLease(trx, {
      leaseId: args.leaseId,
      companyId: args.companyId,
      what: "A payment row"
    });
    return { count: await cutDraftLeasePayments(trx, { ...args, lease }) };
  });
}

/**
 * Saves a Draft lease's terms and, when a term the payment rows are cut from
 * changed (`leasePaymentTermFields`), cuts every asset's rows again — one
 * transaction, so the rows never describe terms the lease no longer has. An
 * invoice-from date that still equals the commencement follows a new one
 * (`resolveLeaseDates`). `customFields` replaces the stored set; leave it out
 * to keep it.
 */
export async function updateDraftLease(
  db: Kysely<KyselyDatabase>,
  args: {
    leaseId: string;
    companyId: string;
    userId: string;
    terms: Omit<z.infer<typeof leaseValidator>, "id" | "leaseId">;
    customFields?: Json;
  }
): Promise<{ paymentsCut: boolean }> {
  const { leaseId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const saved = await lockDraftLease(trx, {
      leaseId,
      companyId,
      what: "A lease's terms"
    });
    const columns = leaseTermColumns(args.terms, saved);
    await trx
      .updateTable("lease")
      .set({
        ...columns,
        ...(args.customFields !== undefined
          ? { customFields: JSON.stringify(args.customFields) }
          : {}),
        updatedBy: userId,
        updatedAt: sql`now()`
      })
      .where("id", "=", leaseId)
      .where("companyId", "=", companyId)
      .execute();

    if (!changed(saved, columns, leasePaymentTermFields)) {
      return { paymentsCut: false };
    }
    await cutDraftLeasePayments(trx, {
      lease: { ...saved, ...columns },
      leaseId,
      companyId,
      userId
    });
    return { paymentsCut: true };
  });
}

/**
 * Adds an asset to a Draft lease (no `leaseLineId`) or changes one, and cuts
 * its payment rows again when it is new or a field they are cut from changed
 * (`leaseLinePaymentFields`) — one transaction. Only the asset's own fields
 * are written (`leaseLineColumns`), never its status, classification or
 * measurement.
 */
export async function saveDraftLeaseLine(
  db: Kysely<KyselyDatabase>,
  args: {
    leaseId: string;
    leaseLineId?: string;
    companyId: string;
    userId: string;
    line: Omit<z.infer<typeof leaseLineValidator>, "id" | "leaseId">;
  }
): Promise<{ id: string; paymentsCut: boolean }> {
  const { leaseId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const lease = await lockDraftLease(trx, {
      leaseId,
      companyId,
      what: "A leased asset"
    });
    const columns = leaseLineColumns(args.line);

    let id: string;
    let recut: boolean;
    if (args.leaseLineId) {
      const saved = await trx
        .selectFrom("leaseLine")
        .select([...leaseLinePaymentFields])
        .where("id", "=", args.leaseLineId)
        .where("leaseId", "=", leaseId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!saved) throw new Error("Asset not found");
      await trx
        .updateTable("leaseLine")
        .set({ ...columns, updatedBy: userId, updatedAt: sql`now()` })
        .where("id", "=", args.leaseLineId)
        .where("leaseId", "=", leaseId)
        .where("companyId", "=", companyId)
        .execute();
      id = args.leaseLineId;
      recut = changed(saved, columns, leaseLinePaymentFields);
    } else {
      const last = await trx
        .selectFrom("leaseLine")
        .select((eb) => eb.fn.max("sortOrder").as("sortOrder"))
        .where("leaseId", "=", leaseId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      const inserted = await trx
        .insertInto("leaseLine")
        .values({
          ...columns,
          leaseId,
          sortOrder: Number(last?.sortOrder ?? 0) + 1,
          companyId,
          createdBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      id = inserted.id;
      recut = true;
    }

    if (recut) {
      await cutDraftLeasePayments(trx, {
        lease,
        leaseId,
        leaseLineId: id,
        companyId,
        userId
      });
    }
    return { id, paymentsCut: recut };
  });
}

/** Returns the lease payment rows billed by these purchase invoice lines to
 *  Pending, so the next invoice run bills them again, stamped with who did
 *  it. The `purchaseInvoiceLine_release_lease_payment` trigger releases a
 *  row on ANY delete of its line (it cannot know the user); this runs first,
 *  so the trigger then finds nothing left to release. */
async function releaseLeasePayments(
  trx: Trx,
  args: { companyId: string; purchaseInvoiceLineIds: string[]; userId: string }
): Promise<void> {
  const { companyId, purchaseInvoiceLineIds, userId } = args;
  if (purchaseInvoiceLineIds.length === 0) return;
  await trx
    .updateTable("leasePayment")
    .set({
      status: "Pending",
      purchaseInvoiceLineId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("purchaseInvoiceLineId", "in", purchaseInvoiceLineIds)
    .execute();
}

/**
 * Deletes a Draft purchase invoice and, in the same transaction, returns the
 * lease payment rows it billed to Pending (see `releaseLeasePayments`).
 * Checked here under a row lock, because releasing a POSTED invoice's rows
 * would bill them twice. Throws on a missing or non-Draft invoice.
 */
export async function deletePurchaseInvoiceReleasingLeases(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; invoiceId: string; userId: string }
): Promise<void> {
  const { companyId, invoiceId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const invoice = await trx
      .selectFrom("purchaseInvoice")
      .select(["id", "status"])
      .where("id", "=", invoiceId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!invoice) throw new Error("Purchase invoice not found");
    if (invoice.status !== "Draft") {
      throw new Error(
        `Cannot delete purchase invoice with status "${invoice.status}". Only Draft invoices can be deleted.`
      );
    }

    const lines = await trx
      .selectFrom("purchaseInvoiceLine")
      .select("id")
      .where("invoiceId", "=", invoiceId)
      .where("companyId", "=", companyId)
      .where("leasePaymentId", "is not", null)
      .execute();
    await releaseLeasePayments(trx, {
      companyId,
      purchaseInvoiceLineIds: lines.map((line) => line.id),
      userId
    });

    await trx
      .deleteFrom("purchaseInvoice")
      .where("id", "=", invoiceId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** One line of a Draft purchase invoice, returning the lease payment row it
 *  billed to Pending (see `deletePurchaseInvoiceReleasingLeases`). The line
 *  must belong to `invoiceId` and that invoice must be Draft — checked here,
 *  under a row lock. Throws otherwise. */
export async function deletePurchaseInvoiceLineReleasingLeases(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    invoiceId: string;
    purchaseInvoiceLineId: string;
    userId: string;
  }
): Promise<void> {
  const { companyId, invoiceId, purchaseInvoiceLineId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const line = await trx
      .selectFrom("purchaseInvoiceLine")
      .innerJoin("purchaseInvoice", (join) =>
        join
          .onRef("purchaseInvoice.id", "=", "purchaseInvoiceLine.invoiceId")
          .onRef(
            "purchaseInvoice.companyId",
            "=",
            "purchaseInvoiceLine.companyId"
          )
      )
      .select([
        "purchaseInvoiceLine.invoiceId as invoiceId",
        "purchaseInvoice.status as status"
      ])
      .where("purchaseInvoiceLine.id", "=", purchaseInvoiceLineId)
      .where("purchaseInvoiceLine.companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!line || line.invoiceId !== invoiceId) {
      throw new Error("Purchase invoice line not found on this invoice");
    }
    if (line.status !== "Draft") {
      throw new Error(
        `Cannot delete a line of a purchase invoice with status "${line.status}". Only Draft invoices can be edited.`
      );
    }

    await releaseLeasePayments(trx, {
      companyId,
      purchaseInvoiceLineIds: [purchaseInvoiceLineId],
      userId
    });
    await trx
      .deleteFrom("purchaseInvoiceLine")
      .where("id", "=", purchaseInvoiceLineId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** The date a lease that commenced before the accounting cutover opens on, as
 *  `post-lease` activate resolves it (`resolveAccountingPeriod`,
 *  "historical-with-shift"): the cutover, or the first day of the first open
 *  period after it when the cutover's period is locked or closed. Read only —
 *  activation is what locks or opens the period — so the Draft's Skipped
 *  payment check (`skippedPaymentBlockers`) matches activation. */
export async function leaseOpeningAsOf(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; cutoverDate: string }
): Promise<string> {
  const { companyId, cutoverDate } = args;
  const period = await db
    .selectFrom("accountingPeriod")
    .select(["closeStatus", "closedAt"])
    .where("companyId", "=", companyId)
    .where("startDate", "<=", cutoverDate)
    .where("endDate", ">=", cutoverDate)
    .orderBy("startDate")
    .orderBy("id")
    .executeTakeFirst();
  const closed =
    period &&
    (period.closeStatus === "Locked" ||
      period.closeStatus === "Closed" ||
      period.closedAt !== null);
  if (!closed) return cutoverDate;
  const next = await db
    .selectFrom("accountingPeriod")
    .select(sql<string>`"startDate"::text`.as("startDate"))
    .where("companyId", "=", companyId)
    .where("startDate", ">", cutoverDate)
    .where("closeStatus", "=", "Open")
    .where("closedAt", "is", null)
    .orderBy("startDate")
    .orderBy("id")
    .executeTakeFirst();
  // With no open period after it, activation refuses; the cutover stands.
  return next?.startDate ?? cutoverDate;
}

/** The lease page's "Invoice": drafts the purchase invoices the lease has
 *  due, exactly as the daily job would — the `create-lease-invoices` server
 *  function. */
export async function generateLeaseInvoicesNow(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    /** `YYYY-MM-DD` in the company's timezone. */
    asOf: string;
    leaseId: string;
  }
): Promise<{ invoices: DraftedLeaseInvoice[]; invoiceIds: string[] }> {
  const { companyId, userId, asOf, leaseId } = args;
  const { invoices, invoiceIds, failures } = await serverFns
    .system({ db, companyId, userId })
    .invokeOrThrow("create-lease-invoices", { asOf, leaseId });
  // One lease is billed here, so its failure is the action's failure.
  if (failures.length > 0) {
    throw new Error(failures.map((f) => f.error).join("; "));
  }
  return { invoices, invoiceIds };
}

/** Where a Draft lease is worked on: its setup wizard, for someone who can
 *  edit it. Null for any other lease, or a viewer, who sees the lease page —
 *  as `draftRentalAgreementSetupPath`. */
export async function draftLeaseSetupPath(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string; id: string }
): Promise<string | null> {
  const { companyId, userId, id } = args;
  const [lease, claims] = await Promise.all([
    client
      .from("lease")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle(),
    getUserClaims(userId, companyId)
  ]);
  if (lease.data?.status !== "Draft") return null;
  if (!hasPermission(claims?.permissions, "purchasing", "update", companyId)) {
    return null;
  }
  return path.to.leaseSetup(id, "assets");
}

/** A server function's refusal as this function's error: its status picks
 *  the category, and an empty message (a data-layer failure) is `fallback`. */
export function fromServerFn(
  ctx: ServiceContext,
  error: { status: number; message: string },
  fallback: string
): CarbonError {
  const category: ErrorCategory =
    error.status === 400
      ? "validation"
      : error.status === 403
        ? "forbidden"
        : error.status === 404
          ? "notFound"
          : error.status === 409
            ? "conflict"
            : error.status < 500
              ? "rule"
              : "internal";
  return ctx.error(category, error.message || fallback, error);
}

/** Signed links to a supplier interaction's documents, for an email. A file
 *  that cannot be signed is logged and left out. */
export async function interactionAttachments(
  client: SupabaseClient<Database>,
  companyId: string,
  interactionId: string
): Promise<{ filename: string; path: string }[]> {
  const docs = await getSupplierInteractionDocuments(
    client,
    companyId,
    interactionId
  );
  return signedAttachments(
    client,
    companyId,
    docs.map((doc) => ({
      filename: doc.name,
      path: `${companyId}/supplier-interaction/${interactionId}/${doc.name}`
    }))
  );
}

export async function signedAttachments(
  client: SupabaseClient<Database>,
  companyId: string,
  files: { filename: string; path: string }[]
): Promise<{ filename: string; path: string }[]> {
  const signed = await async.map(files, async (file) => {
    const { data, error } = await storage(client)
      .company(companyId)
      .createSignedUrl(file.path, 3600);
    if (!data) {
      logger.error("Failed to create signed URL for attachment", {
        storagePath: file.path,
        error
      });
      return null;
    }
    return { filename: file.filename, path: data.signedUrl };
  });
  return signed.flatMap((file) => (file ? [file] : []));
}

/** The statuses of records an edit is about to touch, for a lock check. */
export async function statusesOf(
  ctx: ServiceContext,
  table:
    | "purchaseOrder"
    | "purchaseReturnOrder"
    | "purchasingRfq"
    | "supplierQuote",
  ids: string[]
): Promise<(string | null)[] | CarbonError> {
  const rows = await ctx.asCaller.supabase
    .from(table as "purchaseOrder")
    .select("status")
    .in("id", ids)
    .eq("companyId", ctx.company.id);
  if (rows.error) {
    return ctx.error("internal", "Failed to read the records", rows.error);
  }
  return rows.data.map((row) => row.status);
}

/**
 * The quote's share link: the existing one, or a new one, saved on the quote.
 * The link expires with the quote.
 */
export async function supplierQuoteLink(
  ctx: ServiceContext,
  quote: {
    id: string;
    externalLinkId: string | null;
    supplierId: string | null;
    expirationDate: string | null;
  }
): Promise<string | CarbonError> {
  const client = ctx.asSystem.supabase;
  const link = await upsertExternalLink(client, {
    id: quote.externalLinkId ?? undefined,
    documentType: "SupplierQuote",
    documentId: quote.id,
    supplierId: quote.supplierId,
    expiresAt: quote.expirationDate,
    companyId: ctx.company.id
  });
  if (link.error || !link.data) {
    return ctx.error("internal", "Failed to create the share link", link.error);
  }
  if (quote.externalLinkId !== link.data.id) {
    await client
      .from("supplierQuote")
      .update({ externalLinkId: link.data.id })
      .eq("id", quote.id)
      .eq("companyId", ctx.company.id);
  }
  return link.data.id;
}

// ── Supplier quote share link ────────────────────────────────────────────────
// The supplier answers through the quote's share link, which is the only
// credential: these run as the system, in the quote's company, on behalf of
// the quote's creator (`shareLinkContext`).

/** The supplier quote a share link answers, read with the service role. */
export async function sharedSupplierQuote(
  ctx: ServiceContext,
  supplierQuoteId: string
) {
  const quote = await ctx.asSystem.supabase
    .from("supplierQuote")
    .select("id, createdBy, exchangeRate, externalLinkId, externalNotes")
    .eq("id", supplierQuoteId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (quote.error) {
    return ctx.error("internal", "Failed to read the quote", quote.error);
  }
  if (!quote.data) return ctx.error("notFound", "Quote not found");
  return quote.data;
}

/** A refusal thrown by a Kysely write that guards its own rule ("Cannot
 *  cancel a return order in Completed status"): its message is for the
 *  person, unless it came from the data layer. */
export function refusedBy(
  ctx: ServiceContext,
  err: unknown,
  fallback: string
): CarbonError {
  return err instanceof Error && !isDataLayerError(err)
    ? ctx.error("rule", err.message, err)
    : ctx.error("internal", fallback, err);
}

// ── Leases (lessee) ─────────────────────────────────────────────────────────

/** A refusal unless the lease is the caller's company's (readable as the
 *  caller). */
async function leaseNotFound(
  ctx: ServiceContext,
  leaseId: string
): Promise<CarbonError | null> {
  const lease = await getLease(ctx.asCaller.supabase, leaseId, ctx.company.id);
  return lease.error || lease.data?.companyId !== ctx.company.id
    ? ctx.error("notFound", "Lease not found", lease.error)
    : null;
}

/** Runs one `post-lease` lifecycle action, which locks the lease and checks
 *  its own rules in one transaction. */
export async function postLease(
  ctx: ServiceContext,
  input: ServerFnInput<"post-lease">,
  fallback: string
): Promise<CarbonError | null> {
  const missing = await leaseNotFound(ctx, input.leaseId);
  if (missing) return missing;
  const result = await serverFns
    .system({
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    })
    .invoke("post-lease", input);
  return result.error ? fromServerFn(ctx, result.error, fallback) : null;
}

/**
 * Write (or clear) a Draft lease asset's classification override, audit
 * logged. An accounting decision, so it runs as the system on the caller's
 * `update: accounting`: an accountant need not hold the purchasing write the
 * lease's own policies ask for.
 */
export async function writeClassificationOverride(
  ctx: ServiceContext,
  {
    leaseId,
    leaseLineId,
    override
  }: {
    leaseId: string;
    leaseLineId: string;
    override: {
      classification: "Operating" | "Finance";
      reason: string;
    } | null;
  }
): Promise<CarbonError | null> {
  const client = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const [lease, line] = await Promise.all([
    client
      .from("lease")
      .select("id, status")
      .eq("id", leaseId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("leaseLine")
      .select("id, classificationOverride, classificationOverrideReason")
      .eq("id", leaseLineId)
      .eq("leaseId", leaseId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (lease.error || line.error) {
    return ctx.error(
      "internal",
      "Leased asset not found",
      lease.error ?? line.error
    );
  }
  if (!lease.data || !line.data) {
    return ctx.error("notFound", "Leased asset not found");
  }
  const fixed = () =>
    ctx.error(
      "rule",
      "The classification is fixed once the lease is activated"
    );
  if (lease.data.status !== "Draft") return fixed();

  // Activation stamps `lesseeClassification`, so an unstamped asset is one
  // still to be classified: an asset activated since the read above matches
  // no row, and its commenced treatment is never overwritten.
  const update = await client
    .from("leaseLine")
    .update({
      classificationOverride: override?.classification ?? null,
      classificationOverrideReason: override?.reason ?? null,
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", leaseLineId)
    .eq("leaseId", leaseId)
    .eq("companyId", companyId)
    .is("lesseeClassification", null)
    .select("id")
    .maybeSingle();
  if (update.error) {
    return ctx.error(
      "internal",
      override
        ? "Failed to override the classification"
        : "Failed to remove the classification override",
      update.error
    );
  }
  if (!update.data) return fixed();

  // Best-effort: a failed audit write never undoes the change.
  try {
    await insertAuditLogEntries(client, companyId, [
      {
        tableName: "leaseLine",
        entityType: "lease",
        entityId: leaseId,
        recordId: leaseLineId,
        operation: "UPDATE",
        actorId: ctx.auditUserId,
        diff: {
          classificationOverride: {
            old: line.data.classificationOverride,
            new: override?.classification ?? null
          },
          classificationOverrideReason: {
            old: line.data.classificationOverrideReason,
            new: override?.reason ?? null
          }
        },
        metadata: { origin: "web" }
      }
    ]);
  } catch (err) {
    logger.warn("audit write skipped for a lease classification override", {
      error: err
    });
  }
  return null;
}

/** Cancels the order's pending approval requests. Approved and Rejected ones
 *  stay: they are the audit trail. */
export async function cancelPendingApprovals(
  ctx: ServiceContext,
  purchaseOrderId: string
) {
  return ctx.asSystem.supabase
    .from("approvalRequest")
    .update({
      status: "Cancelled",
      updatedBy: ctx.auditUserId,
      updatedAt: datetime.timestamp()
    })
    .eq("documentType", "purchaseOrder")
    .eq("documentId", purchaseOrderId)
    .eq("companyId", ctx.company.id)
    .eq("status", "Pending")
    .select("id");
}

/** A file's size as the documents table stores it: whole kilobytes. */
export function kilobytes(file: Buffer): number {
  return Math.round(file.byteLength / 1024);
}

type PurchaseOrderRow = NonNullable<
  Awaited<ReturnType<typeof getPurchaseOrder>>["data"]
>;

/**
 * Renders the order's PDF, stores it with the supplier interaction's files
 * and adds it as a document. The step that fails is the message.
 */
export async function attachPurchaseOrderPdf(
  ctx: ServiceContext,
  { purchaseOrder, locale }: { purchaseOrder: PurchaseOrderRow; locale: string }
): Promise<{ fileName: string; path: string; size: number } | CarbonError> {
  const companyId = ctx.company.id;
  const purchaseOrderId = purchaseOrder.id!;
  let pdf: Awaited<ReturnType<typeof renderPurchaseOrderPdf>>;
  try {
    pdf = await renderPurchaseOrderPdf(ctx.asCaller.supabase, {
      companyId,
      companyGroupId: ctx.company.groupId,
      purchaseOrderId,
      locale
    });
  } catch (err) {
    return ctx.error("internal", "Failed to generate PDF", err);
  }

  const fileName = stripSpecialCharacters(
    `${getPurchaseOrderDisplayId(purchaseOrder)} - ${datetime
      .timestamp()
      .slice(0, -5)}.pdf`
  );
  const path = `${companyId}/supplier-interaction/${purchaseOrder.supplierInteractionId}/${fileName}`;
  const upload = await storage(ctx.asSystem.supabase)
    .company(companyId)
    .upload(path, pdf.body, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });
  if (upload.error) {
    return ctx.error("internal", "Failed to upload file", upload.error);
  }

  const size = kilobytes(pdf.body);
  const document = await upsertDocument(ctx.asSystem.supabase, {
    path,
    name: fileName,
    size,
    sourceDocument: "Purchase Order",
    sourceDocumentId: purchaseOrderId,
    readGroups: [ctx.auditUserId],
    writeGroups: [ctx.auditUserId],
    createdBy: ctx.auditUserId,
    companyId
  });
  if (document.error) {
    return ctx.error("internal", "Failed to create document", document.error);
  }
  return { fileName, path, size };
}

/**
 * The purchase order email to the supplier contact, copied to the buyer:
 * null when the contact has no email address.
 */
export async function purchaseOrderEmail(
  ctx: ServiceContext,
  {
    purchaseOrderId,
    supplierContactId,
    locale
  }: { purchaseOrderId: string; supplierContactId: string; locale: string }
) {
  const client = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const [
    company,
    contact,
    purchaseOrder,
    lines,
    locations,
    paymentTerms,
    buyer
  ] = await Promise.all([
    getCompany(client, companyId),
    getSupplierContact(client, supplierContactId, companyId),
    getPurchaseOrder(client, purchaseOrderId),
    getPurchaseOrderLines(client, purchaseOrderId),
    getPurchaseOrderLocations(client, purchaseOrderId),
    getPaymentTermsList(client, companyId),
    getUser(client, ctx.auditUserId)
  ]);
  if (!contact.data?.contact) throw new Error("Failed to get supplier contact");
  if (!company.data) throw new Error("Failed to get company");
  if (!buyer.data) throw new Error("Failed to get user");
  if (!purchaseOrder.data) throw new Error("Failed to get purchase order");
  if (!locations.data)
    throw new Error("Failed to get purchase order locations");
  if (!paymentTerms.data) throw new Error("Failed to get payment terms");
  const supplierEmail = contact.data.contact.email;
  if (!supplierEmail) return null;

  // Same decimals the PDF of this order uses.
  const currency = purchaseOrder.data.currencyCode
    ? await getCurrencyByCode(
        client,
        ctx.company.groupId,
        purchaseOrder.data.currencyCode
      )
    : null;
  const template = PurchaseOrderEmail({
    // @ts-expect-error TS2739 - TODO: fix type
    company: company.data,
    currencyDecimals: currency?.data?.decimalPlaces ?? null,
    locale,
    purchaseOrder: purchaseOrder.data,
    purchaseOrderLines: lines.data ?? [],
    purchaseOrderLocations: locations.data,
    recipient: {
      email: supplierEmail,
      firstName: contact.data.contact.firstName ?? undefined,
      lastName: contact.data.contact.lastName ?? undefined
    },
    sender: {
      email: buyer.data.email,
      firstName: buyer.data.firstName,
      lastName: buyer.data.lastName
    },
    paymentTerms: paymentTerms.data
  });
  return {
    to: [buyer.data.email, supplierEmail],
    from: buyer.data.email,
    subject: `Purchase Order ${getPurchaseOrderDisplayId(purchaseOrder.data)} from ${company.data.name}`,
    html: await renderAsync(template),
    text: await renderAsync(template, { plainText: true }),
    purchaseOrder: purchaseOrder.data,
    lines: lines.data ?? []
  };
}

/** Updates the supplier prices from the order when the company updates them
 *  on finalize. A failure is logged: the order stands. */
export async function updatePricesOnFinalize(
  ctx: ServiceContext,
  purchaseOrderId: string
) {
  const settings = await getCompanySettings(
    ctx.asSystem.supabase,
    ctx.company.id
  );
  if (settings.data?.purchasePriceUpdateTiming !== "Purchase Order Finalize") {
    return;
  }
  const update = await serverFns
    .system({
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    })
    .invoke("update-purchased-prices", {
      purchaseOrderId,
      source: "purchaseOrder",
      updatePrices: true,
      updateLeadTimes: false
    });
  if (update.error) {
    logger.error("Failed to update purchased prices", { error: update.error });
  }
}

/** After an approval: the PDF, the email and the prices, each logged when it
 *  fails. */
export async function releaseApprovedPurchaseOrder(
  ctx: ServiceContext,
  {
    purchaseOrderId,
    notification,
    supplierContact,
    cc,
    locale
  }: {
    purchaseOrderId: string;
    notification?: "Email" | "None";
    supplierContact?: string;
    cc?: string[];
    locale?: string;
  }
) {
  const purchaseOrder = await getPurchaseOrder(
    ctx.asSystem.supabase,
    purchaseOrderId
  );
  if (!purchaseOrder.data) return;

  const pdf = await attachPurchaseOrderPdf(ctx, {
    purchaseOrder: purchaseOrder.data,
    locale: locale ?? "en-US"
  });
  if (pdf instanceof CarbonError) {
    logger.error("Failed to generate PDF after approval", { error: pdf.cause });
  } else if (notification === "Email" && supplierContact) {
    try {
      const email = await purchaseOrderEmail(ctx, {
        purchaseOrderId,
        supplierContactId: supplierContact,
        locale: locale ?? "en-US"
      });
      if (email) {
        const [attachment] = await signedAttachments(
          ctx.asSystem.supabase,
          ctx.company.id,
          [{ filename: pdf.fileName, path: pdf.path }]
        );
        await trigger("send-email", {
          to: email.to,
          cc: cc?.length ? cc : undefined,
          from: email.from,
          subject: email.subject,
          html: email.html,
          text: email.text,
          attachments: attachment ? [attachment] : undefined,
          companyId: ctx.company.id
        });
      }
    } catch (err) {
      logger.error("Failed to send email after approval", { error: err });
    }
  }

  await updatePricesOnFinalize(ctx, purchaseOrderId);
}

// ── Purchasing planning ─────────────────────────────────────────────────────

/**
 * The date the supplier promised for a PO line: the line's own, else its
 * order's delivery date — the same COALESCE the `openPurchaseOrderLines` view
 * gives MRP. MRP dates the line by this ahead of the required date, so a
 * planning date change (which writes the required date) cannot move it.
 */
export function promisedDateOf(line: {
  promisedDate: string | null;
  receiptPromisedDate: string | null | undefined;
}): string | null {
  return line.promisedDate ?? line.receiptPromisedDate ?? null;
}

/** Sums forecasts that land on the same (item, location, period). */
export function deduplicateForecasts<
  T extends {
    itemId: string;
    locationId: string;
    periodId: string;
    forecastQuantity: number;
  }
>(forecasts: T[]): T[] {
  const map = new Map<string, T>();
  for (const forecast of forecasts) {
    const key = `${forecast.itemId}-${forecast.locationId}-${forecast.periodId}`;
    const existing = map.get(key);
    if (existing) {
      existing.forecastQuantity += forecast.forecastQuantity;
    } else {
      map.set(key, { ...forecast });
    }
  }
  return Array.from(map.values());
}

/** How many of `requested` worklist rows a dismiss, reopen or assign changed,
 *  as the message; a refusal when none did. */
export function worklistChange(
  ctx: ServiceContext,
  verb: "Dismissed" | "Reopened" | "Assigned",
  changed: number,
  requested: number
) {
  if (changed === 0) {
    const what = {
      Dismissed: "dismiss",
      Reopened: "reopen",
      Assigned: "assign"
    }[verb];
    return ctx.error(
      "conflict",
      `Nothing to ${what} — these actions changed since the page loaded`
    );
  }
  return {
    changed,
    message: `${verb} ${changed} planning action${changed === 1 ? "" : "s"}${
      changed < requested
        ? `; ${requested - changed} changed since the page loaded`
        : ""
    }`
  };
}
