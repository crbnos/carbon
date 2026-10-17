// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  InvalidInputError,
  isDataLayerError,
  NotFoundError,
  ServerFnError
} from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import {
  CarbonError,
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
import { isBeforeCutover } from "@carbon/database/accounting-cutover-dates";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  journalPostingStatus,
  readAccountingCutoverDate
} from "@carbon/database/journal-posting-status";
import type { AccountClass } from "@carbon/database/ledger";
import { toStoredAmount } from "@carbon/database/ledger";
import { assertBalanced, equals } from "@carbon/database/precision";
import {
  gte,
  inOrder,
  many,
  maybeSingle,
  selectRows
} from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
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
import {
  addDays,
  addMonths,
  async,
  BILLABLE_LEASE_STATUSES,
  buildJournalLineDimensionInserts,
  buildLesseeSchedule,
  datetime,
  EPSILON,
  escalatedLeasePayment,
  getPurchaseOrderStatus,
  getPurchaseReturnOrderStatus,
  groupBy,
  isBillableLeaseStatus,
  isPaidBeforeOpening,
  isTermWithinTwelveMonths,
  type LeasePaymentPoint,
  type LesseeCarrying,
  type LesseeLeg,
  type LesseeLegAccount,
  type LesseeScheduleLine,
  leaseMonthsAt,
  lesseeCarryingAt,
  lesseeCommencementLegs,
  lesseeOpeningBalanceLegs,
  lesseePurchaseLegs,
  lesseeRemeasurementLegs,
  lesseeScheduleSpan,
  lesseeTerminationLegs,
  measureLesseeAsset,
  normalizeLesseeLegs,
  openEndedLeaseHorizon,
  paymentMonthIndex,
  RoundingMode,
  remeasureLease,
  round
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { renderAsync } from "@react-email/components";
import {
  PostgrestError,
  type PostgrestResponse,
  type PostgrestSingleResponse,
  type SupabaseClient
} from "@supabase/supabase-js";
import { sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
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
import * as sharedPostings from "../shared/shared.service";
import {
  allocateJournalLineIds,
  createAdjustmentJournal,
  currencyDecimals,
  cutLeasePaymentRows,
  fromServerFn,
  getSupplierPartPriceConverter,
  insertNegatedJournal,
  invokePosting,
  invokePostingOrThrow,
  resolveAccountingPeriod,
  upsertExternalLink
} from "../shared/shared.service";
import { updateSortOrder } from "../shared/sort-order";
import type {
  leasePaymentValidator,
  leaseValidator,
  purchaseOrderDeliveryValidator,
  purchaseOrderLineValidator,
  purchaseOrderPaymentValidator,
  purchaseOrderStatusType,
  purchaseOrderTypeType,
  purchaseReturnOrderLineValidator,
  purchaseReturnOrderStatusType,
  purchasingRfqStatusType,
  selectedLinesValidator,
  supplierBankAccountValidator,
  supplierContactValidator,
  supplierPaymentValidator,
  supplierProcessValidator,
  supplierQuoteLineValidator,
  supplierQuoteStatusType,
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
  return invokePosting(
    { client, db, companyId, userId },
    "convert",
    // The type last: a loose payload must not pick another conversion.
    { ...input, type: "supplierQuoteToPurchaseOrder" },
    sharedPostings.convertDocument,
    { as: sharedPostings.convertDocumentPermission }
  );
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
  // Named columns only: an API body can carry any other (isPrimary, active,
  // createdAt), and this write bypasses row-level security.
  const fields = {
    name: bankAccount.name,
    accountHolderName: bankAccount.accountHolderName,
    bankName: bankAccount.bankName,
    bankAddress: bankAccount.bankAddress,
    countryCode: bankAccount.countryCode,
    currencyCode: bankAccount.currencyCode,
    accountNumber: bankAccount.accountNumber,
    bankCode: bankAccount.bankCode,
    swiftBic: bankAccount.swiftBic,
    notes: bankAccount.notes,
    customFields: bankAccount.customFields
  };

  if ("createdBy" in bankAccount) {
    return await db
      .insertInto("supplierBankAccount")
      .values({
        ...fields,
        supplierId,
        companyId,
        createdBy: bankAccount.createdBy
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  // supplierId and companyId are scoping columns, not editable fields. They are
  // re-asserted in the WHERE clause so a forged form value cannot move this
  // row to another supplier.
  return await db
    .updateTable("supplierBankAccount")
    .set({
      ...fields,
      updatedBy: bankAccount.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", bankAccount.id)
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

/** `updatePurchaseOrderStatus` on a Kysely handle, for a status change that
 *  must share a transaction with other writes. Returns the rows updated. */
export async function setPurchaseOrderStatus(
  db: Kysely<KyselyDatabase>,
  {
    id,
    companyId,
    status,
    assignee,
    updatedBy
  }: {
    id: string;
    companyId: string;
    status: (typeof purchaseOrderStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  const result = await db
    .updateTable("purchaseOrder")
    .set({ status, assignee, updatedBy, updatedAt: datetime.timestamp() })
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0);
}

/**
 * Sends a purchase order to Needs Approval and opens its approval request,
 * unless one is already pending. Call it inside a transaction, so an order
 * never waits for an approval that was not requested. The status update
 * locks the order first, which serialises two finalizes of one order.
 * Returns whether a request was opened; throws when the order is not found.
 */
export async function submitPurchaseOrderForApproval(
  db: Kysely<KyselyDatabase>,
  {
    id,
    companyId,
    userId,
    amount,
    orderDate
  }: {
    id: string;
    companyId: string;
    userId: string;
    amount: number;
    /** Today in the company's timezone: set only when the order has none. */
    orderDate: string;
  }
) {
  const updated = await db
    .updateTable("purchaseOrder")
    .set({
      status: "Needs Approval",
      orderDate: sql<string>`COALESCE("orderDate", ${orderDate})`,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows ?? 0) !== 1) {
    throw new NotFoundError("Purchase order not found");
  }

  const pending = await db
    .selectFrom("approvalRequest")
    .select("id")
    .where("documentType", "=", "purchaseOrder")
    .where("documentId", "=", id)
    .where("companyId", "=", companyId)
    .where("status", "=", "Pending")
    .executeTakeFirst();
  if (pending) return false;

  await db
    .insertInto("approvalRequest")
    .values({
      documentType: "purchaseOrder",
      documentId: id,
      requestedBy: userId,
      amount,
      companyId,
      createdBy: userId
    })
    .execute();
  return true;
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

const PURCHASE_ORDER_HEADER_COLUMNS = [
  "currencyCode",
  "orderDate",
  "supplierId",
  "supplierContactId",
  "supplierLocationId",
  "supplierReference",
  "purchaseOrderType",
  "customFields"
] as const;

export async function updatePurchaseOrder(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
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
  const { id, updatedBy, notes } = input;
  // Only these columns, and only the ones sent: the status changes through
  // finalize, reopen and close, never through a header edit.
  const updates = Object.fromEntries(
    PURCHASE_ORDER_HEADER_COLUMNS.filter((column) => column in input).map(
      (column) => [column, input[column]]
    )
  ) as Partial<
    Pick<typeof input, (typeof PURCHASE_ORDER_HEADER_COLUMNS)[number]>
  >;

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

export type Trx = Transaction<KyselyDatabase>;

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
  const { invoices, invoiceIds, failures } = await invokePostingOrThrow(
    { db, companyId, userId },
    "create-lease-invoices",
    { asOf, leaseId },
    createLeaseInvoices
  );
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
  input: z.input<typeof postLeaseInput>,
  fallback: string
): Promise<CarbonError | null> {
  const missing = await leaseNotFound(ctx, input.leaseId);
  if (missing) return missing;
  const result = await invokePosting(
    {
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    },
    "post-lease",
    input,
    postLeaseAction
  );
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
        }
      }
    ]);
  } catch (err) {
    logger.warn("audit write skipped for a lease classification override", {
      error: err
    });
  }
  return null;
}

/** Cancels the orders' pending approval requests. Approved and Rejected ones
 *  stay: they are the audit trail. Run it in the transaction that changes the
 *  orders, so a failed change leaves the requests pending. */
export async function cancelPendingApprovals(
  db: Kysely<KyselyDatabase>,
  {
    companyId,
    userId,
    purchaseOrderIds
  }: { companyId: string; userId: string; purchaseOrderIds: string[] }
) {
  if (purchaseOrderIds.length === 0) return [];
  return db
    .updateTable("approvalRequest")
    .set({
      status: "Cancelled",
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .where("documentType", "=", "purchaseOrder")
    .where("documentId", "in", purchaseOrderIds)
    .where("companyId", "=", companyId)
    .where("status", "=", "Pending")
    .returning("id")
    .execute();
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
  const update = await invokePosting(
    {
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    },
    "update-purchased-prices",
    {
      purchaseOrderId,
      source: "purchaseOrder",
      updatePrices: true,
      updateLeadTimes: false
    },
    updatePurchasedPrices
  );
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
export const finalizeSupplierQuoteInput = z.object({
  supplierQuoteId: z.string()
});

export const finalizeSupplierQuotePermission = {
  create: "purchasing"
} satisfies PermissionRule<z.output<typeof finalizeSupplierQuoteInput>>;

/**
 * Marks a supplier quote Active and copies its prices into the supplier's
 * price list, in one transaction: a supplier part per quoted item (created
 * when the supplier has none), one price break per quoted quantity, and the
 * lowest quoted price as the part's own.
 *
 * Prices are recorded as quoted — per purchase unit, in the quote's currency.
 * A part created here takes the quote's currency; an existing part in another
 * currency gets the price converted into its own.
 */
export async function finalizeSupplierQuote(
  ctx: ServiceContext,
  raw: z.input<typeof finalizeSupplierQuoteInput>
) {
  const { supplierQuoteId } = finalizeSupplierQuoteInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  await db.transaction().execute(async (trx) => {
    const quote = await trx
      .selectFrom("supplierQuote")
      .select(["id", "supplierId", "currencyCode", "exchangeRate"])
      .where("id", "=", supplierQuoteId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!quote) throw new NotFoundError("Supplier quote not found");
    if (!quote.supplierId) {
      throw new ServerFnError("Supplier quote has no supplier", 400);
    }
    const supplierId = quote.supplierId;

    const lines = await selectRows(
      trx,
      "supplierQuoteLine",
      { supplierQuoteId, companyId },
      {
        columns: [
          "id",
          "itemId",
          "supplierPartId",
          "purchaseUnitOfMeasureCode",
          "conversionFactor"
        ],
        orderBy: ["sortOrder", "id"]
      }
    );
    const prices = await many(trx, "supplierQuoteLinePrice", {
      supplierQuoteId,
      companyId
    });
    const pricesByLine = groupBy(
      prices.data,
      (price) => price.supplierQuoteLineId
    );

    // Every line needs one quantity with a price and a lead time: a price
    // list entry without either is worse than none.
    const unpriced = lines.find(
      (line) =>
        !(pricesByLine[line.id] ?? []).some(
          (price) => price.supplierUnitPrice && price.leadTime
        )
    );
    if (unpriced) {
      const item = unpriced.itemId
        ? await trx
            .selectFrom("item")
            .select("readableIdWithRevision")
            .where("id", "=", unpriced.itemId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : undefined;
      throw new InvalidInputError(
        `Line ${item?.readableIdWithRevision ?? unpriced.id} must have at least one quantity with price and lead time`
      );
    }

    await trx
      .updateTable("supplierQuote")
      .set({
        status: "Active",
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", supplierQuoteId)
      .where("companyId", "=", companyId)
      .execute();

    const pricedLines = lines.flatMap((line) => {
      const linePrices = pricesByLine[line.id] ?? [];
      return line.itemId && linePrices.length > 0
        ? [{ ...line, itemId: line.itemId, prices: linePrices }]
        : [];
    });
    if (pricedLines.length === 0) return;

    // An item the supplier already has a part for keeps that part as it is.
    await trx
      .insertInto("supplierPart")
      .values(
        pricedLines.map((line) => ({
          itemId: line.itemId,
          supplierId,
          supplierPartId: line.supplierPartId ?? undefined,
          supplierUnitOfMeasureCode:
            line.purchaseUnitOfMeasureCode ?? undefined,
          conversionFactor: line.conversionFactor ?? 1,
          currencyCode: quote.currencyCode,
          companyId,
          createdBy: userId
        }))
      )
      .onConflict((oc) =>
        oc.columns(["itemId", "supplierId", "companyId"]).doNothing()
      )
      .execute();

    const supplierParts = await trx
      .selectFrom("supplierPart")
      .select(["id", "itemId", "currencyCode"])
      .where("supplierId", "=", supplierId)
      .where("companyId", "=", companyId)
      .where("itemId", "in", [
        ...new Set(pricedLines.map((line) => line.itemId))
      ])
      .execute();
    const supplierPartByItem = new Map(
      supplierParts.map((part) => [part.itemId, part])
    );
    const converter = await getSupplierPartPriceConverter(
      trx,
      companyId,
      {
        currencyCode: quote.currencyCode,
        exchangeRate: quote.exchangeRate ?? 1
      },
      supplierParts.map((part) => part.currencyCode)
    );

    // Keyed by (part, quantity): when two lines quote one item at one
    // quantity the later line wins, as it did when these were written in turn.
    const priceBreaks = new Map<
      string,
      {
        supplierPartId: string;
        quantity: number;
        supplierUnitPrice: number;
        leadTime: number;
      }
    >();
    const updatedAt = datetime.timestamp();

    for (const line of pricedLines) {
      const supplierPart = supplierPartByItem.get(line.itemId);
      if (!supplierPart) {
        throw new ServerFnError("Failed to create supplier part", 500);
      }
      const supplierPartId = supplierPart.id;
      // Quote prices are per purchase unit, the basis a supplier part keeps.
      const toPartCurrency = (price: number) =>
        converter.toPartCurrency(price, supplierPart.currencyCode);

      for (const price of line.prices) {
        if (!price.supplierUnitPrice) continue;
        const quantity = price.quantity ?? 1;
        priceBreaks.set(`${supplierPartId}:${quantity}`, {
          supplierPartId,
          quantity,
          supplierUnitPrice: toPartCurrency(price.supplierUnitPrice),
          leadTime: price.leadTime ?? 0
        });
      }

      const bestPrice = line.prices
        .filter((price) => !!price.supplierUnitPrice)
        .sort((a, b) => a.supplierUnitPrice - b.supplierUnitPrice)[0];
      if (bestPrice) {
        await trx
          .updateTable("supplierPart")
          .set({
            supplierUnitPrice: toPartCurrency(bestPrice.supplierUnitPrice),
            minimumOrderQuantity: bestPrice.quantity ?? 1
          })
          .where("id", "=", supplierPartId)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    if (priceBreaks.size > 0) {
      await trx
        .insertInto("supplierPartPrice")
        .values(
          [...priceBreaks.values()].map((priceBreak) => ({
            ...priceBreak,
            sourceType: "Quote" as const,
            sourceDocumentId: supplierQuoteId,
            companyId,
            createdBy: userId,
            updatedBy: userId,
            updatedAt
          }))
        )
        .onConflict((oc) =>
          oc.columns(["supplierPartId", "quantity"]).doUpdateSet((eb) => ({
            supplierUnitPrice: eb.ref("excluded.supplierUnitPrice"),
            leadTime: eb.ref("excluded.leadTime"),
            sourceType: eb.ref("excluded.sourceType"),
            sourceDocumentId: eb.ref("excluded.sourceDocumentId"),
            companyId: eb.ref("excluded.companyId"),
            createdBy: eb.ref("excluded.createdBy"),
            updatedBy: eb.ref("excluded.updatedBy"),
            updatedAt: eb.ref("excluded.updatedAt")
          }))
        )
        .execute();
    }
  });

  return { success: true };
}
export const finalizePurchasingRfqInput = z.object({
  rfqId: z.string()
});

const ITEM_TYPES = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
  "Service"
] as const;

export type FinalizedSupplierQuote = {
  id: string;
  supplierQuoteId: string;
  supplierId: string;
  externalLinkId: string;
};

export const finalizePurchasingRfqPermission = {
  create: "purchasing"
} satisfies PermissionRule<z.output<typeof finalizePurchasingRfqInput>>;

/**
 * Sends a purchasing RFQ out: one Draft supplier quote per RFQ supplier, each
 * with its share link and a line per RFQ line that names an item, then the RFQ
 * is marked Requested. One transaction — a failure leaves no quotes behind,
 * and only a Draft RFQ is finalized, so a repeated request creates nothing.
 */
export async function finalizePurchasingRfq(
  ctx: ServiceContext,
  raw: z.input<typeof finalizePurchasingRfqInput>
) {
  const { rfqId } = finalizePurchasingRfqInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const quotes = await db.transaction().execute(async (trx) => {
    // Locked: a second submit waits here, then finds the RFQ Requested.
    const rfq = await trx
      .selectFrom("purchasingRfq")
      .select(["id", "status"])
      .where("id", "=", rfqId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!rfq) throw new NotFoundError("RFQ not found");
    if (rfq.status !== "Draft") {
      throw new InvalidInputError(
        `Only a draft RFQ can be finalized; this one is ${rfq.status}`
      );
    }

    const suppliers = await trx
      .selectFrom("purchasingRfqSupplier")
      .select("supplierId")
      .where("purchasingRfqId", "=", rfqId)
      .where("companyId", "=", companyId)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
    if (suppliers.length === 0) {
      throw new InvalidInputError("No suppliers found for this RFQ");
    }

    const lines = await selectRows(
      trx,
      "purchasingRfqLines",
      { purchasingRfqId: rfqId, companyId },
      { orderBy: ["order"] }
    );
    if (lines.length === 0) {
      throw new InvalidInputError("No line items found for this RFQ");
    }
    // supplierQuoteLine.itemId is NOT NULL
    const quotableLines = lines.flatMap((line) =>
      line.itemId ? [{ ...line, itemId: line.itemId }] : []
    );

    const created: FinalizedSupplierQuote[] = [];
    for (const { supplierId } of suppliers) {
      const supplierQuoteId = await getNextSequence(
        trx,
        "supplierQuote",
        companyId
      );
      const interaction = await trx
        .insertInto("supplierInteraction")
        .values({ companyId, supplierId })
        .returning("id")
        .executeTakeFirstOrThrow();
      const now = datetime.timestamp();
      const quote = await trx
        .insertInto("supplierQuote")
        .values({
          supplierQuoteId,
          supplierId,
          supplierInteractionId: interaction.id,
          status: "Draft",
          exchangeRate: 1,
          exchangeRateUpdatedAt: now,
          quotedDate: now,
          supplierQuoteType: "Purchase",
          companyId,
          createdBy: userId,
          updatedBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const externalLink = await trx
        .insertInto("externalLink")
        .values({
          documentType: "SupplierQuote",
          documentId: quote.id,
          supplierId,
          companyId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .updateTable("supplierQuote")
        .set({ externalLinkId: externalLink.id })
        .where("id", "=", quote.id)
        .where("companyId", "=", companyId)
        .execute();

      if (quotableLines.length > 0) {
        await trx
          .insertInto("supplierQuoteLine")
          .values(
            quotableLines.map((line, index) => ({
              supplierQuoteId: quote.id,
              supplierQuoteLineType: ITEM_TYPES.some(
                (type) => type === line.itemType
              )
                ? (line.itemType as string)
                : "Part",
              itemId: line.itemId,
              description: line.description ?? "",
              quantity: line.quantity ?? [1],
              inventoryUnitOfMeasureCode:
                line.inventoryUnitOfMeasureCode ?? "EA",
              purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode ?? "EA",
              conversionFactor: line.conversionFactor ?? 1,
              sortOrder: index + 1,
              companyId,
              createdBy: userId
            }))
          )
          .execute();
      }

      await trx
        .insertInto("purchasingRfqToSupplierQuote")
        .values({
          purchasingRfqId: rfqId,
          supplierQuoteId: quote.id,
          companyId
        })
        .execute();

      created.push({
        id: quote.id,
        supplierQuoteId,
        supplierId,
        externalLinkId: externalLink.id
      });
    }

    await trx
      .updateTable("purchasingRfq")
      .set({
        status: "Requested",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", rfqId)
      .where("companyId", "=", companyId)
      .execute();

    return created;
  });

  return { quotes };
}
const updatePurchasedPricesLogger = getLogger(
  "server-functions",
  "update-purchased-prices"
);

export const updatePurchasedPricesInput = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("purchaseOrder"),
    purchaseOrderId: z.string(),
    updatePrices: z.boolean().optional(),
    updateLeadTimes: z.boolean().optional()
  }),
  z.object({
    source: z.literal("purchaseInvoice"),
    invoiceId: z.string(),
    updatePrices: z.boolean().optional(),
    updateLeadTimes: z.boolean().optional()
  })
]);

interface PurchaseLineData {
  itemId: string | null;
  jobOperationId: string | null;
  /** Base currency, per purchase unit. */
  unitPrice: number;
  /** The document's currency, per purchase unit — what the supplier charged. */
  supplierUnitPrice: number;
  quantity: number;
  conversionFactor: number | null;
  purchaseUnitOfMeasureCode: string | null;
}

/** Whole days from order to delivery (`YYYY-MM-DD` each); 0 when either is unparseable. */
const calculateLeadTimeInDays = (
  orderDate: string,
  deliveryDate: string
): number => {
  try {
    return Math.max(0, parseDate(deliveryDate).compare(parseDate(orderDate)));
  } catch {
    return 0;
  }
};

export const updatePurchasedPricesPermission = {
  update: "purchasing"
} satisfies PermissionRule<z.output<typeof updatePurchasedPricesInput>>;

export async function updatePurchasedPrices(
  ctx: ServiceContext,
  raw: z.input<typeof updatePurchasedPricesInput>
) {
  const parsedPayload = updatePurchasedPricesInput.parse(raw);

  const { source } = parsedPayload;
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const shouldUpdatePrices = parsedPayload.updatePrices ?? true;
  const shouldUpdateLeadTimes = parsedPayload.updateLeadTimes ?? false;

  updatePurchasedPricesLogger.info("update-purchased-prices", {
    source,
    companyId,
    shouldUpdatePrices,
    shouldUpdateLeadTimes
  });

  let supplierId: string;
  let lines: PurchaseLineData[];
  let documentCurrency: { currencyCode: string | null; exchangeRate: number };

  switch (source) {
    case "purchaseOrder": {
      const { purchaseOrderId } = parsedPayload;

      updatePurchasedPricesLogger.info("update-purchased-prices", {
        source,
        purchaseOrderId,
        companyId
      });

      const [purchaseOrder, purchaseOrderLines] = await inOrder([
        () =>
          maybeSingle(db, "purchaseOrder", {
            id: purchaseOrderId,
            companyId
          }),
        () => many(db, "purchaseOrderLine", { purchaseOrderId, companyId })
      ]);

      if (purchaseOrder.error) throw new Error("Failed to fetch purchaseOrder");
      if (!purchaseOrder.data)
        throw new NotFoundError("Purchase order not found");
      if (purchaseOrderLines.error)
        throw new Error("Failed to fetch purchase order lines");
      if (!purchaseOrder.data.supplierId)
        throw new Error("Purchase order has no supplier");

      supplierId = purchaseOrder.data.supplierId;
      documentCurrency = {
        currencyCode: purchaseOrder.data.currencyCode,
        exchangeRate: purchaseOrder.data.exchangeRate ?? 1
      };
      lines = purchaseOrderLines.data
        .map((line) => ({
          itemId: line.itemId,
          jobOperationId: null,
          unitPrice: line.unitPrice ?? 0,
          supplierUnitPrice: line.supplierUnitPrice ?? 0,
          quantity: (line.purchaseQuantity ?? 0) * (line.conversionFactor ?? 1),
          conversionFactor: line.conversionFactor,
          purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode
        }))
        .filter((line) => line.quantity > 0);

      if (shouldUpdatePrices) {
        const today = datetime
          .today(await getCompanyTimeZone(db, companyId))
          .toString();

        // Delete any existing cost ledger entries for this PO (handles re-finalization)
        await db
          .deleteFrom("costLedger")
          .where("documentType", "=", "Purchase Order")
          .where("documentId", "=", purchaseOrderId)
          .where("companyId", "=", companyId)
          .execute();

        // Create new cost ledger entries for each line item. These are
        // planning/cost-history rows, NOT inventory layers — real layers
        // are created at receipt posting. remainingQuantity stays 0 so
        // FIFO/LIFO consumption can never eat unreceived stock.
        const costLedgerInserts = lines
          .filter((line) => line.itemId && line.unitPrice !== 0)
          .map((line) => ({
            itemLedgerType: "Purchase" as const,
            costLedgerType: "Direct Cost" as const,
            adjustment: false,
            documentType: "Purchase Order" as const,
            documentId: purchaseOrderId,
            itemId: line.itemId!,
            quantity: line.quantity,
            cost:
              (line.quantity / (line.conversionFactor ?? 1)) * line.unitPrice,
            remainingQuantity: 0,
            postingDate: today,
            supplierId,
            companyId
          }));

        if (costLedgerInserts.length > 0) {
          await db.insertInto("costLedger").values(costLedgerInserts).execute();
        }
      }

      break;
    }

    case "purchaseInvoice": {
      const { invoiceId } = parsedPayload;

      updatePurchasedPricesLogger.info("update-purchased-prices", {
        source,
        invoiceId,
        companyId
      });

      const [purchaseInvoice, purchaseInvoiceLines] = await inOrder([
        () => maybeSingle(db, "purchaseInvoice", { id: invoiceId, companyId }),
        () => many(db, "purchaseInvoiceLine", { invoiceId, companyId })
      ]);

      if (purchaseInvoice.error)
        throw new Error("Failed to fetch purchaseInvoice");
      if (!purchaseInvoice.data)
        throw new NotFoundError("Purchase invoice not found");
      if (purchaseInvoiceLines.error)
        throw new Error("Failed to fetch invoice lines");
      if (!purchaseInvoice.data.supplierId)
        throw new Error("Purchase invoice has no supplier");

      supplierId = purchaseInvoice.data.supplierId;
      documentCurrency = {
        currencyCode: purchaseInvoice.data.currencyCode,
        exchangeRate: purchaseInvoice.data.exchangeRate ?? 1
      };
      lines = purchaseInvoiceLines.data
        .map((line) => ({
          itemId: line.itemId,
          jobOperationId: line.jobOperationId,
          unitPrice: line.unitPrice ?? 0,
          supplierUnitPrice: line.supplierUnitPrice ?? 0,
          quantity: (line.quantity ?? 0) * (line.conversionFactor ?? 1),
          conversionFactor: line.conversionFactor,
          purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode
        }))
        .filter((line) => line.quantity > 0);
      break;
    }
  }

  const itemIds = Array.from(
    new Set(
      lines
        .filter((line) => Boolean(line.itemId))
        .map((line) => line.itemId as string)
    )
  );

  // Rolling one-year window over postingDate, anchored on the company's
  // calendar day (postingDate itself is company-tz derived).
  const dateOneYearAgo = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .subtract({ years: 1 })
    .toString();

  const itemCostUpdates: Database["public"]["Tables"]["itemCost"]["Update"][] =
    [];
  const itemReplenishmentUpdates: Database["public"]["Tables"]["itemReplenishment"]["Update"][] =
    [];
  const supplierPartInserts: Database["public"]["Tables"]["supplierPart"]["Insert"][] =
    [];
  const supplierPartUpdates: Database["public"]["Tables"]["supplierPart"]["Update"][] =
    [];

  const jobOperationUpdates: Database["public"]["Tables"]["jobOperation"]["Update"][] =
    [];

  const historicalPartCosts: Record<
    string,
    { quantity: number; cost: number }
  > = {};
  const historicalPartLeadTimes: Record<
    string,
    { quantity: number; weightedLeadTime: number }
  > = {};

  let supplierPartRows: Database["public"]["Tables"]["supplierPart"]["Row"][] =
    [];

  if (shouldUpdatePrices && itemIds.length > 0) {
    // Aggregate in SQL: fetching raw rows through PostgREST silently caps
    // at 1000, which skewed the weighted average for high-volume items.
    const [costLedgerTotals, supplierParts] = await inOrder([
      () =>
        db
          .selectFrom("costLedger")
          .select(({ fn }) => [
            "itemId",
            // Adjustment child rows (invoice-vs-receipt price corrections)
            // carry cost but no additional physical quantity, so they count
            // toward cost but not quantity.
            sql<number>`sum(case when "adjustment" then 0 else "quantity" end)`.as(
              "quantity"
            ),
            fn.sum<number>("cost").as("cost")
          ])
          .where("itemId", "in", itemIds)
          .where("companyId", "=", companyId)
          .where("postingDate", ">=", dateOneYearAgo)
          .groupBy("itemId")
          .execute(),
      () => many(db, "supplierPart", { supplierId, itemId: itemIds, companyId })
    ]);

    if (supplierParts.error) {
      throw new Error("Failed to fetch supplier parts");
    }

    supplierPartRows = supplierParts.data ?? [];

    costLedgerTotals.forEach((row) => {
      if (row.itemId) {
        historicalPartCosts[row.itemId] = {
          quantity: Number(row.quantity ?? 0),
          cost: Number(row.cost ?? 0)
        };
      }
    });
  }

  if (shouldUpdateLeadTimes && itemIds.length > 0) {
    const receipts = await many(
      db,
      "receipt",
      {
        companyId,
        sourceDocument: "Purchase Order",
        postingDate: gte(dateOneYearAgo)
      },
      { columns: ["id", "postingDate", "sourceDocumentId"] }
    );

    if (receipts.error) {
      throw new Error("Failed to fetch historical receipts");
    }

    const receiptIds = receipts.data?.map((receipt) => receipt.id) ?? [];
    const purchaseOrderIds = Array.from(
      new Set(
        (receipts.data ?? [])
          .map((receipt) => receipt.sourceDocumentId)
          .filter((id): id is string => Boolean(id))
      )
    );

    if (receiptIds.length > 0 && purchaseOrderIds.length > 0) {
      const [receiptLines, purchaseOrders] = await inOrder([
        () =>
          many(
            db,
            "receiptLine",
            { receiptId: receiptIds, itemId: itemIds, companyId },
            {
              columns: [
                "receiptId",
                "itemId",
                "receivedQuantity",
                "conversionFactor"
              ]
            }
          ),
        () =>
          many(
            db,
            "purchaseOrder",
            { id: purchaseOrderIds, companyId },
            { columns: ["id", "orderDate"] }
          )
      ]);

      if (receiptLines.error) {
        throw new Error("Failed to fetch historical receipt lines");
      }
      if (purchaseOrders.error) {
        throw new Error("Failed to fetch historical purchase orders");
      }

      const receiptsById = (receipts.data ?? []).reduce<
        Record<string, { postingDate: string; sourceDocumentId: string | null }>
      >((acc, receipt) => {
        if (receipt.postingDate) {
          acc[receipt.id] = {
            postingDate: receipt.postingDate,
            sourceDocumentId: receipt.sourceDocumentId
          };
        }
        return acc;
      }, {});

      const purchaseOrdersById = purchaseOrders.data.reduce<
        Record<string, { orderDate: string | null }>
      >((acc, row) => {
        acc[row.id] = { orderDate: row.orderDate };
        return acc;
      }, {});

      receiptLines.data.forEach((line) => {
        if (!line.itemId) return;

        const receipt = receiptsById[line.receiptId];
        if (!receipt?.sourceDocumentId) return;

        const orderDate =
          purchaseOrdersById[receipt.sourceDocumentId]?.orderDate;
        if (!orderDate || !receipt.postingDate) return;

        const safeConversionFactor =
          line.conversionFactor && line.conversionFactor > 0
            ? line.conversionFactor
            : 1;
        const quantity = Math.abs(
          (line.receivedQuantity ?? 0) / safeConversionFactor
        );
        if (quantity <= 0) return;

        const leadTimeInDays = calculateLeadTimeInDays(
          orderDate,
          receipt.postingDate
        );

        historicalPartLeadTimes[line.itemId] ??= {
          quantity: 0,
          weightedLeadTime: 0
        };
        const history = historicalPartLeadTimes[line.itemId]!;
        history.quantity += quantity;
        history.weightedLeadTime += leadTimeInDays * quantity;
      });
    }
  }

  // The supplier part records what the supplier charged, in its own
  // currency: copied exactly when it matches the document's, converted at
  // today's rate when it does not.
  const priceConverter =
    shouldUpdatePrices && itemIds.length > 0
      ? await getSupplierPartPriceConverter(
          db,
          companyId,
          documentCurrency,
          supplierPartRows
            .filter((sp) => sp.supplierId === supplierId)
            .map((sp) => sp.currencyCode)
        )
      : null;

  lines.forEach((line) => {
    if (line.itemId && !line.jobOperationId) {
      const costHistory = historicalPartCosts[line.itemId];
      const hasLeadTimeHistory =
        (historicalPartLeadTimes[line.itemId]?.quantity ?? 0) > 0;

      if (
        shouldUpdatePrices &&
        line.unitPrice !== 0 &&
        costHistory &&
        costHistory.quantity > 0
      ) {
        itemCostUpdates.push({
          itemId: line.itemId,
          unitCost: costHistory.cost / costHistory.quantity,
          updatedBy: "system"
        });

        const supplierPart = supplierPartRows.find(
          (sp) => sp.itemId === line.itemId && sp.supplierId === supplierId
        );

        if (supplierPart && supplierPart.id) {
          supplierPartUpdates.push({
            id: supplierPart.id,
            supplierUnitPrice: priceConverter!.toPartCurrency(
              line.supplierUnitPrice,
              supplierPart.currencyCode
            ),
            conversionFactor: line.conversionFactor ?? 1,
            supplierUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
            updatedBy: "system"
          });
        } else {
          supplierPartInserts.push({
            itemId: line.itemId,
            supplierId: supplierId,
            supplierUnitPrice: line.supplierUnitPrice,
            currencyCode: documentCurrency.currencyCode,
            conversionFactor: line.conversionFactor ?? 1,
            supplierUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
            createdBy: "system",
            companyId
          });
        }
      }

      if (shouldUpdatePrices || (shouldUpdateLeadTimes && hasLeadTimeHistory)) {
        const itemReplenishmentUpdate: Database["public"]["Tables"]["itemReplenishment"]["Update"] =
          {
            itemId: line.itemId,
            updatedBy: "system"
          };

        if (shouldUpdatePrices) {
          itemReplenishmentUpdate.preferredSupplierId = supplierId;
          itemReplenishmentUpdate.purchasingUnitOfMeasureCode =
            line.purchaseUnitOfMeasureCode;
          itemReplenishmentUpdate.conversionFactor = line.conversionFactor ?? 1;
        }

        const history = historicalPartLeadTimes[line.itemId];
        if (shouldUpdateLeadTimes && hasLeadTimeHistory && history) {
          itemReplenishmentUpdate.leadTime = Math.round(
            history.weightedLeadTime / history.quantity
          );
        }

        itemReplenishmentUpdates.push(itemReplenishmentUpdate);
      }
    }

    if (shouldUpdatePrices && line.jobOperationId && line.unitPrice !== 0) {
      jobOperationUpdates.push({
        id: line.jobOperationId,
        operationMinimumCost: 0,
        operationUnitCost: line.unitPrice ?? 0,
        updatedBy: "system"
      });
    }
  });

  await db.transaction().execute(async (trx) => {
    if (itemCostUpdates.length > 0) {
      for await (const itemCostUpdate of itemCostUpdates) {
        await trx
          .updateTable("itemCost")
          .set(itemCostUpdate)
          .where("itemId", "=", itemCostUpdate.itemId!)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    if (jobOperationUpdates.length > 0) {
      for await (const jobOperationUpdate of jobOperationUpdates) {
        await trx
          .updateTable("jobOperation")
          .set(jobOperationUpdate)
          .where("id", "=", jobOperationUpdate.id!)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    if (supplierPartInserts.length > 0) {
      await trx
        .insertInto("supplierPart")
        .values(supplierPartInserts)
        .onConflict((oc) =>
          oc.columns(["itemId", "supplierId", "companyId"]).doUpdateSet({
            supplierUnitPrice: (eb) => eb.ref("excluded.supplierUnitPrice"),
            currencyCode: (eb) => eb.ref("excluded.currencyCode"),
            conversionFactor: (eb) => eb.ref("excluded.conversionFactor"),
            supplierUnitOfMeasureCode: (eb) =>
              eb.ref("excluded.supplierUnitOfMeasureCode"),
            updatedBy: "system"
          })
        )
        .execute();
    }

    if (supplierPartUpdates.length > 0) {
      for await (const supplierPartUpdate of supplierPartUpdates) {
        await trx
          .updateTable("supplierPart")
          .set(supplierPartUpdate)
          .where("id", "=", supplierPartUpdate.id!)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    if (itemReplenishmentUpdates.length > 0) {
      for await (const itemReplenishmentUpdate of itemReplenishmentUpdates) {
        await trx
          .updateTable("itemReplenishment")
          .set(itemReplenishmentUpdate)
          .where("itemId", "=", itemReplenishmentUpdate.itemId!)
          .where("companyId", "=", companyId)
          .execute();
      }
    }
  });

  return { success: true };
}
export type Db = Kysely<KyselyDatabase>;
type Enums = Database["public"]["Enums"];

/** The lease header: the term and the payment terms every asset shares. */
export type LeaseRow = {
  id: string;
  leaseId: string;
  status: Enums["leaseStatus"];
  name: string | null;
  supplierId: string;
  locationId: string | null;
  commencementDate: string;
  /** Null is open-ended: every asset is short-term (spec Addendum A10). */
  endDate: string | null;
  invoiceFromDate: string;
  paymentFrequency: Enums["leasePaymentFrequency"];
  paymentTiming: Enums["rentalBillingTiming"];
  annualEscalationPercent: number;
  discountRate: number;
  currencyCode: string;
  commencementJournalId: string | null;
};

/** One leased asset: a separate lease component (ASC 842-10-15-28), with its
 *  own payment, classification inputs, classification and measurement. */
export type LeaseLineRow = {
  id: string;
  description: string;
  serialNumber: string | null;
  locationId: string | null;
  paymentAmount: number;
  fairValue: number | null;
  economicLifeMonths: number | null;
  ownershipTransfers: boolean;
  specializedAsset: boolean;
  purchaseOptionAmount: number | null;
  purchaseOptionReasonablyCertain: boolean;
  status: Enums["leaseLineStatus"];
  lesseeClassification: Enums["lesseeClassification"] | null;
  classificationOverride: Enums["lesseeClassification"] | null;
  initialLiability: number | null;
  rouAssetCost: number | null;
};

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

// Re-read under the caller's company and lock: the id comes from the payload,
// and the permission check proves nothing about it. The lock serializes two
// actions on one lease (a double-clicked Activate, a Modify racing a
// Terminate of one asset). DATE columns are selected as text — the lease
// math works on `YYYY-MM-DD` strings.
export async function lockLease(
  trx: Trx,
  companyId: string,
  id: string
): Promise<LeaseRow> {
  const lease = await trx
    .selectFrom("lease")
    .select([
      "id",
      "leaseId",
      "status",
      "name",
      "supplierId",
      "locationId",
      sql<string>`"commencementDate"::text`.as("commencementDate"),
      sql<string | null>`"endDate"::text`.as("endDate"),
      sql<string>`"invoiceFromDate"::text`.as("invoiceFromDate"),
      "paymentFrequency",
      "paymentTiming",
      "annualEscalationPercent",
      "discountRate",
      "currencyCode",
      "commencementJournalId"
    ])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!lease) throw new NotFoundError("Lease not found");
  return {
    ...lease,
    annualEscalationPercent: Number(lease.annualEscalationPercent),
    discountRate: Number(lease.discountRate)
  };
}

/** The lease's assets in their order. The lease row's lock covers them:
 *  every writer of a line locks the lease first. */
export async function readLines(
  trx: Trx,
  companyId: string,
  leaseId: string
): Promise<LeaseLineRow[]> {
  const rows = await trx
    .selectFrom("leaseLine")
    .select([
      "id",
      "description",
      "serialNumber",
      "locationId",
      "paymentAmount",
      "fairValue",
      "economicLifeMonths",
      "ownershipTransfers",
      "specializedAsset",
      "purchaseOptionAmount",
      "purchaseOptionReasonablyCertain",
      "status",
      "lesseeClassification",
      "classificationOverride",
      "initialLiability",
      "rouAssetCost"
    ])
    .where("leaseId", "=", leaseId)
    .where("companyId", "=", companyId)
    .orderBy("sortOrder")
    .orderBy("createdAt")
    .execute();
  return rows.map((row) => ({
    ...row,
    paymentAmount: Number(row.paymentAmount),
    fairValue: num(row.fairValue),
    economicLifeMonths: num(row.economicLifeMonths),
    purchaseOptionAmount: num(row.purchaseOptionAmount),
    initialLiability: num(row.initialLiability),
    rouAssetCost: num(row.rouAssetCost)
  }));
}

/** The one asset of the lease the payload names, or a 404. */
export function findLine(lines: LeaseLineRow[], id: string): LeaseLineRow {
  const line = lines.find((row) => row.id === id);
  if (!line) throw new NotFoundError("Leased asset not found");
  return line;
}

/** The classification of an asset past Draft. Activation stores one for
 *  every asset, so a missing one is a broken row, not a default. */
export function classificationOf(
  line: Pick<LeaseLineRow, "description" | "lesseeClassification">
): Enums["lesseeClassification"] {
  if (!line.lesseeClassification) {
    throw new Error(`${line.description} has no lessee classification`);
  }
  return line.lesseeClassification;
}

export type LeasePaymentRow = {
  id: string;
  leaseLineId: string;
  paymentType: Enums["leasePaymentType"];
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amount: number;
  status: Enums["leasePaymentStatus"];
};

export async function readPayments(
  trx: Trx,
  companyId: string,
  leaseId: string
): Promise<LeasePaymentRow[]> {
  const rows = await trx
    .selectFrom("leasePayment")
    .select([
      "id",
      "leaseLineId",
      "paymentType",
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd"),
      sql<string>`"dueDate"::text`.as("dueDate"),
      "amount",
      "status"
    ])
    .where("leaseId", "=", leaseId)
    .where("companyId", "=", companyId)
    .orderBy("dueDate")
    .execute();
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

export type LesseeAccounting = {
  // Provisional before the company's accounting cutover, Posted after it.
  postingStatus: AutomaticJournalStatus;
  accounts: LesseeAccounts;
  // active dimensions for the company group, entityType → dimension id
  dimensionMap: Map<string, string>;
};

export const LESSEE_ACCOUNTS_REQUIRED =
  "Set the lease (lessee) accounts in Accounting → Default Accounts before activating a lease";

const LESSEE_DEFAULT_COLUMNS = [
  "rightOfUseAssetAccount",
  "accumulatedRightOfUseAmortizationAccount",
  "leaseLiabilityAccount",
  "operatingLeaseExpenseAccount",
  "rightOfUseAmortizationExpenseAccount",
  "leaseInterestExpenseAccount",
  "assetGainOnDisposalAccount",
  "assetLossOnDisposalAccount"
] as const;

/** The lessee lease accounts with their classes, and the dimensions. Every
 *  account is required — the migration seeds and maps them for every
 *  company — because the schedule rows name them and are never re-pointed. */
export async function loadLesseeAccounting(
  trx: Trx,
  args: { companyId: string; companyGroupId: string | null }
): Promise<LesseeAccounting> {
  const { companyId } = args;
  const postingStatus = await journalPostingStatus(trx, companyId);
  const defaults = await trx
    .selectFrom("accountDefault")
    .select([...LESSEE_DEFAULT_COLUMNS])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) throw new Error("Error getting account defaults");
  const ids = LESSEE_DEFAULT_COLUMNS.map((column) => defaults[column]);
  if (ids.some((id) => !id)) {
    throw new InvalidInputError(LESSEE_ACCOUNTS_REQUIRED);
  }

  // `account` is group-scoped; the ids came from this company's defaults.
  const accounts = await trx
    .selectFrom("account")
    .select(["id", "class"])
    .where("id", "in", ids as string[])
    .execute();
  const classOf = (id: string): AccountClass => {
    const account = accounts.find((row) => row.id === id);
    if (!account?.class) {
      throw new InvalidInputError(
        `Account ${id} in the lease account defaults has no class. Set its class in Accounting → Chart of Accounts.`
      );
    }
    return account.class;
  };
  const account = (column: (typeof LESSEE_DEFAULT_COLUMNS)[number]) => {
    const id = defaults[column] as string;
    return { id, class: classOf(id) };
  };

  // Dimensions are configured per company group; a company outside one
  // tags nothing.
  const dimensions =
    args.companyGroupId === null
      ? []
      : await trx
          .selectFrom("dimension")
          .select(["id", "entityType"])
          .where("companyGroupId", "=", args.companyGroupId)
          .where("active", "=", true)
          .where("entityType", "in", ["Supplier", "Location"])
          .execute();

  return {
    postingStatus,
    accounts: {
      rightOfUseAsset: account("rightOfUseAssetAccount"),
      accumulatedRightOfUseAmortization: account(
        "accumulatedRightOfUseAmortizationAccount"
      ),
      leaseLiability: account("leaseLiabilityAccount"),
      operatingLeaseExpense: account("operatingLeaseExpenseAccount"),
      rightOfUseAmortizationExpense: account(
        "rightOfUseAmortizationExpenseAccount"
      ),
      leaseInterestExpense: account("leaseInterestExpenseAccount"),
      gain: account("assetGainOnDisposalAccount"),
      loss: account("assetLossOnDisposalAccount")
    },
    dimensionMap: new Map(
      dimensions.map((dimension) => [dimension.entityType, dimension.id])
    )
  };
}

/** One asset's balanced journal lines. */
export type AssetLines = {
  leaseLineId: string;
  /** The asset's location, else the lease's: the Location dimension. */
  locationId: string | null;
  lines: PostingLine[];
};

/** One 'Lease' journal from each asset's balanced lines: Provisional before
 *  the accounting cutover (no period), Posted after it in the period of its
 *  date (the next open period when that one is Locked or Closed). Every line
 *  carries the lease as its document and its asset line as the document
 *  line, tagged with Supplier and the asset's Location. Null when no asset
 *  has a line to post. */
export async function postLesseeJournal(
  trx: Trx,
  args: {
    accounting: LesseeAccounting;
    companyId: string;
    userId: string;
    postingDate: string;
    description: string;
    assets: AssetLines[];
    lease: Pick<LeaseRow, "id" | "supplierId">;
  }
): Promise<string | null> {
  const { accounting, companyId, userId } = args;
  const lines = args.assets.flatMap((asset) =>
    asset.lines.map((line) => ({ ...line, asset }))
  );
  if (lines.length === 0) return null;

  const period =
    accounting.postingStatus === "Posted"
      ? await resolveAccountingPeriod(
          trx,
          companyId,
          args.postingDate,
          "historical-with-shift"
        )
      : null;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId: period?.id ?? null,
    status: accounting.postingStatus,
    description: args.description,
    postingDate: period?.postingDate ?? args.postingDate,
    userId,
    sourceType: "Lease"
  });

  const journalLineReference = nanoid();
  const journalLineIds = await allocateJournalLineIds(trx, lines.length);
  await trx
    .insertInto("journalLine")
    .values(
      lines.map((line, index) => ({
        id: journalLineIds[index],
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: round(line.amount),
        quantity: 1,
        documentType: "Lease" as const,
        documentId: args.lease.id,
        documentLineReference: line.asset.leaseLineId,
        journalLineReference,
        companyId
      }))
    )
    .execute();

  const dimensionInserts = buildJournalLineDimensionInserts({
    journalLineIds: journalLineIds as string[],
    meta: lines.map((line) => ({
      supplierId: args.lease.supplierId,
      locationId: line.asset.locationId
    })),
    dimensionMap: accounting.dimensionMap,
    companyId
  });
  if (dimensionInserts.length > 0) {
    await trx
      .insertInto("journalLineDimension")
      .values(dimensionInserts)
      .execute();
  }

  return journalId;
}

/** One asset's schedule from lease month `fromMonth` on: line `i` is lease
 *  month `fromMonth + i` of the lease that commenced on `commencementDate`. */
export type AssetSchedule = {
  leaseLineId: string;
  commencementDate: string;
  fromMonth: number;
  lines: LesseeScheduleLine[];
  classification: "Operating" | "Finance";
};

/**
 * Writes each asset's schedule lines, and two `revenueRecognitionSchedule`
 * rows per line (Interest and Amortization, each on its own accounts — spec
 * §3) that the lease run posts. A row with no amount is not written. Rows
 * dated before `postedBefore` are written Posted with no journal, and their
 * lines with `postedAt`: their entries are in an opening balance, as the
 * enable's step 5 does for rows before the cutover.
 */
export async function writeSchedules(
  trx: Trx,
  args: {
    leaseId: string;
    schedules: AssetSchedule[];
    accounts: LesseeAccounts;
    companyId: string;
    userId: string;
    postedBefore?: string;
  }
): Promise<void> {
  const { leaseId, companyId, userId } = args;
  const lines = args.schedules.flatMap((schedule) =>
    schedule.lines.map((line, index) => ({ schedule, line, index }))
  );
  if (lines.length === 0) return;
  const postedAt = datetime.timestamp();

  const inserted = await trx
    .insertInto("leaseScheduleLine")
    .values(
      lines.map(({ schedule, line }) => ({
        leaseId,
        leaseLineId: schedule.leaseLineId,
        periodDate: line.periodDate,
        openingLiability: line.openingLiability,
        paymentAmount: line.paymentAmount,
        interestAmount: line.interestAmount,
        principalAmount: line.principalAmount,
        closingLiability: line.closingLiability,
        leaseCost: line.leaseCost,
        rouAmortization: line.rouAmortization,
        closingRouAsset: line.closingRouAsset,
        // An opening-balance month is on the books like a run-posted one;
        // the `leases` view and the lease page read posted state from here.
        postedAt:
          args.postedBefore !== undefined && line.periodDate < args.postedBefore
            ? postedAt
            : null,
        companyId,
        createdBy: userId
      }))
    )
    .returning([
      "id",
      "leaseLineId",
      sql<string>`"periodDate"::text`.as("periodDate")
    ])
    .execute();
  const key = (leaseLineId: string, periodDate: string) =>
    `${leaseLineId}|${periodDate}`;
  const idByKey = new Map(
    inserted.map((row) => [key(row.leaseLineId, row.periodDate), row.id])
  );

  const rows = lines.flatMap(({ schedule, line, index }) => {
    const leaseScheduleLineId = idByKey.get(
      key(schedule.leaseLineId, line.periodDate)
    );
    if (!leaseScheduleLineId) {
      throw new Error(`Schedule line ${line.periodDate} was not written`);
    }
    const accounts = scheduleRowAccounts(
      schedule.classification,
      args.accounts
    );
    const posted =
      args.postedBefore !== undefined && line.periodDate < args.postedBefore;
    const base = {
      status: posted ? ("Posted" as const) : ("Planned" as const),
      leaseId,
      leaseScheduleLineId,
      periodStart: addMonths(
        schedule.commencementDate,
        schedule.fromMonth + index
      ),
      periodEnd: line.periodDate,
      scheduledDate: line.periodDate,
      companyId,
      createdBy: userId
    };
    return [
      {
        ...base,
        type: "Interest" as const,
        amount: line.interestAmount,
        ...accounts.interest
      },
      {
        ...base,
        type: "Amortization" as const,
        amount: line.rouAmortization,
        ...accounts.amortization
      }
    ].filter((row) => row.amount !== 0);
  });
  if (rows.length > 0) {
    await trx.insertInto("revenueRecognitionSchedule").values(rows).execute();
  }
}

/** Deletes the schedule lines of `leaseLineIds` dated on or after
 *  `startDate`; their Planned run rows cascade with them. */
export async function deleteSchedulesFrom(
  trx: Trx,
  args: { companyId: string; leaseLineIds: string[]; startDate: string }
): Promise<void> {
  if (args.leaseLineIds.length === 0) return;
  await trx
    .deleteFrom("leaseScheduleLine")
    .where("leaseLineId", "in", args.leaseLineIds)
    .where("companyId", "=", args.companyId)
    .where("periodDate", ">=", args.startDate)
    .execute();
}

/** The run holding a schedule row of the lease from `fromDate` on, or null.
 *  A row a run holds cannot be rewritten until the run is recalculated or
 *  deleted. */
export async function heldByRun(
  trx: Trx,
  args: {
    companyId: string;
    leaseId: string;
    fromDate?: string;
    /** Only the rows of these assets; every asset when absent. */
    leaseLineIds?: string[];
  }
): Promise<string | null> {
  let query = trx
    .selectFrom("revenueRecognitionSchedule as s")
    .innerJoin("revenueRecognitionRunLine as l", (join) =>
      join
        .onRef("l.id", "=", "s.runLineId")
        .onRef("l.companyId", "=", "s.companyId")
    )
    .innerJoin("revenueRecognitionRun as r", (join) =>
      join
        .onRef("r.id", "=", "l.runId")
        .onRef("r.companyId", "=", "l.companyId")
    )
    .select("r.runId")
    .where("s.companyId", "=", args.companyId)
    .where("s.leaseId", "=", args.leaseId)
    .where("s.status", "=", "Planned");
  if (args.fromDate) {
    query = query.where("s.scheduledDate", ">=", args.fromDate);
  }
  if (args.leaseLineIds) {
    const ids = args.leaseLineIds;
    if (ids.length === 0) return null;
    query = query.where("s.leaseScheduleLineId", "in", (eb) =>
      eb
        .selectFrom("leaseScheduleLine")
        .select("id")
        .where("leaseLineId", "in", ids)
        .where("companyId", "=", args.companyId)
    );
  }
  const row = await query.executeTakeFirst();
  return row?.runId ?? null;
}

/** Voids a lease journal with a negated copy dated today (the next open
 *  period when today's is Locked or Closed), keeping its documents and
 *  dimensions. */
export async function voidLeaseJournal(
  trx: Trx,
  args: {
    journalId: string;
    postingStatus: AutomaticJournalStatus;
    companyId: string;
    userId: string;
    today: string;
  }
): Promise<string> {
  const { companyId } = args;
  const original = await trx
    .selectFrom("journal")
    .select(["id", "sourceType", "description"])
    .where("id", "=", args.journalId)
    .where("companyId", "=", companyId)
    .forShare()
    .executeTakeFirst();
  if (!original || original.sourceType !== "Lease") {
    throw new Error("The lease journal has invalid provenance");
  }
  const originalLines = await trx
    .selectFrom("journalLine")
    .selectAll()
    .where("journalId", "=", original.id)
    .where("companyId", "=", companyId)
    .orderBy("id")
    .execute();
  return insertNegatedJournal(trx, {
    companyId,
    userId: args.userId,
    originalLines,
    description: `VOID ${original.description ?? "Lease"}`,
    sourceType: "Lease",
    postingStatus: args.postingStatus,
    date: args.today,
    periodMode: "historical-with-shift",
    postedAt: datetime.timestamp()
  });
}

export type Scope = { db: Db; companyId: string; userId: string };

/** The payments' whole-month points from lease month `fromMonth` (0 at
 *  commencement). Counted from the commencement, never from a later date: a
 *  lease from the 29th–31st has clamped months that a later start would
 *  not line up with. */
export function paymentPoints(
  payments: Pick<
    LeasePaymentRow,
    "periodStart" | "periodEnd" | "dueDate" | "paymentType" | "amount"
  >[],
  commencementDate: string,
  timing: LeaseRow["paymentTiming"],
  fromMonth = 0
): LeasePaymentPoint[] {
  return payments.map((payment) => ({
    monthIndex:
      paymentMonthIndex(payment, commencementDate, timing) - fromMonth,
    amount: payment.amount
  }));
}

/** Straight-line ROU amortization runs over what is left of the useful life
 *  when the lessee will own the asset, else over the `months` the schedule
 *  covers. `elapsedMonths` are the lease months before the schedule starts
 *  (0 at commencement). */
export function amortizationMonths(
  line: Pick<
    LeaseLineRow,
    | "ownershipTransfers"
    | "purchaseOptionReasonablyCertain"
    | "economicLifeMonths"
  >,
  months: number,
  elapsedMonths = 0
): number {
  const remainingLife = (line.economicLifeMonths ?? 0) - elapsedMonths;
  return (line.ownershipTransfers || line.purchaseOptionReasonablyCertain) &&
    remainingLife > months
    ? remainingLife
    : months;
}

type Thresholds = { majorPartPercent: number; substantiallyAllPercent: number };

export type MeasuredAsset = {
  line: LeaseLineRow;
  liability: number;
  classification: "Operating" | "Finance" | "Short-Term";
  classificationInputs: Json;
};

/** One asset's liability (the PV of its payment rows) and classification
 *  over the term from lease month `fromMonth` (0 at commencement) to
 *  `endDate`. An override wins. */
export function measureAsset(args: {
  line: LeaseLineRow;
  payments: Pick<
    LeasePaymentRow,
    "periodStart" | "periodEnd" | "dueDate" | "paymentType" | "amount"
  >[];
  fromMonth?: number;
  endDate: string;
  lease: Pick<LeaseRow, "commencementDate" | "paymentTiming" | "discountRate">;
  thresholds: Thresholds;
  shortTermExpedient: boolean;
}): MeasuredAsset {
  const { line, lease, thresholds } = args;
  const { liability, termMonths, ...result } = measureLesseeAsset({
    commencementDate: lease.commencementDate,
    endDate: args.endDate,
    timing: lease.paymentTiming,
    discountRate: lease.discountRate,
    payments: args.payments,
    fromMonth: args.fromMonth,
    inputs: line,
    shortTermExpedient: args.shortTermExpedient,
    thresholds
  });
  return {
    line,
    liability,
    classification: line.classificationOverride ?? result.classification,
    classificationInputs: {
      ...result,
      termMonths,
      pvPayments: liability,
      discountRate: lease.discountRate,
      thresholds,
      override: line.classificationOverride
    }
  };
}

export async function readThresholds(
  trx: Trx,
  companyId: string
): Promise<Thresholds & { shortTermExpedient: boolean }> {
  const settings = await trx
    .selectFrom("companySettings")
    .select([
      "leaseMajorPartThresholdPercent",
      "leaseSubstantiallyAllThresholdPercent",
      "leaseShortTermExpedient"
    ])
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  return {
    majorPartPercent: Number(settings.leaseMajorPartThresholdPercent),
    substantiallyAllPercent: Number(
      settings.leaseSubstantiallyAllThresholdPercent
    ),
    shortTermExpedient: settings.leaseShortTermExpedient
  };
}

/** Writes each asset's measurement in one statement. Columns left out of a
 *  row keep their value. */
export async function updateLineMeasurements(
  trx: Trx,
  args: {
    companyId: string;
    userId: string;
    rows: {
      id: string;
      lesseeClassification: "Operating" | "Finance" | "Short-Term";
      classificationInputs?: Json;
      initialLiability?: number | null;
      rouAssetCost?: number | null;
      paymentAmount?: number;
    }[];
  }
): Promise<void> {
  if (args.rows.length === 0) return;
  const values = sql.join(
    args.rows.map(
      (row) =>
        sql`(${row.id}, ${row.lesseeClassification}, ${
          row.classificationInputs === undefined
            ? null
            : JSON.stringify(row.classificationInputs)
        }, ${row.classificationInputs !== undefined}, ${
          row.initialLiability ?? null
        }, ${row.initialLiability !== undefined}, ${row.rouAssetCost ?? null}, ${
          row.rouAssetCost !== undefined
        }, ${row.paymentAmount ?? null}, ${row.paymentAmount !== undefined})`
    )
  );
  await sql`
    UPDATE "leaseLine" AS l SET
      "lesseeClassification" = v.classification::"lesseeClassification",
      "classificationInputs" = CASE WHEN v."setInputs"::boolean
        THEN v.inputs::jsonb ELSE l."classificationInputs" END,
      "initialLiability" = CASE WHEN v."setInitial"::boolean
        THEN v.initial::numeric ELSE l."initialLiability" END,
      "initialRouAsset" = CASE WHEN v."setInitial"::boolean
        THEN v.initial::numeric ELSE l."initialRouAsset" END,
      "rouAssetCost" = CASE WHEN v."setCost"::boolean
        THEN v.cost::numeric ELSE l."rouAssetCost" END,
      "paymentAmount" = CASE WHEN v."setPayment"::boolean
        THEN v.payment::numeric ELSE l."paymentAmount" END,
      "updatedBy" = ${args.userId},
      "updatedAt" = ${datetime.timestamp()}
    FROM (VALUES ${values}) AS v(
      id, classification, inputs, "setInputs", initial, "setInitial",
      cost, "setCost", payment, "setPayment"
    )
    WHERE l."id" = v.id AND l."companyId" = ${args.companyId}
  `.execute(trx);
}
export type LeaseAccount = { id: string; class: AccountClass };

export type LesseeAccounts = {
  rightOfUseAsset: LeaseAccount;
  accumulatedRightOfUseAmortization: LeaseAccount;
  leaseLiability: LeaseAccount;
  operatingLeaseExpense: LeaseAccount;
  rightOfUseAmortizationExpense: LeaseAccount;
  leaseInterestExpense: LeaseAccount;
  gain: LeaseAccount;
  loss: LeaseAccount;
};

/** A journal line with its amount in the account's natural balance. */
export type PostingLine = {
  accountId: string;
  description: string;
  amount: number;
};

type Leg = {
  side: "debit" | "credit";
  account: LeaseAccount;
  description: string;
  amount: number;
};

/** Legs → natural-balance-signed journal lines, dropping zero legs and
 *  refusing an unbalanced set. A negative leg amount flips its side. */
export function toPostingLines(legs: Leg[], label: string): PostingLine[] {
  let debits = 0;
  let credits = 0;
  const lines: PostingLine[] = [];
  for (const leg of legs) {
    const amount = round(leg.amount);
    if (amount === 0) continue;
    const side =
      amount > 0 ? leg.side : leg.side === "debit" ? "credit" : "debit";
    const value = Math.abs(amount);
    if (side === "debit") debits += value;
    else credits += value;
    lines.push({
      accountId: leg.account.id,
      description: leg.description,
      amount:
        side === "debit"
          ? toStoredAmount(value, 0, leg.account.class)
          : toStoredAmount(0, value, leg.account.class)
    });
  }
  assertBalanced(round(debits), round(credits), EPSILON, label);
  return lines;
}

/** The accounts of the roles a leg names. `fixedAsset` and
 *  `retainedEarnings` are not lease defaults: a purchase passes the asset
 *  class's account and an opening balance the retained earnings default. */
type LegAccounts = Partial<Record<LesseeLegAccount, LeaseAccount>>;

/** The shared legs posted to the company's accounts. A role with no account
 *  is a programming error, never a user's. */
function postLegs(
  legs: LesseeLeg[],
  accounts: LesseeAccounts,
  extra: LegAccounts,
  label: string
): PostingLine[] {
  const resolved: LegAccounts = { ...accounts, ...extra };
  return toPostingLines(
    normalizeLesseeLegs(legs).map((leg) => {
      const account = resolved[leg.account];
      if (!account) {
        throw new Error(`${label}: no account for ${leg.account}`);
      }
      return { ...leg, account };
    }),
    label
  );
}

/** Commencement: Dr ROU asset / Cr Lease liability, both at the PV. */
export function commencementLines(args: {
  liability: number;
  accounts: LesseeAccounts;
}): PostingLine[] {
  return postLegs(
    lesseeCommencementLegs({ liability: args.liability }),
    args.accounts,
    {},
    "Lease commencement journal"
  );
}

/** Opening balance of a lease that commenced before the accounting cutover
 *  (spec Q8): the balances its schedule reaches on the as-of date, with the
 *  difference — the lease cost of the months before it, already in the
 *  opening equity — to retained earnings.
 *
 *   Dr ROU asset                       cost
 *       Cr Accumulated ROU amortization        amortization before the date
 *       Cr Lease liability                     carrying liability on the date
 *       Cr / Dr Retained earnings              the difference
 */
export function openingBalanceLines(args: {
  rouAssetCost: number;
  accumulated: number;
  carryingLiability: number;
  retainedEarnings: LeaseAccount;
  accounts: LesseeAccounts;
}): PostingLine[] {
  return postLegs(
    lesseeOpeningBalanceLegs(args),
    args.accounts,
    { retainedEarnings: args.retainedEarnings },
    "Lease opening balance journal"
  );
}

/** Remeasurement (Modify): the ROU asset moves by the liability change; a
 *  decrease larger than the ROU asset leaves it at zero and the rest is a
 *  gain. `adjustment` = new liability − carrying liability. */
export function remeasurementLines(args: {
  adjustment: number;
  gain: number;
  accounts: LesseeAccounts;
}): PostingLine[] {
  return postLegs(
    lesseeRemeasurementLegs(args),
    args.accounts,
    {},
    "Lease remeasurement journal"
  );
}

/** Early termination (ASC 842-20-40-1): the liability and the ROU asset
 *  leave the books, and the difference is a gain or loss. A penalty stays in
 *  the liability as a payment row the next invoice settles.
 *
 *   Dr Lease liability                 carrying − penalty
 *   Dr Accumulated ROU amortization    accumulated
 *       Cr ROU asset                           cost
 *       Cr / Dr gain or loss                   the difference
 */
export function terminationLines(args: {
  carryingLiability: number;
  penalty: number;
  rouAssetCost: number;
  accumulated: number;
  accounts: LesseeAccounts;
}): { lines: PostingLine[]; gainLoss: number } {
  const { legs, gainLoss } = lesseeTerminationLegs(args);
  return {
    lines: postLegs(legs, args.accounts, {}, "Lease termination journal"),
    gainLoss
  };
}

/** Purchase option exercise (ASC 842-20-40-2): not a termination. The ROU
 *  asset moves into PP&E at its net book value, adjusted by the price less
 *  the carrying liability; the price stays in the liability as a payment row
 *  the next invoice settles. A price that leaves the asset a negative cost
 *  is refused as a 400.
 *
 *   Dr Fixed asset class asset account  net ROU + price − carrying liability
 *   Dr Accumulated ROU amortization     accumulated
 *   Dr Lease liability                  carrying liability
 *       Cr ROU asset                            cost
 *       Cr Lease liability                      price
 */
export function purchaseLines(args: {
  carryingLiability: number;
  price: number;
  rouAssetCost: number;
  accumulated: number;
  assetAccount: LeaseAccount;
  accounts: LesseeAccounts;
}): { lines: PostingLine[]; assetCost: number } {
  const { legs, assetCost } = lesseePurchaseLegs(args);
  if (assetCost < 0) {
    throw new InvalidInputError(
      "The purchased asset would have a negative cost; check the purchase price"
    );
  }
  return {
    lines: postLegs(
      legs,
      args.accounts,
      { fixedAsset: args.assetAccount },
      "Lease purchase journal"
    ),
    assetCost
  };
}

/** The accounts of one month's two schedule rows (spec §3): an operating
 *  lease books both to the lease cost; a finance lease books interest and
 *  amortization separately. */
export function scheduleRowAccounts(
  classification: "Operating" | "Finance",
  accounts: LesseeAccounts
): {
  interest: { debitAccountId: string; creditAccountId: string };
  amortization: { debitAccountId: string; creditAccountId: string };
} {
  return {
    interest: {
      debitAccountId:
        classification === "Operating"
          ? accounts.operatingLeaseExpense.id
          : accounts.leaseInterestExpense.id,
      creditAccountId: accounts.leaseLiability.id
    },
    amortization: {
      debitAccountId:
        classification === "Operating"
          ? accounts.operatingLeaseExpense.id
          : accounts.rightOfUseAmortizationExpense.id,
      creditAccountId: accounts.accumulatedRightOfUseAmortization.id
    }
  };
}
type Classification = "Operating" | "Finance" | "Short-Term";

/** The lease month that starts on `startDate`, or null when `startDate` is
 *  not a lease-month boundary (the commencement day of a month). */
export function leaseMonthStarting(
  commencementDate: string,
  startDate: string
): number | null {
  if (startDate < commencementDate) return null;
  const month = leaseMonthsAt(commencementDate, startDate);
  return addMonths(commencementDate, month) === startDate ? month : null;
}

/** The payment period `startDate` falls inside (after its first day), or
 *  null. A change takes effect where a payment period starts: the period
 *  before it is paid in full and the one after it is cut from the new terms. */
export function straddledPeriod(
  rows: { paymentType: string; periodStart: string; periodEnd: string }[],
  startDate: string
): { periodStart: string; periodEnd: string } | null {
  return (
    rows.find(
      (row) =>
        row.paymentType === "Rent" &&
        row.periodStart < startDate &&
        row.periodEnd >= startDate
    ) ?? null
  );
}

/**
 * The checks every lifecycle action shares, and each asset's carrying
 * amounts at `startDate` (the first day after the change takes effect).
 * Refuses a date that is not a lease-month boundary or falls inside a
 * payment period, a month before it whose run rows are not Posted, a month
 * on or after it that is already Posted, a later row a run holds, and an
 * Invoiced payment due on or after `startDate`.
 */
async function prepare(
  trx: Trx,
  args: {
    companyId: string;
    lease: LeaseRow;
    lines: LeaseLineRow[];
    startDate: string;
    label: string;
  }
): Promise<Map<string, LesseeCarrying>> {
  const { companyId, lease, lines, startDate, label } = args;
  if (lease.status !== "Active") {
    throw new InvalidInputError(
      `The lease is ${lease.status}; only an Active lease can be ${label}`
    );
  }
  const ended = lines.find((line) => line.status !== "Active");
  if (ended) {
    throw new InvalidInputError(
      `${ended.description} is ${ended.status}; only an active asset can be ${label}`
    );
  }
  if (leaseMonthStarting(lease.commencementDate, startDate) === null) {
    throw new InvalidInputError(
      `The date must fall on a lease-month boundary: the month starts on day ${lease.commencementDate.slice(8)} of a month`
    );
  }
  if (lease.endDate && startDate > addDays(lease.endDate, 1)) {
    throw new InvalidInputError("The date is after the end of the lease");
  }

  const lineIds = lines.map((line) => line.id);
  const payments = (await readPayments(trx, companyId, lease.id)).filter(
    (payment) => lineIds.includes(payment.leaseLineId)
  );
  const straddled = straddledPeriod(payments, startDate);
  if (straddled) {
    throw new InvalidInputError(
      `The date falls inside the payment period ${straddled.periodStart} to ${straddled.periodEnd}; choose a date where a payment period starts or ends`
    );
  }
  const invoiced = payments.find(
    (payment) => payment.status === "Invoiced" && payment.dueDate >= startDate
  );
  if (invoiced) {
    throw new InvalidInputError(
      `The payment due ${invoiced.dueDate} is already invoiced; choose a later date or delete the invoice`
    );
  }
  // A Skipped row was paid outside Carbon. One on or after the date would
  // outlive the change: it is neither cut again nor ever invoiced. Checked
  // after the posted months, whose message names the date to choose.
  const refuseSkipped = () => {
    const skipped = payments.find(
      (payment) => payment.status === "Skipped" && payment.dueDate >= startDate
    );
    if (skipped) {
      throw new InvalidInputError(
        `The payment due ${skipped.dueDate} is Skipped (paid outside Carbon); choose a date after it`
      );
    }
  };

  const carrying = new Map<string, LesseeCarrying>(
    lines.map((line) => [
      line.id,
      { liability: 0, accumulated: 0, rouAsset: 0 }
    ])
  );
  const recognized = lines.filter(
    (line) => line.lesseeClassification !== "Short-Term"
  );
  if (recognized.length === 0) {
    refuseSkipped();
    return carrying;
  }
  const recognizedIds = recognized.map((line) => line.id);

  const unposted = await trx
    .selectFrom("revenueRecognitionSchedule as s")
    .innerJoin("leaseScheduleLine as l", (join) =>
      join
        .onRef("l.id", "=", "s.leaseScheduleLineId")
        .onRef("l.companyId", "=", "s.companyId")
    )
    .select(sql<string>`s."scheduledDate"::text`.as("scheduledDate"))
    .where("s.companyId", "=", companyId)
    .where("l.leaseLineId", "in", recognizedIds)
    .where("s.status", "=", "Planned")
    .where("s.scheduledDate", "<", startDate)
    .orderBy("s.scheduledDate")
    .executeTakeFirst();
  if (unposted) {
    throw new InvalidInputError(
      `Post the lease run for ${unposted.scheduledDate} first: the months before the change must be on the books`
    );
  }
  // A month already posted — by a lease run or in an opening balance — is in
  // the GL. Rewriting it from an earlier date would post it twice, or leave
  // its amortization out of the carrying amounts below.
  const postedLater = await trx
    .selectFrom("revenueRecognitionSchedule as s")
    .innerJoin("leaseScheduleLine as l", (join) =>
      join
        .onRef("l.id", "=", "s.leaseScheduleLineId")
        .onRef("l.companyId", "=", "s.companyId")
    )
    .select(sql<string>`s."scheduledDate"::text`.as("scheduledDate"))
    .where("s.companyId", "=", companyId)
    .where("l.leaseLineId", "in", recognizedIds)
    .where("s.status", "=", "Posted")
    .where("s.scheduledDate", ">=", startDate)
    .orderBy("s.scheduledDate", "desc")
    .executeTakeFirst();
  if (postedLater) {
    throw new InvalidInputError(
      `The month ending ${postedLater.scheduledDate} is already posted; choose a date after it`
    );
  }
  const run = await heldByRun(trx, {
    companyId,
    leaseId: lease.id,
    fromDate: startDate,
    leaseLineIds: recognizedIds
  });
  if (run) {
    throw new InvalidInputError(
      `${run} holds this lease's entries from ${startDate}; delete or recalculate it first`
    );
  }
  refuseSkipped();

  const before = await trx
    .selectFrom("leaseScheduleLine")
    .select([
      "leaseLineId",
      "closingLiability",
      "rouAmortization",
      sql<string>`"periodDate"::text`.as("periodDate")
    ])
    .where("leaseLineId", "in", recognizedIds)
    .where("companyId", "=", companyId)
    .where("periodDate", "<", startDate)
    .orderBy("periodDate")
    .execute();
  for (const line of recognized) {
    carrying.set(
      line.id,
      lesseeCarryingAt({
        schedule: before.filter((row) => row.leaseLineId === line.id),
        startDate,
        initialLiability: line.initialLiability,
        rouAssetCost: line.rouAssetCost
      })
    );
  }
  return carrying;
}

/**
 * Deletes the Pending payment rows a change ends, for each asset: rows due
 * after `lastDay`, and its Purchase Option row. Returns, per asset, what the
 * deleted rows due on or before `lastDay` add back to the carrying
 * liability: the schedule already counted them as paid, and now they never
 * will be.
 */
async function deleteEndedPayments(
  trx: Trx,
  args: { companyId: string; leaseLineIds: string[]; lastDay: string }
): Promise<Map<string, number>> {
  const addBack = new Map(args.leaseLineIds.map((id) => [id, 0]));
  if (args.leaseLineIds.length === 0) return addBack;
  const deleted = await trx
    .deleteFrom("leasePayment")
    .where("leaseLineId", "in", args.leaseLineIds)
    .where("companyId", "=", args.companyId)
    .where("status", "=", "Pending")
    .where((eb) =>
      eb.or([
        eb("dueDate", ">", args.lastDay),
        eb("paymentType", "=", "Purchase Option")
      ])
    )
    .returning([
      "leaseLineId",
      "amount",
      sql<string>`"dueDate"::text`.as("dueDate")
    ])
    .execute();
  for (const row of deleted) {
    if (row.dueDate > args.lastDay) continue;
    addBack.set(
      row.leaseLineId,
      round((addBack.get(row.leaseLineId) ?? 0) + Number(row.amount))
    );
  }
  return addBack;
}

type EventRow = {
  leaseLineId: string;
  eventType: "Modification" | "Termination" | "Purchase";
  effectiveDate: string;
  liabilityBefore: number;
  liabilityAfter: number;
  rouAssetBefore: number;
  rouAssetAfter: number;
  gainLoss: number;
  classificationBefore: Classification;
  classificationAfter: Classification;
  fixedAssetId?: string | null;
  journalId: string | null;
  notes?: string | null;
};

async function insertEvents(
  trx: Trx,
  args: { companyId: string; userId: string; leaseId: string; rows: EventRow[] }
) {
  if (args.rows.length === 0) return;
  await trx
    .insertInto("leaseEvent")
    .values(
      args.rows.map((row) => ({
        ...row,
        leaseId: args.leaseId,
        fixedAssetId: row.fixedAssetId ?? null,
        notes: row.notes ?? null,
        companyId: args.companyId,
        createdBy: args.userId
      }))
    )
    .execute();
}

/** Ends one asset and, when it was the last active one, the lease: the lease
 *  takes the last asset's status and end date (spec Addendum A8). */
async function endAsset(
  trx: Trx,
  args: {
    companyId: string;
    userId: string;
    lease: LeaseRow;
    lines: LeaseLineRow[];
    leaseLineId: string;
    status: "Terminated" | "Purchased";
    endDate: string;
    fixedAssetId?: string;
  }
): Promise<void> {
  const { companyId, userId } = args;
  const now = datetime.timestamp();
  await trx
    .updateTable("leaseLine")
    .set({
      status: args.status,
      ...(args.fixedAssetId ? { fixedAssetId: args.fixedAssetId } : {}),
      updatedBy: userId,
      updatedAt: now
    })
    .where("id", "=", args.leaseLineId)
    .where("companyId", "=", companyId)
    .execute();
  const stillActive = args.lines.some(
    (line) => line.id !== args.leaseLineId && line.status === "Active"
  );
  if (stillActive) return;
  await trx
    .updateTable("lease")
    .set({
      status: args.status,
      endDate: args.endDate,
      closedAt: now,
      updatedBy: userId,
      updatedAt: now
    })
    .where("id", "=", args.lease.id)
    .where("companyId", "=", companyId)
    .execute();
}

async function companyAccounting(trx: Trx, companyId: string) {
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  return loadLesseeAccounting(trx, {
    companyId,
    companyGroupId: company.companyGroupId
  });
}

export async function modify(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "modify" }>
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    const lines = (await readLines(trx, companyId, lease.id)).filter(
      (line) => line.status === "Active"
    );
    if (lines.length === 0) {
      throw new InvalidInputError("The lease has no active asset to modify");
    }
    if (!lease.endDate) {
      throw new InvalidInputError(
        "An open-ended lease has no term to modify; terminate it and enter the new terms as a new lease"
      );
    }
    for (const entry of payload.lines) findLine(lines, entry.leaseLineId);
    const startDate = payload.effectiveDate;
    const carrying = await prepare(trx, {
      companyId,
      lease,
      lines,
      startDate,
      label: "modified"
    });
    if (
      lines.some((line) => line.lesseeClassification === "Short-Term") &&
      !isTermWithinTwelveMonths(lease.commencementDate, payload.endDate)
    ) {
      throw new InvalidInputError(
        "A short-term lease cannot run past 12 months; end it and enter the extension as a new lease"
      );
    }
    // `prepare` accepted the date as a lease-month boundary.
    const fromMonth = leaseMonthsAt(lease.commencementDate, startDate);

    // The remaining payments, cut again from the new terms. A Pending
    // purchase option the schedule paid before the date is never paid now:
    // it goes back into the carrying liability.
    const addBack = await deleteEndedPayments(trx, {
      companyId,
      leaseLineIds: lines.map((line) => line.id),
      lastDay: addDays(startDate, -1)
    });
    const decimals = await currencyDecimals(trx, companyId, lease.currencyCode);
    // The payment entered is the one at the effective date; an asset the
    // payload does not name keeps the rate it pays then.
    const paymentAtStart = (line: LeaseLineRow) =>
      payload.lines.find((entry) => entry.leaseLineId === line.id)
        ?.paymentAmount ??
      escalatedLeasePayment(
        line.paymentAmount,
        lease.annualEscalationPercent,
        fromMonth
      );
    const cut = new Map(
      lines.map((line) => [
        line.id,
        cutLeasePaymentRows({
          lease: {
            commencementDate: lease.commencementDate,
            endDate: payload.endDate,
            invoiceFromDate: lease.invoiceFromDate,
            paymentFrequency: payload.paymentFrequency,
            paymentTiming: lease.paymentTiming,
            annualEscalationPercent: payload.annualEscalationPercent
          },
          asset: line,
          decimals,
          from: { month: fromMonth, paymentAtStart: paymentAtStart(line) }
        })
      ])
    );
    const rowsOf = (line: LeaseLineRow) => cut.get(line.id)?.rows ?? [];
    const newRows = lines.flatMap((line) =>
      rowsOf(line).map((row) => ({
        ...row,
        leaseId: lease.id,
        companyId,
        createdBy: userId
      }))
    );
    if (newRows.length > 0) {
      await trx.insertInto("leasePayment").values(newRows).execute();
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("lease")
      .set({
        endDate: payload.endDate,
        discountRate: payload.discountRate,
        paymentFrequency: payload.paymentFrequency,
        annualEscalationPercent: payload.annualEscalationPercent,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", lease.id)
      .where("companyId", "=", companyId)
      .execute();

    // Remeasure each recognized asset over what is left of the lease, and
    // reassess its classification (a Short-Term asset stays Short-Term).
    const { shortTermExpedient: _, ...thresholds } = await readThresholds(
      trx,
      companyId
    );
    const modified = { ...lease, discountRate: payload.discountRate };
    const span = lesseeScheduleSpan(
      lease.commencementDate,
      payload.endDate,
      fromMonth
    );
    const remeasured = lines
      .filter((line) => classificationOf(line) !== "Short-Term")
      .map((line) => {
        const rows = rowsOf(line);
        const points = paymentPoints(
          rows,
          lease.commencementDate,
          lease.paymentTiming,
          fromMonth
        );
        const carried = carrying.get(line.id)!;
        const before = {
          ...carried,
          liability: round(carried.liability + (addBack.get(line.id) ?? 0))
        };
        const result = remeasureLease({
          carryingLiability: before.liability,
          carryingRouAsset: before.rouAsset,
          remainingPayments: points,
          annualRate: payload.discountRate
        });
        const measured = measureAsset({
          line,
          payments: rows,
          fromMonth,
          endDate: payload.endDate,
          lease: modified,
          thresholds,
          shortTermExpedient: false
        });
        const after: "Operating" | "Finance" =
          line.classificationOverride === "Operating" ||
          line.classificationOverride === "Finance"
            ? line.classificationOverride
            : measured.classification === "Finance"
              ? "Finance"
              : "Operating";
        return { line, points, before, result, after, measured };
      });

    let journalId: string | null = null;
    if (remeasured.length > 0) {
      const accounting = await companyAccounting(trx, companyId);
      journalId = await postLesseeJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: startDate,
        description: `Lease Modification ${lease.leaseId}`,
        assets: remeasured.map(
          (asset): AssetLines => ({
            leaseLineId: asset.line.id,
            locationId: asset.line.locationId ?? lease.locationId,
            lines:
              asset.result.adjustment === 0 && asset.result.gain === 0
                ? []
                : remeasurementLines({
                    adjustment: asset.result.adjustment,
                    gain: asset.result.gain,
                    accounts: accounting.accounts
                  })
          })
        ),
        lease
      });

      await deleteSchedulesFrom(trx, {
        companyId,
        leaseLineIds: remeasured.map((asset) => asset.line.id),
        startDate
      });
      await writeSchedules(trx, {
        leaseId: lease.id,
        schedules: remeasured.map(
          (asset): AssetSchedule => ({
            // The months after the change are still the commencement's.
            leaseLineId: asset.line.id,
            commencementDate: lease.commencementDate,
            fromMonth,
            classification: asset.after,
            lines: buildLesseeSchedule({
              openingLiability: asset.result.liability,
              openingRouAsset: asset.result.rouAsset,
              payments: asset.points,
              months: span.months,
              annualRate: payload.discountRate,
              timing: lease.paymentTiming,
              classification: asset.after,
              amortizationMonths: amortizationMonths(
                asset.line,
                span.months,
                fromMonth
              ),
              periodDates: span.periodDates,
              lastMonthShare: span.lastMonthShare
            })
          })
        ),
        accounts: accounting.accounts,
        companyId,
        userId
      });
    }

    await updateLineMeasurements(trx, {
      companyId,
      userId,
      rows: lines.map((line) => {
        const asset = remeasured.find((row) => row.line.id === line.id);
        return {
          id: line.id,
          paymentAmount: cut.get(line.id)!.commencementPayment,
          lesseeClassification: asset?.after ?? "Short-Term",
          ...(asset
            ? {
                classificationInputs: asset.measured.classificationInputs,
                rouAssetCost: round(
                  Number(line.rouAssetCost ?? 0) +
                    asset.result.rouAsset -
                    asset.before.rouAsset
                )
              }
            : {})
        };
      })
    });
    await insertEvents(trx, {
      companyId,
      userId,
      leaseId: lease.id,
      rows: lines.map((line) => {
        const asset = remeasured.find((row) => row.line.id === line.id);
        const before = classificationOf(line);
        return {
          leaseLineId: line.id,
          eventType: "Modification",
          effectiveDate: startDate,
          liabilityBefore: asset?.before.liability ?? 0,
          liabilityAfter: asset?.result.liability ?? 0,
          rouAssetBefore: asset?.before.rouAsset ?? 0,
          rouAssetAfter: asset?.result.rouAsset ?? 0,
          gainLoss: asset?.result.gain ?? 0,
          classificationBefore: before,
          classificationAfter: asset?.after ?? before,
          journalId: asset ? journalId : null,
          notes: payload.notes
        };
      })
    });
    return { id: lease.id };
  });
}

export async function terminate(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "terminate" }>
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    const lines = await readLines(trx, companyId, lease.id);
    const line = findLine(lines, payload.leaseLineId);
    const endOfLease = payload.terminationDate;
    if (endOfLease < lease.commencementDate) {
      throw new InvalidInputError(
        `The termination date cannot be before the commencement date, ${lease.commencementDate}`
      );
    }
    const startDate = addDays(endOfLease, 1);
    const carrying = (
      await prepare(trx, {
        companyId,
        lease,
        lines: [line],
        startDate,
        label: "terminated"
      })
    ).get(line.id)!;
    const before = classificationOf(line);

    // Payments after the date are never owed, nor is the purchase option; a
    // penalty is a final row.
    const addBack =
      (
        await deleteEndedPayments(trx, {
          companyId,
          leaseLineIds: [line.id],
          lastDay: endOfLease
        })
      ).get(line.id) ?? 0;
    if (payload.penaltyAmount > 0) {
      await trx
        .insertInto("leasePayment")
        .values({
          leaseId: lease.id,
          leaseLineId: line.id,
          paymentType: "Termination Penalty",
          periodStart: endOfLease,
          periodEnd: endOfLease,
          dueDate: endOfLease,
          amount: payload.penaltyAmount,
          status: "Pending",
          companyId,
          createdBy: userId
        })
        .execute();
    }

    let journalId: string | null = null;
    let gainLoss = 0;
    const carryingLiability = round(carrying.liability + addBack);
    if (before !== "Short-Term") {
      const accounting = await companyAccounting(trx, companyId);
      const termination = terminationLines({
        carryingLiability,
        penalty: payload.penaltyAmount,
        rouAssetCost: Number(line.rouAssetCost ?? 0),
        accumulated: carrying.accumulated,
        accounts: accounting.accounts
      });
      gainLoss = termination.gainLoss;
      journalId = await postLesseeJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: endOfLease,
        description: `Lease Termination ${lease.leaseId} ${line.description}`,
        assets: [
          {
            leaseLineId: line.id,
            locationId: line.locationId ?? lease.locationId,
            lines: termination.lines
          }
        ],
        lease
      });
      await deleteSchedulesFrom(trx, {
        companyId,
        leaseLineIds: [line.id],
        startDate
      });
    }

    await endAsset(trx, {
      companyId,
      userId,
      lease,
      lines,
      leaseLineId: line.id,
      status: "Terminated",
      endDate: endOfLease
    });
    await insertEvents(trx, {
      companyId,
      userId,
      leaseId: lease.id,
      rows: [
        {
          leaseLineId: line.id,
          eventType: "Termination",
          effectiveDate: endOfLease,
          liabilityBefore: carryingLiability,
          liabilityAfter: payload.penaltyAmount,
          rouAssetBefore: carrying.rouAsset,
          rouAssetAfter: 0,
          gainLoss,
          classificationBefore: before,
          classificationAfter: before,
          journalId,
          notes: payload.notes
        }
      ]
    });
    return { id: lease.id };
  });
}

export async function purchase(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "purchase" }>
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    const lines = await readLines(trx, companyId, lease.id);
    const line = findLine(lines, payload.leaseLineId);
    if (line.lesseeClassification === "Short-Term") {
      throw new InvalidInputError(
        "A short-term asset has no right-of-use asset to purchase; end it and buy the asset on a purchase order"
      );
    }
    if (!lease.endDate) {
      throw new InvalidInputError(
        "An open-ended lease is short-term and has no right-of-use asset to purchase; end it and buy the asset on a purchase order"
      );
    }
    const exerciseDate = payload.exerciseDate;
    if (exerciseDate < lease.commencementDate) {
      throw new InvalidInputError(
        `The exercise date cannot be before the commencement date, ${lease.commencementDate}`
      );
    }
    // An asset whose ownership transfers is the lessee's at the end of the
    // lease with no option to exercise: it is "purchased" then, for nothing.
    const hasOption = (line.purchaseOptionAmount ?? 0) > 0;
    if (!hasOption) {
      if (!line.ownershipTransfers) {
        throw new InvalidInputError(
          `${line.description} has no purchase option`
        );
      }
      if (exerciseDate !== lease.endDate) {
        throw new InvalidInputError(
          `Ownership of ${line.description} passes at the end of the lease; take it on ${lease.endDate}`
        );
      }
      if (!equals(payload.purchasePrice, 0)) {
        throw new InvalidInputError(
          `${line.description} has no purchase option: ownership passes at the end of the lease for nothing, so the price is 0`
        );
      }
    }
    const startDate = addDays(exerciseDate, 1);
    const carrying = (
      await prepare(trx, {
        companyId,
        lease,
        lines: [line],
        startDate,
        label: "purchased"
      })
    ).get(line.id)!;

    const assetClass = await trx
      .selectFrom("fixedAssetClass")
      .select([
        "id",
        "assetAccountId",
        "depreciationMethod",
        "usefulLifeMonths",
        "residualValuePercent",
        "isConstructionInProgress"
      ])
      .where("id", "=", payload.fixedAssetClassId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!assetClass || assetClass.isConstructionInProgress) {
      throw new InvalidInputError("Choose an in-service fixed asset class");
    }
    // `account` is group-scoped; the id came from this company's class.
    const assetAccount = await trx
      .selectFrom("account")
      .select(["id", "class"])
      .where("id", "=", assetClass.assetAccountId)
      .executeTakeFirst();
    if (!assetAccount?.class) {
      throw new InvalidInputError(
        "The fixed asset class's asset account has no class"
      );
    }
    const assetAccountWithClass = {
      id: assetAccount.id,
      class: assetAccount.class
    };

    // An option row already invoiced on or before the exercise date is the
    // price: its invoice settles the liability, so nothing more is payable.
    const invoicedOption = await trx
      .selectFrom("leasePayment")
      .select(["amount"])
      .where("leaseLineId", "=", line.id)
      .where("companyId", "=", companyId)
      .where("paymentType", "=", "Purchase Option")
      .where("status", "=", "Invoiced")
      .where("dueDate", "<=", exerciseDate)
      .executeTakeFirst();
    if (
      invoicedOption &&
      round(Number(invoicedOption.amount)) !== round(payload.purchasePrice)
    ) {
      throw new InvalidInputError(
        `The purchase option is already invoiced at ${Number(invoicedOption.amount)}; exercise it at that price or delete the invoice`
      );
    }

    // Otherwise the option is paid once, on the exercise date; nothing after
    // it. A Pending option row the schedule already counted as paid goes back
    // into the carrying liability before the price replaces it.
    const addBack =
      (
        await deleteEndedPayments(trx, {
          companyId,
          leaseLineIds: [line.id],
          lastDay: exerciseDate
        })
      ).get(line.id) ?? 0;
    if (!invoicedOption && payload.purchasePrice > 0) {
      await trx
        .insertInto("leasePayment")
        .values({
          leaseId: lease.id,
          leaseLineId: line.id,
          paymentType: "Purchase Option",
          periodStart: exerciseDate,
          periodEnd: exerciseDate,
          dueDate: exerciseDate,
          amount: payload.purchasePrice,
          status: "Pending",
          companyId,
          createdBy: userId
        })
        .execute();
    }

    const carryingLiability = round(carrying.liability + addBack);
    const accounting = await companyAccounting(trx, companyId);
    const purchased = purchaseLines({
      carryingLiability,
      price: invoicedOption ? 0 : payload.purchasePrice,
      rouAssetCost: Number(line.rouAssetCost ?? 0),
      accumulated: carrying.accumulated,
      assetAccount: assetAccountWithClass,
      accounts: accounting.accounts
    });
    const journalId = await postLesseeJournal(trx, {
      accounting,
      companyId,
      userId,
      postingDate: exerciseDate,
      description: `Lease Purchase ${lease.leaseId} ${line.description}`,
      assets: [
        {
          leaseLineId: line.id,
          locationId: line.locationId ?? lease.locationId,
          lines: purchased.lines
        }
      ],
      lease
    });

    const asset = await trx
      .insertInto("fixedAsset")
      .values({
        fixedAssetId: await getNextSequence(trx, "fixedAsset", companyId),
        fixedAssetClassId: assetClass.id,
        name: payload.name,
        serialNumber: line.serialNumber,
        locationId: line.locationId ?? lease.locationId,
        quantity: 1,
        acquisitionCost: purchased.assetCost,
        acquisitionDate: exerciseDate,
        depreciationStartDate: exerciseDate,
        depreciationMethod: assetClass.depreciationMethod,
        usefulLifeMonths: assetClass.usefulLifeMonths,
        residualValuePercent: assetClass.residualValuePercent,
        status: "Active",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await deleteSchedulesFrom(trx, {
      companyId,
      leaseLineIds: [line.id],
      startDate
    });
    await endAsset(trx, {
      companyId,
      userId,
      lease,
      lines,
      leaseLineId: line.id,
      status: "Purchased",
      endDate: exerciseDate,
      fixedAssetId: asset.id
    });
    const classification = classificationOf(line);
    await insertEvents(trx, {
      companyId,
      userId,
      leaseId: lease.id,
      rows: [
        {
          leaseLineId: line.id,
          eventType: "Purchase",
          effectiveDate: exerciseDate,
          liabilityBefore: carryingLiability,
          liabilityAfter: invoicedOption ? 0 : payload.purchasePrice,
          rouAssetBefore: carrying.rouAsset,
          rouAssetAfter: 0,
          gainLoss: 0,
          classificationBefore: classification,
          classificationAfter: classification,
          fixedAssetId: asset.id,
          journalId,
          notes: payload.notes
        }
      ]
    });
    return { id: lease.id };
  });
}
/**
 * Payload contract and pure blockers for `post-lease` (a lessee lease, spec
 * `.ai/specs/2026-10-11-lessee-leases.md`). No I/O, so the server function's
 * decisions can be pinned without a database.
 */

// Calendar dates travel as `YYYY-MM-DD` text end to end: a JavaScript Date
// would shift the day by the runtime timezone.
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

// companyId and userId come from the server function's context, not the input.
const scope = { leaseId: z.string().min(1) };

// Terminate and Purchase act on one leased asset (one lease component).
const asset = { leaseLineId: z.string().min(1) };

/** Draft → Active: classify, measure, post the commencement journal and
 *  write the monthly schedule. */
export const activateValidator = z.object({
  type: z.literal("activate"),
  ...scope
});

/** Draft (delete), or Active with nothing invoiced or posted (void the
 *  commencement journal) → Cancelled. */
export const cancelValidator = z.object({
  type: z.literal("cancel"),
  ...scope
});

/** Remeasure every active asset from an effective date: the remaining
 *  payments are cut again from these terms. An active asset the payload does
 *  not name keeps its payment amount. */
export const modifyValidator = z
  .object({
    type: z.literal("modify"),
    ...scope,
    effectiveDate: calendarDate,
    endDate: calendarDate,
    discountRate: z.number().min(0),
    paymentFrequency: z.enum(["Monthly", "Quarterly", "Annual"]),
    annualEscalationPercent: z.number().min(0).default(0),
    lines: z
      .array(
        z.object({
          leaseLineId: z.string().min(1),
          paymentAmount: z.number().min(0)
        })
      )
      .default([]),
    notes: z.string().optional().nullable()
  })
  .refine((value) => value.endDate >= value.effectiveDate, {
    message: "The end date cannot be before the effective date",
    path: ["endDate"]
  });

/** End one asset early: derecognize its ROU asset and its liability. */
export const terminateValidator = z.object({
  type: z.literal("terminate"),
  ...scope,
  ...asset,
  terminationDate: calendarDate,
  penaltyAmount: z.number().min(0).default(0),
  notes: z.string().optional().nullable()
});

/** Exercise one asset's purchase option: its ROU asset becomes a fixed
 *  asset. */
export const purchaseValidator = z.object({
  type: z.literal("purchase"),
  ...scope,
  ...asset,
  exerciseDate: calendarDate,
  purchasePrice: z.number().min(0),
  fixedAssetClassId: z.string().min(1),
  name: z.string().trim().min(1),
  notes: z.string().optional().nullable()
});

export const payloadValidator = z.discriminatedUnion("type", [
  activateValidator,
  cancelValidator,
  modifyValidator,
  terminateValidator,
  purchaseValidator
]);

export type LeasePayload = z.infer<typeof payloadValidator>;

/** Why an open-ended lease cannot activate without the short-term expedient,
 *  and the two ways to fix it. An open-ended lease can be ended on notice, so
 *  its term is short (ASC 842-10-30-1) and carrying it on the balance sheet
 *  one notice period at a time is not supported. */
export const OPEN_ENDED_NEEDS_EXPEDIENT =
  "An open-ended lease is a short-term lease, and this company has the short-term lease expedient turned off. Turn on Short-Term Lease Expedient in Settings → Accounting, or give the lease a fixed duration on its Details step.";

/** Why a Draft lease cannot activate, or null. */
export function activateBlocker(args: {
  status: string;
  assetCount: number;
  /** The descriptions of the assets that have no payment row. */
  assetsWithoutPayments: string[];
  currencyCode: string;
  baseCurrencyCode: string | null;
}): string | null {
  if (args.status !== "Draft") {
    return `The lease is ${args.status}; only a Draft lease can be activated`;
  }
  if (args.assetCount === 0) {
    return "A lease needs at least one asset to activate";
  }
  if (args.assetsWithoutPayments.length > 0) {
    return `Every asset needs a payment row to activate: ${args.assetsWithoutPayments.join(", ")}`;
  }
  if (args.baseCurrencyCode && args.currencyCode !== args.baseCurrencyCode) {
    return "Leases in a foreign currency are not supported yet";
  }
  return null;
}
// The lifecycle of a lessee lease (spec `.ai/specs/2026-10-11-lessee-leases.md`).
// A lease holds one or more assets (`leaseLine`); each asset is a separate
// lease component (ASC 842-10-15-28) with its own classification,
// measurement, payment rows and schedule. Each action is ONE transaction that
// locks the lease row first:
//
//   activate   Draft → Active: classify each asset (ASC 842-10-25-2 or the
//              short-term election), measure its liability at the PV of its
//              payment rows, post ONE commencement journal with lines per
//              asset and write each asset's monthly schedule with its lease
//              run rows. A Short-Term asset posts nothing: its invoices go to
//              lease expense. A lease that started before the accounting
//              cutover posts an opening balance instead (spec Q8).
//   cancel     Active with nothing invoiced, posted by a run, modified or
//              ended → Cancelled, the commencement journal voided. A Draft
//              is deleted instead (the app's delete route).
//   modify     remeasure every active asset from an effective date
//              (lifecycle.ts).
//   terminate  end one asset early, derecognize it, gain or loss
//              (lifecycle.ts).
//   purchase   exercise one asset's purchase option into a fixed asset
//              (lifecycle.ts).
//
// Business-validation failures are 400s (InvalidInputError) with the message
// the app shows; a record the caller's company does not own is a 404.

/** The carrying liability and the accumulated ROU amortization a schedule
 *  reaches before `asOf`: the last line's closing liability (the initial
 *  liability when no line falls before it) and every earlier line's
 *  amortization. */
export function balancesBefore(
  lines: LesseeScheduleLine[],
  asOf: string,
  initialLiability: number
): { carryingLiability: number; accumulated: number } {
  const before = lines.filter((line) => line.periodDate < asOf);
  return {
    carryingLiability: before.at(-1)?.closingLiability ?? initialLiability,
    accumulated: round(
      before.reduce((sum, line) => sum + line.rouAmortization, 0)
    )
  };
}

/** Why a Skipped payment of a capitalized asset cannot activate, or null.
 *  Skipped means paid outside Carbon (before Invoice From): its invoice will
 *  never relieve the lease liability, so it must be one the opening balance
 *  holds. A payment due before the commencement is not in the schedule's
 *  months and is left alone. */
export function skippedPaymentBlocker(
  payment: Pick<
    LeasePaymentRow,
    "periodStart" | "periodEnd" | "dueDate" | "paymentType" | "status"
  >,
  args: {
    description: string;
    lease: Pick<LeaseRow, "commencementDate" | "paymentTiming">;
    periodDates: string[];
    /** The opening balance's as-of date; null when there is none. */
    openingAsOf: string | null;
  }
): string | null {
  if (payment.status !== "Skipped") return null;
  if (payment.dueDate < args.lease.commencementDate) return null;
  if (
    args.openingAsOf &&
    isPaidBeforeOpening(payment, {
      commencementDate: args.lease.commencementDate,
      timing: args.lease.paymentTiming,
      periodDates: args.periodDates,
      asOf: args.openingAsOf
    })
  ) {
    return null;
  }
  const settledBy = args.openingAsOf
    ? `the opening balance on ${args.openingAsOf} still owes it`
    : "only its invoice settles the lease liability";
  return `${args.description}: the payment due ${payment.dueDate} is Skipped (paid outside Carbon), but ${settledBy}. Set Invoice From on or before ${payment.dueDate} so it is invoiced.`;
}

/** The retained earnings account default, with its class: an opening
 *  balance's difference goes there. */
async function retainedEarningsAccount(
  trx: Trx,
  companyId: string
): Promise<LeaseAccount> {
  const row = await trx
    .selectFrom("accountDefault")
    .innerJoin(
      "account",
      "account.id",
      "accountDefault.retainedEarningsAccount"
    )
    .select(["account.id", "account.class"])
    .where("accountDefault.companyId", "=", companyId)
    .executeTakeFirst();
  if (!row?.class) {
    throw new InvalidInputError(
      "Set the retained earnings account in Accounting → Default Accounts before activating a lease that started before accounting was set up"
    );
  }
  return { id: row.id, class: row.class };
}

async function activate(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "activate" }>
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  return db.transaction().execute(async (trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    const lines = await readLines(trx, companyId, lease.id);
    const payments = await readPayments(trx, companyId, lease.id);
    const paymentsOf = (line: LeaseLineRow) =>
      payments.filter((payment) => payment.leaseLineId === line.id);

    const company = await trx
      .selectFrom("company")
      .select(["baseCurrencyCode", "companyGroupId"])
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();
    const blocker = activateBlocker({
      status: lease.status,
      assetCount: lines.length,
      assetsWithoutPayments: lines
        .filter((line) => paymentsOf(line).length === 0)
        .map((line) => line.description),
      currencyCode: lease.currencyCode,
      baseCurrencyCode: company.baseCurrencyCode
    });
    if (blocker) throw new InvalidInputError(blocker);

    const { shortTermExpedient, ...thresholds } = await readThresholds(
      trx,
      companyId
    );
    // An open-ended lease can be ended on notice, so every asset is
    // short-term (spec Addendum A10); it needs the expedient.
    const endDate = lease.endDate;
    if (!endDate && !shortTermExpedient) {
      throw new InvalidInputError(OPEN_ENDED_NEEDS_EXPEDIENT);
    }
    const measured: MeasuredAsset[] = lines.map((line) =>
      endDate
        ? measureAsset({
            line,
            payments: paymentsOf(line),
            endDate,
            lease,
            thresholds,
            shortTermExpedient
          })
        : {
            line,
            liability: 0,
            classification: "Short-Term",
            classificationInputs: { openEnded: true }
          }
    );
    const recognized = measured.filter(
      (
        asset
      ): asset is MeasuredAsset & {
        classification: "Operating" | "Finance";
      } => asset.classification !== "Short-Term"
    );
    const now = datetime.timestamp();

    let commencementJournalId: string | null = null;
    if (endDate && recognized.length > 0) {
      const span = lesseeScheduleSpan(lease.commencementDate, endDate);

      // A lease that started before the accounting cutover opens with the
      // balances its schedules reach on the as-of date (spec Q8) — the
      // cutover, or the first open period after it — and the months before
      // that are already in the opening equity: written Posted with no
      // journal. The payments those months pay are in that balance too, so
      // they are not invoiced.
      const cutoverDate = await readAccountingCutoverDate(trx, companyId);
      const openingAsOf =
        cutoverDate && lease.commencementDate < cutoverDate
          ? (
              await resolveAccountingPeriod(
                trx,
                companyId,
                cutoverDate,
                "historical-with-shift"
              )
            ).postingDate
          : null;
      for (const asset of recognized) {
        for (const payment of paymentsOf(asset.line)) {
          const skipped = skippedPaymentBlocker(payment, {
            description: asset.line.description,
            lease,
            periodDates: span.periodDates,
            openingAsOf
          });
          if (skipped) throw new InvalidInputError(skipped);
        }
      }

      const accounting = await loadLesseeAccounting(trx, {
        companyId,
        companyGroupId: company.companyGroupId
      });
      const schedules: AssetSchedule[] = recognized.map((asset) => ({
        leaseLineId: asset.line.id,
        commencementDate: lease.commencementDate,
        fromMonth: 0,
        classification: asset.classification,
        lines: buildLesseeSchedule({
          openingLiability: asset.liability,
          openingRouAsset: asset.liability,
          payments: paymentPoints(
            paymentsOf(asset.line),
            lease.commencementDate,
            lease.paymentTiming
          ),
          months: span.months,
          annualRate: lease.discountRate,
          timing: lease.paymentTiming,
          classification: asset.classification,
          amortizationMonths: amortizationMonths(asset.line, span.months),
          periodDates: span.periodDates,
          lastMonthShare: span.lastMonthShare
        })
      }));

      const retainedEarnings = openingAsOf
        ? await retainedEarningsAccount(trx, companyId)
        : null;
      const assets: AssetLines[] = recognized.map((asset, index) => ({
        leaseLineId: asset.line.id,
        locationId: asset.line.locationId ?? lease.locationId,
        lines:
          openingAsOf && retainedEarnings
            ? openingBalanceLines({
                ...balancesBefore(
                  schedules[index]!.lines,
                  openingAsOf,
                  asset.liability
                ),
                rouAssetCost: asset.liability,
                retainedEarnings,
                accounts: accounting.accounts
              })
            : commencementLines({
                liability: asset.liability,
                accounts: accounting.accounts
              })
      }));
      commencementJournalId = await postLesseeJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: openingAsOf ?? lease.commencementDate,
        description: `${openingAsOf ? "Lease Opening Balance" : "Lease Commencement"} ${lease.leaseId}`,
        assets,
        lease
      });

      await writeSchedules(trx, {
        leaseId: lease.id,
        schedules,
        accounts: accounting.accounts,
        companyId,
        userId,
        postedBefore: openingAsOf ?? undefined
      });

      const inOpening = openingAsOf
        ? recognized.flatMap((asset) =>
            paymentsOf(asset.line)
              .filter(
                (payment) =>
                  payment.status === "Pending" &&
                  isPaidBeforeOpening(payment, {
                    commencementDate: lease.commencementDate,
                    timing: lease.paymentTiming,
                    periodDates: span.periodDates,
                    asOf: openingAsOf
                  })
              )
              .map((payment) => payment.id)
          )
        : [];
      if (inOpening.length > 0) {
        await trx
          .updateTable("leasePayment")
          .set({ status: "Skipped", updatedBy: userId, updatedAt: now })
          .where("id", "in", inOpening)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    await updateLineMeasurements(trx, {
      companyId,
      userId,
      rows: measured.map((asset) => {
        const isRecognized = asset.classification !== "Short-Term";
        return {
          id: asset.line.id,
          lesseeClassification: asset.classification,
          classificationInputs: asset.classificationInputs,
          initialLiability: isRecognized ? asset.liability : null,
          rouAssetCost: isRecognized ? asset.liability : null
        };
      })
    });
    await trx
      .updateTable("lease")
      .set({
        status: "Active",
        commencementJournalId,
        activatedAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", lease.id)
      .where("companyId", "=", companyId)
      .execute();
    return { id: lease.id };
  });
}

async function cancel(
  scope: Scope,
  payload: Extract<LeasePayload, { type: "cancel" }>
): Promise<{ id: string }> {
  const { db, companyId, userId } = scope;
  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();
  return db.transaction().execute(async (trx: Trx) => {
    const lease = await lockLease(trx, companyId, payload.leaseId);
    if (lease.status === "Draft") {
      throw new InvalidInputError(
        "A Draft lease is deleted, not cancelled; delete it instead"
      );
    }
    if (lease.status !== "Active") {
      throw new InvalidInputError(
        `The lease is ${lease.status}; only an Active lease with nothing invoiced or posted can be cancelled`
      );
    }

    // Cancel undoes the activation and nothing else: once an asset has
    // ended or the lease has changed, its journals and its fixed asset are
    // history that a void would leave half undone.
    const ended = (await readLines(trx, companyId, lease.id)).find(
      (line) => line.status !== "Active"
    );
    if (ended) {
      throw new InvalidInputError(
        `${ended.description} is ${ended.status}; a lease with an ended asset cannot be cancelled. Terminate its other assets instead.`
      );
    }
    const event = await trx
      .selectFrom("leaseEvent")
      .select("eventType")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (event) {
      throw new InvalidInputError(
        `The lease has a ${event.eventType} since it commenced; terminate it instead`
      );
    }
    const invoiced = await trx
      .selectFrom("leasePayment")
      .select("id")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Invoiced")
      .executeTakeFirst();
    if (invoiced) {
      throw new InvalidInputError(
        "A payment of this lease is already invoiced; terminate the lease instead"
      );
    }
    const run = await heldByRun(trx, { companyId, leaseId: lease.id });
    if (run) {
      throw new InvalidInputError(
        `${run} holds this lease's entries; delete or recalculate it first`
      );
    }
    // Rows an opening balance wrote Posted carry no run line; voiding the
    // opening journal takes them back out with the rest.
    const posted = await trx
      .selectFrom("revenueRecognitionSchedule")
      .select("id")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Posted")
      .where("runLineId", "is not", null)
      .executeTakeFirst();
    if (posted) {
      throw new InvalidInputError(
        "A lease run has posted entries of this lease; terminate the lease instead"
      );
    }

    // The only journal an unchanged lease has: its commencement (or opening
    // balance). A Short-Term lease has none.
    if (lease.commencementJournalId) {
      const journal = await trx
        .selectFrom("journal")
        .select(sql<string>`"postingDate"::text`.as("postingDate"))
        .where("id", "=", lease.commencementJournalId)
        .where("companyId", "=", companyId)
        .executeTakeFirstOrThrow();
      const cutoverDate = await readAccountingCutoverDate(trx, companyId);
      if (isBeforeCutover(journal.postingDate, cutoverDate)) {
        throw new InvalidInputError(
          "This lease commenced before accounting was set up; its balances came from the opening journal. Terminate it instead."
        );
      }
      await voidLeaseJournal(trx, {
        journalId: lease.commencementJournalId,
        postingStatus: await journalPostingStatus(trx, companyId),
        companyId,
        userId,
        today
      });
    }

    // The Planned run rows cascade with their schedule lines.
    await trx
      .deleteFrom("leaseScheduleLine")
      .where("leaseId", "=", lease.id)
      .where("companyId", "=", companyId)
      .execute();
    const now = datetime.timestamp();
    await trx
      .updateTable("lease")
      .set({
        status: "Cancelled",
        closedAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", lease.id)
      .where("companyId", "=", companyId)
      .execute();
    return { id: lease.id };
  });
}

export const postLeaseInput = payloadValidator;

export type PostLeaseInput = LeasePayload;

export const postLeaseActionPermission = {
  update: "purchasing"
} satisfies PermissionRule<z.output<typeof postLeaseInput>>;

export async function postLeaseAction(
  ctx: ServiceContext,
  raw: z.input<typeof postLeaseInput>
) {
  const payload = postLeaseInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const scope = { db, companyId, userId };
  switch (payload.type) {
    case "activate":
      return activate(scope, payload);
    case "cancel":
      return cancel(scope, payload);
    case "modify":
      return modify(scope, payload);
    case "terminate":
      return terminate(scope, payload);
    case "purchase":
      return purchase(scope, payload);
  }
}
export type LeaseInvoiceGenerationArgs = {
  companyId: string;
  /** `YYYY-MM-DD` in the company's timezone: rows due on or before it are
   *  billed. */
  asOf: string;
  /** Bill one lease only (the lease page's action). */
  leaseId?: string;
  userId: string;
};

/** One invoice the generator drafted. */
export type DraftedLeaseInvoice = {
  invoiceId: string;
  leaseId: string;
};

export type LeaseInvoiceGenerationFailure = {
  leaseId: string;
  error: string;
};

export type LeaseInvoiceGenerationResult = {
  invoices: DraftedLeaseInvoice[];
  /** `invoices.map(i => i.invoiceId)`. */
  invoiceIds: string[];
  /** Leases whose transaction rolled back; their rows stay Pending. */
  failures: LeaseInvoiceGenerationFailure[];
};

/**
 * Drafts the purchase invoices of every lease with a Pending payment row due
 * on or before `asOf`: one Draft invoice per lease and due date, one Lease
 * line per row (a lease with several assets has a row per asset). Each
 * lease is its own transaction, so one lease's failure never rolls back another's invoice. The billed rows are stamped Invoiced
 * with their invoice line, which is what makes a second call for the same
 * day a no-op; deleting the Draft invoice or voiding a posted one returns
 * them to Pending.
 */
async function createLeaseInvoicesForDuePayments(
  db: Kysely<KyselyDatabase>,
  args: LeaseInvoiceGenerationArgs
): Promise<LeaseInvoiceGenerationResult> {
  const { companyId, asOf, leaseId } = args;

  let dueQuery = db
    .selectFrom("lease")
    .select("lease.id")
    .where("lease.companyId", "=", companyId)
    // An ended lease can still owe a termination penalty, a purchase
    // price, or a row a voided invoice returned to Pending.
    .where("lease.status", "in", BILLABLE_LEASE_STATUSES)
    .where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom("leasePayment as p")
            .select("p.id")
            .whereRef("p.leaseId", "=", "lease.id")
            .whereRef("p.companyId", "=", "lease.companyId")
            .where("p.status", "=", "Pending")
            .where("p.dueDate", "<=", asOf)
        ),
        // An Active open-ended lease's next rows are cut by this run.
        eb.and([
          eb("lease.status", "=", "Active"),
          eb("lease.endDate", "is", null)
        ])
      ])
    )
    .orderBy("lease.leaseId");
  if (leaseId) dueQuery = dueQuery.where("lease.id", "=", leaseId);
  const leases = await dueQuery.execute();

  const invoices: DraftedLeaseInvoice[] = [];
  const failures: LeaseInvoiceGenerationFailure[] = [];
  for (const lease of leases) {
    try {
      const drafted = await db
        .transaction()
        .execute((trx) => draftLeaseInvoices(trx, args, lease.id));
      invoices.push(...drafted);
    } catch (error) {
      failures.push({
        leaseId: lease.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return {
    invoices,
    invoiceIds: invoices.map((i) => i.invoiceId),
    failures
  };
}

async function draftLeaseInvoices(
  trx: KyselyTx,
  args: LeaseInvoiceGenerationArgs,
  leaseId: string
): Promise<DraftedLeaseInvoice[]> {
  const { companyId, asOf, userId } = args;

  const lease = await trx
    .selectFrom("lease")
    .select([
      "id",
      "status",
      "endDate",
      "supplierId",
      "supplierContactId",
      "supplierLocationId",
      "locationId",
      "currencyCode"
    ])
    .where("id", "=", leaseId)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (!isBillableLeaseStatus(lease.status)) return [];
  if (lease.status === "Active" && lease.endDate === null) {
    await rollOpenEndedLeasePayments(trx, { companyId, userId, leaseId, asOf });
  }

  const rows = await trx
    .selectFrom("leasePayment as p")
    .innerJoin("leaseLine as l", (join) =>
      join
        .onRef("l.id", "=", "p.leaseLineId")
        .onRef("l.companyId", "=", "p.companyId")
    )
    .select([
      "p.id",
      "p.paymentType",
      "p.amount",
      sql<string>`p."periodStart"::text`.as("periodStart"),
      sql<string>`p."periodEnd"::text`.as("periodEnd"),
      sql<string>`p."dueDate"::text`.as("dueDate"),
      "l.description",
      "l.locationId"
    ])
    .where("p.leaseId", "=", leaseId)
    .where("p.companyId", "=", companyId)
    .where("p.status", "=", "Pending")
    .where("p.dueDate", "<=", asOf)
    .orderBy("p.dueDate")
    .orderBy("l.sortOrder")
    .orderBy("p.paymentType")
    .forUpdate("p")
    .execute();
  if (rows.length === 0) return [];

  const payment = await trx
    .selectFrom("supplierPayment")
    .select([
      "invoiceSupplierId",
      "invoiceSupplierContactId",
      "invoiceSupplierLocationId",
      "paymentTermId"
    ])
    .where("supplierId", "=", lease.supplierId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();

  const byDueDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byDueDate.get(row.dueDate) ?? [];
    group.push(row);
    byDueDate.set(row.dueDate, group);
  }

  const drafted: DraftedLeaseInvoice[] = [];
  for (const [dueDate, group] of byDueDate) {
    const subtotal = round(
      group.reduce((sum, row) => sum + Number(row.amount), 0)
    );
    const invoiceId = await getNextSequence(trx, "purchaseInvoice", companyId);
    // Every purchase invoice hangs off a supplier interaction, as the ERP's
    // `insertPurchaseInvoice` creates one.
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ companyId, supplierId: lease.supplierId })
      .returning("id")
      .executeTakeFirstOrThrow();
    const invoice = await trx
      .insertInto("purchaseInvoice")
      .values({
        invoiceId,
        status: "Draft",
        supplierId: lease.supplierId,
        invoiceSupplierId: payment?.invoiceSupplierId ?? lease.supplierId,
        invoiceSupplierContactId:
          payment?.invoiceSupplierContactId ?? lease.supplierContactId,
        invoiceSupplierLocationId:
          payment?.invoiceSupplierLocationId ?? lease.supplierLocationId,
        supplierInteractionId: interaction.id,
        locationId: lease.locationId,
        paymentTermId: payment?.paymentTermId ?? null,
        // v1 leases are base currency only.
        currencyCode: lease.currencyCode,
        exchangeRate: 1,
        dateIssued: dueDate,
        subtotal,
        totalDiscount: 0,
        totalAmount: subtotal,
        totalTax: 0,
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("purchaseInvoiceDelivery")
      .values({
        id: invoice.id,
        locationId: lease.locationId,
        supplierShippingCost: 0,
        companyId,
        updatedBy: userId
      })
      .execute();

    await trx
      .insertInto("purchaseInvoiceLine")
      .values(
        group.map((row, index) => ({
          invoiceId: invoice.id,
          invoiceLineType: "Lease" as const,
          leaseId,
          leasePaymentId: row.id,
          locationId: row.locationId ?? lease.locationId,
          description: leasePaymentDescription(row.description, row),
          quantity: 1,
          supplierUnitPrice: Number(row.amount),
          supplierShippingCost: 0,
          supplierTaxAmount: 0,
          taxPercent: 0,
          exchangeRate: 1,
          sortOrder: index + 1,
          companyId,
          createdBy: userId
        }))
      )
      .execute();

    await trx
      .updateTable("leasePayment")
      .set((eb) => ({
        status: "Invoiced",
        purchaseInvoiceLineId: eb
          .selectFrom("purchaseInvoiceLine")
          .select("purchaseInvoiceLine.id")
          .whereRef(
            "purchaseInvoiceLine.leasePaymentId",
            "=",
            "leasePayment.id"
          )
          .where("purchaseInvoiceLine.invoiceId", "=", invoice.id)
          .where("purchaseInvoiceLine.companyId", "=", companyId),
        updatedBy: userId,
        updatedAt: sql`now()`
      }))
      .where("companyId", "=", companyId)
      .where(
        "id",
        "in",
        group.map((row) => row.id)
      )
      .execute();

    drafted.push({ invoiceId: invoice.id, leaseId });
  }
  return drafted;
}

/**
 * Cuts an open-ended lease's payment rows forward to one period past `asOf`
 * (`openEndedLeaseHorizon`), for each active asset with a payment: only the
 * periods after its last Rent row, so an edited or deleted row is never cut
 * again (`cutLeasePaymentRows`, as at setup). The lease row is locked by the
 * caller.
 */
export async function rollOpenEndedLeasePayments(
  trx: KyselyTx,
  args: { companyId: string; userId: string; leaseId: string; asOf: string }
): Promise<number> {
  const { companyId, userId, leaseId, asOf } = args;
  const lease = await trx
    .selectFrom("lease")
    .select([
      sql<string>`"commencementDate"::text`.as("commencementDate"),
      sql<string>`"invoiceFromDate"::text`.as("invoiceFromDate"),
      "paymentFrequency",
      "paymentTiming",
      "annualEscalationPercent",
      "currencyCode"
    ])
    .where("id", "=", leaseId)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();
  const lines = await trx
    .selectFrom("leaseLine as l")
    .leftJoin("leasePayment as p", (join) =>
      join
        .onRef("p.leaseLineId", "=", "l.id")
        .onRef("p.companyId", "=", "l.companyId")
        .on("p.paymentType", "=", "Rent")
    )
    .select([
      "l.id",
      "l.paymentAmount",
      "l.purchaseOptionAmount",
      "l.purchaseOptionReasonablyCertain",
      sql<string | null>`max(p."periodStart")::text`.as("lastPeriodStart")
    ])
    .where("l.leaseId", "=", leaseId)
    .where("l.companyId", "=", companyId)
    .where("l.status", "=", "Active")
    .where("l.paymentAmount", ">", 0)
    .groupBy([
      "l.id",
      "l.paymentAmount",
      "l.purchaseOptionAmount",
      "l.purchaseOptionReasonablyCertain"
    ])
    .execute();
  if (lines.length === 0) return 0;

  const decimals = await currencyDecimals(trx, companyId, lease.currencyCode);
  const through = openEndedLeaseHorizon(
    lease.commencementDate,
    asOf,
    lease.paymentFrequency
  );
  const rows = lines.flatMap(
    (line) =>
      cutLeasePaymentRows({
        lease: { ...lease, endDate: null },
        asset: line,
        decimals,
        through,
        after: line.lastPeriodStart
      }).rows
  );
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

/** "Forklift FL-12 — 2027-01-01 to 2027-01-31", or for a one-off payment
 *  "Forklift FL-12 — Purchase Option": the leased asset and what is paid. */
export function leasePaymentDescription(
  assetDescription: string,
  row: {
    paymentType: Database["public"]["Enums"]["leasePaymentType"];
    periodStart: string;
    periodEnd: string;
  }
): string {
  if (row.paymentType !== "Rent") {
    return `${assetDescription} — ${row.paymentType}`;
  }
  return `${assetDescription} — ${row.periodStart} to ${row.periodEnd}`;
}

export const createLeaseInvoicesInput = z.object({
  /** `YYYY-MM-DD` in the company's timezone. */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Bill one lease only. */
  leaseId: z.string().optional()
});

export const createLeaseInvoicesPermission = {
  update: "purchasing",
  create: "invoicing"
} satisfies PermissionRule<z.output<typeof createLeaseInvoicesInput>>;

/** Drafts the lease invoices due on or before `asOf` (see
 *  `createLeaseInvoicesForDuePayments`). A lease that fails is reported in
 *  `failures`, never thrown, so the others still draft. */
export async function createLeaseInvoices(
  ctx: ServiceContext,
  raw: z.input<typeof createLeaseInvoicesInput>
) {
  const { asOf, leaseId } = createLeaseInvoicesInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  return createLeaseInvoicesForDuePayments(db, {
    companyId,
    userId,
    asOf,
    leaseId
  });
}
