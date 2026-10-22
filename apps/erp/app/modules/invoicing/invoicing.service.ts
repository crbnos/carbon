// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  InvalidInputError,
  NotFoundError,
  ServerFnError
} from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import type { ServiceContext } from "@carbon/api/service-fn.server";
import { SUPABASE_URL } from "@carbon/auth";
import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import {
  fetchAllFromTable,
  getCompanyTimeZone,
  journalReference
} from "@carbon/database";
import { isBeforeCutover } from "@carbon/database/accounting-cutover-dates";
import {
  DOCUMENT_JOURNAL_STATUSES,
  OPEN_ITEM_JOURNAL_STATUSES
} from "@carbon/database/accounting-posting";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  addMovement,
  applyContractMovement,
  type ContractMovement,
  type ContractPosition,
  EMPTY_POSITION,
  movementCredits,
  negatePosition,
  normalizePosition
} from "@carbon/database/contract-position";
import {
  type InvoiceDocumentIds,
  loadDepositScope,
  loadSalesInvoiceDocumentIds
} from "@carbon/database/deposit-scope";
import {
  type AutomaticJournalStatus,
  assertPostingStatusUnchanged,
  journalPostingStatus,
  MissingAccountDefaultError,
  type OptionalDefaultRole,
  postingStatusFor,
  readAccountingCutoverDate,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import type { AccountClass } from "@carbon/database/ledger";
import { accountTypeFromClass } from "@carbon/database/ledger";
import { readPaymentProcessorFees } from "@carbon/database/payment-processor-fee";
import type { MemoJournalLine } from "@carbon/database/posting";
import {
  type BuildPaymentJournalInput,
  buildMemoJournal,
  buildPaymentJournal,
  type PaymentJournalFeeInput,
  type PaymentJournalLine
} from "@carbon/database/posting";
import type * as rows from "@carbon/database/rows";
import {
  inOrder,
  isNull,
  many,
  maybeSingle,
  selectRows,
  single,
  updateRows
} from "@carbon/database/rows";
import type {
  SalesPostingAccount,
  SalesPostingJournalLine,
  SalesRevenueLeg
} from "@carbon/database/sales-posting-amounts";
import { getNextSequence } from "@carbon/database/sequence";
import { SalesInvoiceEmail } from "@carbon/documents/email";
import { createMappingService } from "@carbon/ee/accounting";
import {
  dedupeViolations,
  evaluateSalesRuleLines,
  isBlocked
} from "@carbon/ee/rules.server";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import {
  loadSalesInvoiceDocument,
  renderSalesInvoicePdf
} from "@carbon/lib/sales-invoice-document.server";
import { getLogger } from "@carbon/logger";
import type { ConnectCustomerInput } from "@carbon/stripe/connect.server";
import {
  expectedConnectInvoiceTotal,
  findConnectCustomersByEmail,
  retrieveConnectCustomer,
  upsertConnectCustomer
} from "@carbon/stripe/connect.server";
import {
  getStripeConnectAccountId,
  STRIPE_CONNECT_INTEGRATION,
  sendPostedSalesInvoiceViaStripe,
  toStripeInvoiceLines
} from "@carbon/stripe/send-sales-invoice.server";
import type { Violation } from "@carbon/utils";
import {
  addDays,
  allocatePaymentFunding,
  allocateSalesHeaderShipping,
  allocateVarianceAcrossLayers,
  applyRate,
  assertCurrencyDecimals,
  assertExchangeRate,
  buildSalesPostingLines,
  CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION,
  CUSTOMER_DEPOSIT_DESCRIPTION,
  calculateDueDate,
  calculateSalesIntercompanyAmount,
  chunkArray,
  classifyIntercompanyPostingLines,
  credit,
  datetime,
  debit,
  distributeRoundingResidual,
  EPSILON,
  equals,
  type FundingConsumptionRow,
  type FundingPaymentRow,
  type FundingRequest,
  type FundingScope,
  type FundingSource,
  fundingScopeOf,
  getBillableQuantity,
  getRemainingQuantityToInvoice,
  invoiceRemainingAmounts,
  isBillableLeaseStatus,
  isEffectiveSettlement,
  onAccountCreditDescription,
  PAYABLE_POSTING_DESCRIPTIONS,
  RECEIVABLE_POSTING_DESCRIPTIONS,
  REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION,
  type ReceiptLayerLike,
  reduceInvoiceSettlements,
  remainingFundingSources,
  round,
  roundSalesPostingAmounts,
  type SalesPostingMetadata,
  type ScheduleRow,
  type SettlementBalanceRow,
  searchFilter,
  spreadStraightLine,
  toBaseAmount,
  toDocumentAmount,
  unchecked,
  type VarianceAllocation
} from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import { renderAsync } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  getCurrencyByCode,
  getDefaultAccounts,
  saveJournalEntryWithLines
} from "~/modules/accounting/accounting.service";
import { hasAccountingCutover } from "~/modules/accounting/accounting.utils";
import { upsertDocument } from "~/modules/documents/documents.service";
import {
  getSupplierPayment,
  getSupplierShipping,
  insertSupplierInteraction
} from "~/modules/purchasing/purchasing.service";
import {
  getCustomer,
  getCustomerContact,
  getCustomerLocation,
  getCustomerTax,
  recordSalesRuleOutcome,
  updateCustomerContact
} from "~/modules/sales/sales.service";
import { getCompanySettings } from "~/modules/settings/settings.service";
import {
  assertNoMigrationClearing,
  assertPostable,
  calculateCOGS,
  documentJournalLines,
  FixedAssetWrites,
  getCompanyTimeZone as getCachedCompanyTimeZone,
  getCurrentAccountingPeriod,
  getDefaultPostingGroup,
  type JournalLineDimensionValues,
  journalLineDimensionRows,
  loadContractPositions,
  loadPartyDimensions,
  lockContractPositions,
  PURCHASE_INVOICE_VOID_BEFORE_CUTOVER_ERROR,
  partyDimensionValues,
  partyDimensionValuesFrom,
  refuseUnlessOwned,
  refuseVoidBeforeCutover,
  resolveInventoryAccount,
  SALES_INVOICE_VOID_BEFORE_CUTOVER_ERROR,
  salesInvoiceStandIns,
  samePosition,
  signedCreditAmount,
  syncDraftRecognitionRuns
} from "~/modules/shared/shared.service";
import { getUser } from "~/modules/users/users.service";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { stripSpecialCharacters } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import { getExchangeRate } from "../accounting/accounting.service";
import { getEmployeeJob } from "../people/people.service";
import { OPEN_SALES_ORDER_STATUSES } from "../sales/sales.models";
import {
  getCustomerPayment,
  getCustomerShipping
} from "../sales/sales.service";
import * as sharedPostings from "../shared/shared.service";
import { invokeCreate, invokePosting } from "../shared/shared.service";
import { updateSortOrder } from "../shared/sort-order";
import type {
  ChargeStatusType,
  ChargeType,
  invoiceSettlementValidator,
  memoValidator,
  PaymentStatusType,
  paymentValidator,
  purchaseInvoiceDeliveryValidator,
  purchaseInvoiceLineValidator,
  purchaseInvoiceValidator,
  ReimbursementStatusType,
  reimbursementLineValidator,
  reimbursementUpdateValidator,
  salesInvoiceLineValidator,
  salesInvoiceShipmentValidator,
  salesInvoiceValidator
} from "./invoicing.models";
import {
  type DepositDocument,
  isPurchaseInvoiceLocked,
  isSalesInvoiceLocked,
  type stripeCustomerActions
} from "./invoicing.models";
import type { StripeCustomerSources } from "./stripe-customer.mapper";
import { buildStripeCustomerInput } from "./stripe-customer.mapper";

const logger = getLogger("erp", "invoicing");

const PURCHASE_INVOICES_LIST_COLUMNS =
  "id,invoiceId,supplierId,invoiceSupplierId,supplierReference,postingDate,dateIssued,dateDue,datePaid,balance,assignee,createdBy,createdAt,updatedBy,updatedAt,customFields,companyId,thumbnailPath,itemType,orderTotal,status,paymentTermName" as const;

const SALES_INVOICES_LIST_COLUMNS =
  "id,invoiceId,status,customerId,customerReference,invoiceCustomerId,postingDate,dateIssued,dateDue,datePaid,balance,assignee,companyId,customFields,createdAt,createdBy,updatedAt,updatedBy,thumbnailPath,itemType,invoiceTotal,paymentTermName,needsReview,automationHoldReason,sendError,sentAt" as const;

/**
 * Compute an invoice's Due Date from its Issue Date and Payment Term.
 * Returns null only when the issue date is missing or can't be parsed — callers
 * fall back to a plain field update in that case. A missing payment term is NOT
 * a missing due date: an unset paymentTermId, or one whose row genuinely
 * doesn't exist for the company, falls back to `DEFAULT_PAYMENT_TERM` (Net 30).
 * A payment-term *query failure* is different: it throws, so callers abort
 * instead of writing the invoice with a stale dateDue. The read is scoped by
 * companyId for tenant isolation (defense in depth alongside RLS) and uses
 * maybeSingle so an absent row is data: null (not an error) — keeping "missing"
 * distinguishable from "failed".
 *
 * The date arithmetic is `calculateDueDate` (@carbon/utils), the same one
 * invoice posting uses.
 */
export async function computeInvoiceDateDue(
  client: SupabaseClient<Database>,
  args: {
    dateIssued: string | null | undefined;
    paymentTermId: string | null | undefined;
    companyId: string;
  }
): Promise<string | null> {
  const { dateIssued, paymentTermId, companyId } = args;
  if (!dateIssued) return null;

  const paymentTerm = paymentTermId
    ? await client
        .from("paymentTerm")
        .select("daysDue, calculationMethod")
        .eq("id", paymentTermId)
        .eq("companyId", companyId)
        .maybeSingle()
    : null;

  if (paymentTerm?.error) {
    throw new Error(
      `Failed to load payment term ${paymentTermId} while recomputing invoice due date: ${paymentTerm.error.message}`
    );
  }

  return calculateDueDate(dateIssued, paymentTerm?.data);
}

/**
 * Early-payment (cash) discount per invoice, for seeding a payment's
 * applications. A discount only applies when the payment lands within the
 * term's discount window (e.g. "2/10 net 30" → 2% only if paid within 10 days
 * of the issue date). Returns a Map keyed by invoice id; invoices with no term,
 * a zero discount percentage, a missing issue date, or a payment date past the
 * window map to 0.
 *
 * The discount is a settlement amount, so it rounds to the currency's decimals
 * via `applyRate` (`discountPercentage` is stored as points, e.g. 2 → 0.02).
 * The deadline uses the same calculationMethod anchoring as the due date (see
 * computeInvoiceDateDue) but with `daysDiscount` instead of `daysDue`. Terms are
 * batch-loaded in one query — never per invoice (N+1).
 */
export async function computeEarlyPaymentDiscounts(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    asOfDate: string;
    currencyDecimals: number;
    invoices: {
      id: string;
      balance: number;
      dateIssued: string | null;
      paymentTermId: string | null;
    }[];
  }
): Promise<Map<string, number>> {
  const { companyId, asOfDate, currencyDecimals, invoices } = args;
  const result = new Map<string, number>(invoices.map((inv) => [inv.id, 0]));

  const termIds = [
    ...new Set(
      invoices
        .map((inv) => inv.paymentTermId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  if (termIds.length === 0) return result;

  const terms = await client
    .from("paymentTerm")
    .select("id, daysDiscount, discountPercentage, calculationMethod")
    .in("id", termIds)
    .eq("companyId", companyId);
  if (terms.error) {
    throw new Error(
      `Failed to load payment terms while computing early-payment discounts: ${terms.error.message}`
    );
  }
  const termById = new Map((terms.data ?? []).map((term) => [term.id, term]));

  let asOf: ReturnType<typeof parseDate>;
  try {
    asOf = parseDate(asOfDate);
  } catch {
    return result;
  }

  for (const inv of invoices) {
    if (!inv.paymentTermId || !inv.dateIssued) continue;
    const term = termById.get(inv.paymentTermId);
    if (!term) continue;
    const pct = Number(term.discountPercentage ?? 0);
    const days = Number(term.daysDiscount ?? 0);
    if (pct <= 0) continue;

    let issued: ReturnType<typeof parseDate>;
    try {
      issued = parseDate(inv.dateIssued);
    } catch {
      continue;
    }

    let deadline: ReturnType<typeof parseDate>;
    switch (term.calculationMethod) {
      case "End of Month":
        deadline = endOfMonth(issued).add({ days });
        break;
      case "Day of Month": {
        const sameMonth = issued.set({ day: days });
        deadline =
          sameMonth.compare(issued) >= 0
            ? sameMonth
            : issued.add({ months: 1 }).set({ day: days });
        break;
      }
      default:
        deadline = issued.add({ days });
    }

    // Past the discount window → the early-payment discount is no longer offered.
    if (asOf.compare(deadline) > 0) continue;

    result.set(
      inv.id,
      applyRate(Number(inv.balance), pct / 100, currencyDecimals)
    );
  }

  return result;
}

export async function createPurchaseInvoiceFromPurchaseOrder(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  purchaseOrderId: string,
  companyId: string,
  userId: string
) {
  return invokePosting(
    { client, db, companyId, userId },
    "convert",
    {
      type: "purchaseOrderToPurchaseInvoice",
      id: purchaseOrderId
    },
    sharedPostings.convertDocument,
    { as: sharedPostings.convertDocumentPermission }
  );
}

export async function createSalesInvoiceFromSalesOrder(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  salesOrderId: string,
  companyId: string,
  userId: string
) {
  return invokePosting(
    { client, db, companyId, userId },
    "convert",
    {
      type: "salesOrderToSalesInvoice",
      id: salesOrderId
    },
    sharedPostings.convertDocument,
    { as: sharedPostings.convertDocumentPermission }
  );
}

export async function createSalesInvoiceFromShipment(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  shipmentId: string,
  companyId: string,
  userId: string
) {
  return invokePosting(
    { client, db, companyId, userId },
    "convert",
    {
      type: "shipmentToSalesInvoice",
      id: shipmentId
    },
    sharedPostings.convertDocument,
    { as: sharedPostings.convertDocumentPermission }
  );
}

export async function deletePurchaseInvoice(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  // Check if invoice is in Draft status before deleting
  const invoice = await client
    .from("purchaseInvoice")
    .select("id, status")
    .eq("id", purchaseInvoiceId)
    .single();

  if (invoice.error) {
    return invoice;
  }

  if (invoice.data.status !== "Draft") {
    return {
      data: null,
      error: {
        message: `Cannot delete purchase invoice with status "${invoice.data.status}". Only Draft invoices can be deleted.`,
        code: "INVOICE_NOT_DRAFT"
      }
    };
  }

  return client.from("purchaseInvoice").delete().eq("id", purchaseInvoiceId);
}

export async function deletePurchaseInvoiceLine(
  client: SupabaseClient<Database>,
  purchaseInvoiceLineId: string
) {
  return client
    .from("purchaseInvoiceLine")
    .delete()
    .eq("id", purchaseInvoiceLineId);
}

export async function deleteSalesInvoice(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  // Check if invoice is in Draft status before deleting
  const invoice = await client
    .from("salesInvoice")
    .select("id, status")
    .eq("id", salesInvoiceId)
    .single();

  if (invoice.error) {
    return invoice;
  }

  if (invoice.data.status !== "Draft") {
    return {
      data: null,
      error: {
        message: `Cannot delete sales invoice with status "${invoice.data.status}". Only Draft invoices can be deleted.`,
        code: "INVOICE_NOT_DRAFT"
      }
    };
  }

  return client.from("salesInvoice").delete().eq("id", salesInvoiceId);
}

export async function deleteSalesInvoiceLine(
  client: SupabaseClient<Database>,
  salesInvoiceLineId: string
) {
  return client.from("salesInvoiceLine").delete().eq("id", salesInvoiceLineId);
}

export async function getPurchaseInvoice(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  return client
    .from("purchaseInvoices")
    .select("*")
    .eq("id", purchaseInvoiceId)
    .single();
}

export async function getPurchaseInvoices(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("purchaseInvoices")
    .select(PURCHASE_INVOICES_LIST_COLUMNS, { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("invoiceId", `%${args.search}%`);
  }

  if (args.supplierId) {
    query = query.eq("supplierId", args.supplierId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "invoiceId", ascending: false }
  ]);
  return query;
}

export async function getPurchaseInvoiceDelivery(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  return client
    .from("purchaseInvoiceDelivery")
    .select("*")
    .eq("id", purchaseInvoiceId)
    .single();
}

export async function getPurchaseInvoiceLines(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  return client
    .from("purchaseInvoiceLines")
    .select("*")
    .eq("invoiceId", purchaseInvoiceId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getPurchaseInvoiceLine(
  client: SupabaseClient<Database>,
  purchaseInvoiceLineId: string
) {
  // The view: the line plus its asset's and lease's readable ids.
  return client
    .from("purchaseInvoiceLines")
    .select("*")
    .eq("id", purchaseInvoiceLineId)
    .single();
}

export async function getSalesInvoice(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoices")
    .select("*")
    .eq("id", salesInvoiceId)
    .single();
}

export async function getSalesInvoiceCustomerDetails(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoiceLocations")
    .select("*")
    .eq("id", salesInvoiceId)
    .single();
}

export async function getSalesInvoices(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    customerId: string | null;
  }
) {
  let query = client
    .from("salesInvoices")
    .select(SALES_INVOICES_LIST_COLUMNS, { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("invoiceId", `%${args.search}%`);
  }

  if (args.customerId) {
    query = query.eq("customerId", args.customerId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "invoiceId", ascending: false }
  ]);
  return query;
}

export async function getSalesInvoiceShipment(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoiceShipment")
    .select("*")
    .eq("id", salesInvoiceId)
    .single();
}

export async function getSalesInvoiceLines(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoiceLines")
    .select("*")
    .eq("invoiceId", salesInvoiceId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getSalesInvoiceLine(
  client: SupabaseClient<Database>,
  salesInvoiceLineId: string
) {
  return client
    .from("salesInvoiceLine")
    .select("*")
    .eq("id", salesInvoiceLineId)
    .single();
}

export async function updatePurchaseInvoiceExchangeRate(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    exchangeRate: number;
    updatedBy: string;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString(),
    updatedBy: data.updatedBy,
    updatedAt: new Date().toISOString()
  };

  return client.from("purchaseInvoice").update(update).eq("id", update.id);
}

export async function updateSalesInvoiceExchangeRate(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    exchangeRate: number;
    updatedBy: string;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString(),
    updatedBy: data.updatedBy,
    updatedAt: new Date().toISOString()
  };

  return client.from("salesInvoice").update(update).eq("id", update.id);
}

/** Not published: `invoicing.purchaseInvoice.create` creates the invoice and its extracted lines. */
export async function insertPurchaseInvoice(
  client: SupabaseClient<Database>,
  input: {
    supplierId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    invoiceId?: string;
    supplierReference?: string;
    paymentTermId?: string;
    currencyCode?: string;
    locationId?: string;
    invoiceSupplierId?: string;
    invoiceSupplierContactId?: string;
    invoiceSupplierLocationId?: string;
    dateIssued?: string;
    dateDue?: string;
    exchangeRate?: number;
    exchangeRateUpdatedAt?: string;
    supplierShippingCost?: number;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; invoiceId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let invoiceId: string;
  if (input.invoiceId) {
    invoiceId = input.invoiceId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "purchaseInvoice",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate purchaseInvoice sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    invoiceId = seq.data;
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

  const { paymentTermId, invoiceSupplierId } = supplierPayment.data;
  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    supplierShipping.data;

  let exchangeRate = input.exchangeRate;
  let exchangeRateUpdatedAt =
    input.exchangeRateUpdatedAt ?? new Date().toISOString();

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

  const locationId = input.locationId ?? purchaser?.data?.locationId ?? null;

  const invoice = await client
    .from("purchaseInvoice")
    .insert({
      invoiceId,
      supplierId: input.supplierId,
      supplierReference: input.supplierReference ?? null,
      invoiceSupplierId:
        input.invoiceSupplierId ?? invoiceSupplierId ?? input.supplierId,
      invoiceSupplierContactId: input.invoiceSupplierContactId ?? null,
      invoiceSupplierLocationId: input.invoiceSupplierLocationId ?? null,
      supplierInteractionId: supplierInteraction.data?.id,
      currencyCode: input.currencyCode ?? "USD",
      exchangeRate,
      exchangeRateUpdatedAt,
      paymentTermId: input.paymentTermId ?? paymentTermId,
      dateIssued:
        input.dateIssued ??
        datetime
          .today(await getCompanyTimeZone(client, input.companyId))
          .toString(),
      dateDue: input.dateDue ?? null,
      locationId,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, invoiceId")
    .single();

  if (invoice.error) return { data: null, error: invoice.error };

  const delivery = await client.from("purchaseInvoiceDelivery").insert({
    id: invoice.data.id,
    locationId,
    shippingMethodId,
    shippingTermId,
    incoterm,
    incotermLocation,
    supplierShippingCost: input.supplierShippingCost ?? 0,
    companyId: input.companyId
  });

  if (delivery.error) {
    await client.from("purchaseInvoice").delete().eq("id", invoice.data.id);
    return { data: null, error: delivery.error };
  }

  return {
    data: { id: invoice.data.id, invoiceId: invoice.data.invoiceId },
    error: null
  };
}

export async function updatePurchaseInvoice(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    invoiceId?: string;
    supplierId?: string;
    supplierReference?: string | null;
    paymentTermId?: string | null;
    currencyCode?: string;
    locationId?: string;
    invoiceSupplierId?: string | null;
    invoiceSupplierContactId?: string | null;
    invoiceSupplierLocationId?: string | null;
    dateIssued?: string | null;
    dateDue?: string | null;
    exchangeRate?: number;
    exchangeRateUpdatedAt?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, ...rest } = input;
  const result = await client
    .from("purchaseInvoice")
    .update({
      ...sanitize(rest),
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .select("id")
    .single();

  if (result.error) return { data: null, error: result.error };
  return { data: { id: result.data.id }, error: null };
}

/** @deprecated Use insertPurchaseInvoice for new invoices, updatePurchaseInvoice for existing invoices */
export async function upsertPurchaseInvoice(
  client: SupabaseClient<Database>,
  purchaseInvoice:
    | (Omit<z.infer<typeof purchaseInvoiceValidator>, "id" | "invoiceId"> & {
        invoiceId: string;
        companyId: string;
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof purchaseInvoiceValidator>, "id" | "invoiceId"> & {
        id: string;
        invoiceId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  // Shipping cost belongs to purchaseInvoiceDelivery, not the invoice row.
  if ("id" in purchaseInvoice) {
    const { supplierShippingCost: _shipping, ...invoiceUpdate } =
      purchaseInvoice;
    return client
      .from("purchaseInvoice")
      .update({
        ...sanitize(invoiceUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", purchaseInvoice.id)
      .select("id, invoiceId");
  }

  const [supplierInteraction, supplierPayment, supplierShipping, purchaser] =
    await Promise.all([
      insertSupplierInteraction(
        client,
        purchaseInvoice.companyId,
        purchaseInvoice.supplierId
      ),
      getSupplierPayment(client, purchaseInvoice.supplierId),
      getSupplierShipping(client, purchaseInvoice.supplierId),
      getEmployeeJob(
        client,
        purchaseInvoice.createdBy,
        purchaseInvoice.companyId
      )
    ]);

  if (supplierInteraction.error) return supplierInteraction;
  if (supplierPayment.error) return supplierPayment;
  if (supplierShipping.error) return supplierShipping;

  const { paymentTermId, invoiceSupplierId } = supplierPayment.data;

  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    supplierShipping.data;

  if (purchaseInvoice.currencyCode) {
    const rate = await getExchangeRate(
      client,
      purchaseInvoice.companyId,
      purchaseInvoice.currencyCode
    );
    if (rate.error) return rate;
    purchaseInvoice.exchangeRate = rate.data;
    purchaseInvoice.exchangeRateUpdatedAt = new Date().toISOString();
  } else {
    purchaseInvoice.exchangeRate = 1;
    purchaseInvoice.exchangeRateUpdatedAt = new Date().toISOString();
  }

  const locationId =
    purchaseInvoice.locationId ?? purchaser?.data?.locationId ?? null;

  const {
    companyGroupId: _companyGroupId,
    supplierShippingCost: _shipping,
    ...purchaseInvoiceData
  } = purchaseInvoice;

  const invoice = await client
    .from("purchaseInvoice")
    .insert([
      {
        ...purchaseInvoiceData,
        invoiceSupplierId: invoiceSupplierId ?? purchaseInvoice.supplierId,
        supplierInteractionId: supplierInteraction.data?.id,
        currencyCode: purchaseInvoice.currencyCode ?? "USD",
        paymentTermId: purchaseInvoice.paymentTermId ?? paymentTermId
      }
    ])
    .select("id, invoiceId");

  if (invoice.error) return invoice;

  const invoiceId = invoice.data[0].id;

  const delivery = await client.from("purchaseInvoiceDelivery").insert([
    {
      id: invoiceId,
      locationId: locationId,
      shippingMethodId: shippingMethodId,
      shippingTermId: shippingTermId,
      incoterm: incoterm,
      incotermLocation: incotermLocation,
      companyId: purchaseInvoice.companyId
    }
  ]);

  if (delivery.error) {
    await client.from("purchaseInvoice").delete().eq("id", invoiceId);
    return delivery;
  }

  return invoice;
}

/**
 * Updates an invoice's delivery. The row is created with the invoice and
 * shares its id, so there is nothing to insert here.
 */
export async function upsertPurchaseInvoiceDelivery(
  client: SupabaseClient<Database>,
  purchaseInvoiceDelivery: z.infer<typeof purchaseInvoiceDeliveryValidator> & {
    companyId: string;
    updatedBy: string;
    customFields?: Json;
  }
) {
  // The company scopes the row; it is never written to it.
  const { companyId, ...delivery } = purchaseInvoiceDelivery;
  return client
    .from("purchaseInvoiceDelivery")
    .update(sanitize(delivery))
    .eq("id", delivery.id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

export async function upsertPurchaseInvoiceLine(
  client: SupabaseClient<Database>,
  purchaseInvoiceLine:
    | (Omit<z.infer<typeof purchaseInvoiceLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof purchaseInvoiceLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  // Only `create-lease-invoices` links a line to a lease payment row, when
  // it bills the row; a caller cannot claim one (the row would stay Pending
  // and be billed again), and an edit keeps the stored link.
  const { leasePaymentId: _leasePaymentId, ...line } = purchaseInvoiceLine;
  if ("id" in line) {
    return client
      .from("purchaseInvoiceLine")
      .update(sanitize(line))
      .eq("id", line.id)
      .select("id")
      .single();
  }

  const existing = await client
    .from("purchaseInvoiceLine")
    .select("sortOrder")
    .eq("invoiceId", line.invoiceId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("purchaseInvoiceLine")
    .insert([{ ...line, sortOrder: maxSortOrder + 1 }])
    .select("id")
    .single();
}

export async function updatePurchaseInvoiceLineOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  invoiceId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "purchaseInvoiceLine",
    column: "sortOrder",
    companyId,
    userId,
    parent: { column: "invoiceId", id: invoiceId },
    updates
  });
}

export async function insertSalesInvoice(
  client: SupabaseClient<Database>,
  input: {
    customerId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    invoiceId?: string;
    customerReference?: string;
    paymentTermId?: string;
    currencyCode?: string;
    locationId?: string;
    invoiceCustomerId?: string;
    invoiceCustomerContactId?: string;
    invoiceCustomerLocationId?: string;
    dateIssued?: string;
    dateDue?: string;
    exchangeRate?: number;
    exchangeRateUpdatedAt?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; invoiceId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let invoiceId: string;
  if (input.invoiceId) {
    invoiceId = input.invoiceId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "salesInvoice",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate salesInvoice sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    invoiceId = seq.data;
  }

  const [opportunity, customerPayment, customerShipping, salesPerson] =
    await Promise.all([
      client
        .from("opportunity")
        .insert({
          companyId: input.companyId,
          customerId: input.customerId
        })
        .select("id")
        .single(),
      getCustomerPayment(client, input.customerId),
      getCustomerShipping(client, input.customerId),
      getEmployeeJob(client, input.createdBy, input.companyId)
    ]);

  if (opportunity.error) return { data: null, error: opportunity.error };
  if (customerPayment.error)
    return { data: null, error: customerPayment.error };
  if (customerShipping.error)
    return { data: null, error: customerShipping.error };

  const { paymentTermId, invoiceCustomerId } = customerPayment.data;
  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    customerShipping.data;

  let exchangeRate = input.exchangeRate;
  let exchangeRateUpdatedAt =
    input.exchangeRateUpdatedAt ?? new Date().toISOString();

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

  const locationId = input.locationId ?? salesPerson?.data?.locationId ?? null;

  const invoice = await client
    .from("salesInvoice")
    .insert({
      invoiceId,
      customerId: input.customerId,
      customerReference: input.customerReference ?? null,
      invoiceCustomerId:
        input.invoiceCustomerId ?? invoiceCustomerId ?? input.customerId,
      invoiceCustomerContactId: input.invoiceCustomerContactId ?? null,
      invoiceCustomerLocationId: input.invoiceCustomerLocationId ?? null,
      opportunityId: opportunity.data?.id,
      currencyCode: input.currencyCode ?? "USD",
      exchangeRate,
      exchangeRateUpdatedAt,
      paymentTermId: input.paymentTermId ?? paymentTermId,
      dateIssued:
        input.dateIssued ??
        datetime
          .today(await getCompanyTimeZone(client, input.companyId))
          .toString(),
      dateDue: input.dateDue ?? null,
      locationId,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, invoiceId")
    .single();

  if (invoice.error) return { data: null, error: invoice.error };

  const delivery = await client.from("salesInvoiceShipment").insert({
    id: invoice.data.id,
    locationId,
    shippingMethodId,
    shippingTermId,
    incoterm,
    incotermLocation,
    companyId: input.companyId,
    createdBy: input.createdBy
  });

  if (delivery.error) {
    await client.from("salesInvoice").delete().eq("id", invoice.data.id);
    return { data: null, error: delivery.error };
  }

  return {
    data: { id: invoice.data.id, invoiceId: invoice.data.invoiceId },
    error: null
  };
}

export async function updateSalesInvoice(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    invoiceId?: string;
    customerId?: string;
    customerReference?: string | null;
    paymentTermId?: string | null;
    currencyCode?: string;
    locationId?: string;
    invoiceCustomerId?: string | null;
    invoiceCustomerContactId?: string | null;
    invoiceCustomerLocationId?: string | null;
    dateIssued?: string | null;
    dateDue?: string | null;
    exchangeRate?: number;
    exchangeRateUpdatedAt?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, ...rest } = input;
  const result = await client
    .from("salesInvoice")
    .update({
      ...sanitize(rest),
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .select("id")
    .single();

  if (result.error) return { data: null, error: result.error };
  return { data: { id: result.data.id }, error: null };
}

/** @deprecated Use insertSalesInvoice for new invoices, updateSalesInvoice for existing invoices */
export async function upsertSalesInvoice(
  client: SupabaseClient<Database>,
  salesInvoice:
    | (Omit<z.infer<typeof salesInvoiceValidator>, "id" | "invoiceId"> & {
        invoiceId: string;
        companyId: string;
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesInvoiceValidator>, "id" | "invoiceId"> & {
        id: string;
        invoiceId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesInvoice) {
    const { supplierShippingCost: _shipping, ...invoiceUpdate } = salesInvoice;
    return client
      .from("salesInvoice")
      .update({
        ...sanitize(invoiceUpdate),
        updatedAt: datetime.timestamp()
      })
      .eq("id", salesInvoice.id)
      .select("id, invoiceId");
  }

  const [opportunity, customerPayment, customerShipping, salesPerson] =
    await Promise.all([
      client
        .from("opportunity")
        .insert([
          {
            companyId: salesInvoice.companyId,
            customerId: salesInvoice.customerId
          }
        ])
        .select("id")
        .single(),
      getCustomerPayment(client, salesInvoice.customerId),
      getCustomerShipping(client, salesInvoice.customerId),
      getEmployeeJob(client, salesInvoice.createdBy, salesInvoice.companyId)
    ]);

  if (opportunity.error) return opportunity;
  if (customerPayment.error) return customerPayment;
  if (customerShipping.error) return customerShipping;

  const { paymentTermId, invoiceCustomerId } = customerPayment.data;
  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    customerShipping.data;

  if (salesInvoice.currencyCode) {
    const rate = await getExchangeRate(
      client,
      salesInvoice.companyId,
      salesInvoice.currencyCode
    );
    if (rate.error) return rate;
    salesInvoice.exchangeRate = rate.data;
    salesInvoice.exchangeRateUpdatedAt = new Date().toISOString();
  } else {
    salesInvoice.exchangeRate = 1;
    salesInvoice.exchangeRateUpdatedAt = new Date().toISOString();
  }

  const locationId =
    salesInvoice.locationId ?? salesPerson?.data?.locationId ?? null;

  const {
    companyGroupId: _companyGroupId,
    supplierShippingCost: _shipping,
    ...salesInvoiceData
  } = salesInvoice;

  const invoice = await client
    .from("salesInvoice")
    .insert([
      {
        ...salesInvoiceData,
        invoiceCustomerId: invoiceCustomerId ?? salesInvoice.customerId,
        opportunityId: opportunity.data?.id,
        currencyCode: salesInvoice.currencyCode ?? "USD",
        paymentTermId: salesInvoice.paymentTermId ?? paymentTermId
      }
    ])
    .select("id, invoiceId");

  if (invoice.error) return invoice;

  const invoiceId = invoice.data[0].id;

  const delivery = await client.from("salesInvoiceShipment").insert([
    {
      id: invoiceId,
      locationId: locationId,
      shippingMethodId: shippingMethodId,
      shippingTermId: shippingTermId,
      incoterm: incoterm,
      incotermLocation: incotermLocation,
      companyId: salesInvoice.companyId,
      createdBy: salesInvoice.createdBy
    }
  ]);

  if (delivery.error) {
    await client.from("salesInvoice").delete().eq("id", invoiceId);
    return delivery;
  }

  return invoice;
}

/**
 * Updates an invoice's shipment. The row is created with the invoice and
 * shares its id, so there is nothing to insert here.
 */
export async function upsertSalesInvoiceShipment(
  client: SupabaseClient<Database>,
  salesInvoiceShipment: z.infer<typeof salesInvoiceShipmentValidator> & {
    companyId: string;
    updatedBy: string;
    customFields?: Json;
  }
) {
  // The company scopes the row; it is never written to it.
  const { companyId, ...shipment } = salesInvoiceShipment;
  return client
    .from("salesInvoiceShipment")
    .update(sanitize(shipment))
    .eq("id", shipment.id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

/** Not published: `invoicing.salesInvoice.line.create` / `update` also refuse a posted invoice and run the sales rules. */
export async function upsertSalesInvoiceLine(
  client: SupabaseClient<Database>,
  salesInvoiceLine:
    | (Omit<z.infer<typeof salesInvoiceLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesInvoiceLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  // salesInvoiceLine has no purchase order columns.
  const {
    purchaseOrderId: _purchaseOrderId,
    purchaseOrderLineId: _purchaseOrderLineId,
    ...line
  } = salesInvoiceLine;

  // Only a Service line has a service period (a Rental line carries its
  // billing period) — every other item type is a physical good, earned when it
  // ships. A cleared DatePicker posts "", which a DATE column rejects, so both
  // collapse to null.
  const hasServicePeriod =
    line.invoiceLineType === "Service" || line.invoiceLineType === "Rental";
  const servicePeriod = {
    serviceStartDate: (hasServicePeriod && line.serviceStartDate) || null,
    serviceEndDate: (hasServicePeriod && line.serviceEndDate) || null
  };

  if ("id" in line) {
    return client
      .from("salesInvoiceLine")
      .update(
        sanitize({
          ...line,
          ...servicePeriod
        })
      )
      .eq("id", line.id)
      .select("id")
      .single();
  }

  const existing = await client
    .from("salesInvoiceLine")
    .select("sortOrder")
    .eq("invoiceId", line.invoiceId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("salesInvoiceLine")
    .insert([{ ...line, ...servicePeriod, sortOrder: maxSortOrder + 1 }])
    .select("id")
    .single();
}

export async function updateSalesInvoiceLineOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  invoiceId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "salesInvoiceLine",
    column: "sortOrder",
    companyId,
    userId,
    parent: { column: "invoiceId", id: invoiceId },
    updates
  });
}

// ======================================================================
// Payments (AR receipts + AP disbursements + applications)
// ======================================================================

export async function getPayment(
  client: SupabaseClient<Database>,
  id: string,
  companyId?: string
) {
  let query = client.from("payment").select("*").eq("id", id);
  if (companyId) query = query.eq("companyId", companyId);
  return query.single();
}

export async function getPayments(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    paymentType: "Receipt" | "Disbursement" | null;
    status: PaymentStatusType | null;
    customerId: string | null;
    supplierId: string | null;
    // Combined counterparty filter (customer OR supplier ids) from the table's
    // "Counterparty" filter, which sources options from both stores.
    counterpartyIds?: string[] | null;
  }
) {
  let query = client
    .from("payment")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("paymentId", `%${args.search}%`);
  }
  if (args.paymentType) {
    query = query.eq("paymentType", args.paymentType);
  }
  if (args.status) {
    query = query.eq("status", args.status);
  }
  if (args.customerId) {
    query = query.eq("customerId", args.customerId);
  }
  if (args.supplierId) {
    query = query.eq("supplierId", args.supplierId);
  }
  if (args.counterpartyIds && args.counterpartyIds.length > 0) {
    // A payment carries either customerId or supplierId; match the selected
    // ids against both columns (customer/supplier id spaces don't overlap).
    const csv = args.counterpartyIds.join(",");
    query = query.or(`customerId.in.(${csv}),supplierId.in.(${csv})`);
  }

  // Default to newest first by the sequential paymentId (PAY-yyyy-mm-NNNNNN),
  // matching the sales/purchase invoice lists (invoiceId desc) and guaranteeing
  // the most recently created payment is at the top (paymentDate ties otherwise).
  query = setGenericQueryFilters(query, args, [
    { column: "paymentId", ascending: false }
  ]);
  return query;
}

export async function getCharge(
  client: SupabaseClient<Database>,
  companyId: string,
  id: string
) {
  return client
    .from("charge")
    .select("*, chargeLine(*)")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getCharges(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    type: ChargeType | null;
    status: ChargeStatusType | null;
  }
) {
  let query = client
    .from("charge")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(searchFilter(["chargeId", "merchantName"], args.search));
  }
  if (args.type) {
    query = query.eq("type", args.type);
  }
  if (args.status) {
    query = query.eq("status", args.status);
  }

  // Default to newest first by the sequential chargeId
  // (CHG-yyyy-mm-NNNNNN), mirroring getPayments' paymentId desc default.
  query = setGenericQueryFilters(query, args, [
    { column: "chargeId", ascending: false }
  ]);
  return query;
}

export async function getReimbursement(
  client: SupabaseClient<Database>,
  companyId: string,
  id: string
) {
  // Embed the generic dimension rows with the lines — the editor and the
  // read-mode badges both need them, and a per-line query would be an N+1.
  return client
    .from("reimbursement")
    .select("*, reimbursementLine(*, reimbursementLineDimension(*))")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getReimbursements(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: ReimbursementStatusType | null;
    employeeId: string | null;
  }
) {
  let query = client
    .from("reimbursement")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      searchFilter(["reimbursementId", "reference"], args.search)
    );
  }
  if (args.status) {
    query = query.eq("status", args.status);
  }
  if (args.employeeId) {
    query = query.eq("employeeId", args.employeeId);
  }

  // Newest first by the sequential reimbursementId (REIMB-yyyy-mm-NNNNNN),
  // mirroring getCharges' chargeId desc default.
  query = setGenericQueryFilters(query, args, [
    { column: "reimbursementId", ascending: false }
  ]);
  return query;
}

/**
 * The payments that settle a reimbursement, for its Documents panel. One read
 * of its settlement rows with the payment embedded — a reimbursement is only
 * ever settled by an employee payment, never by a memo — de-duplicated, since
 * one payment can carry several settlement rows.
 */
export async function getReimbursementRelatedItems(
  client: SupabaseClient<Database>,
  companyId: string,
  reimbursementId: string
) {
  type Payment = Pick<
    Database["public"]["Tables"]["payment"]["Row"],
    "id" | "paymentId" | "status" | "paymentDate"
  >;
  const settlements = await fetchAllFromTable<{ payment: Payment | null }>(
    client,
    "invoiceSettlement",
    "payment:payment!invoiceSettlement_paymentId_fkey(id, paymentId, status, paymentDate)",
    (query) =>
      query
        .eq("companyId", companyId)
        .eq("targetReimbursementId", reimbursementId)
        .not("paymentId", "is", null)
        .order("appliedDate")
        .order("id")
  );
  if (settlements.error) {
    logger.error("Failed to get reimbursement settlements", {
      companyId,
      reimbursementId,
      error: settlements.error
    });
  }

  const payments = new Map<string, Payment>();
  for (const settlement of settlements.data ?? []) {
    const payment = settlement.payment;
    if (payment && !payments.has(payment.id)) payments.set(payment.id, payment);
  }

  return { payments: [...payments.values()] };
}

/**
 * Header edit. `.eq("status", "Draft")` is defence in depth alongside the
 * RLS UPDATE policy and the reimbursement_draft_guard trigger — a Posted
 * document is immutable, and a caller that tries gets zero rows rather than
 * a silent partial write. There is deliberately no insert branch: the Ramp
 * sync is the only thing that creates a reimbursement.
 */
export async function updateReimbursement(
  client: SupabaseClient<Database>,
  reimbursement: z.infer<typeof reimbursementUpdateValidator> & {
    companyId: string;
    updatedBy: string;
    customFields?: Json;
  }
) {
  const { id, companyId, ...update } = reimbursement;
  return client
    .from("reimbursement")
    .update({
      ...sanitize(update),
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .select("id, reimbursementId")
    .single();
}

/**
 * Replace every coding line of a Draft reimbursement, transactionally.
 *
 * Kysely BYPASSES RLS, so the parent is re-read `forUpdate()` and its status
 * re-asserted inside the transaction — exactly as replaceInvoiceSettlements
 * does. The reimbursementLine_draft_guard trigger is the final backstop, but
 * it raises a raw 55000; this throws a message the route can flash.
 *
 * Delete-all-then-reinsert rather than a diff: the editor submits the whole
 * line set as one field, so a diff would be more code for the same result.
 */
export async function upsertReimbursementLines(
  db: Kysely<KyselyDatabase>,
  args: {
    reimbursementId: string;
    companyId: string;
    createdBy: string;
    lines: z.infer<typeof reimbursementLineValidator>[];
  }
) {
  return db.transaction().execute(async (trx) => {
    const reimbursement = await trx
      .selectFrom("reimbursement")
      .select(["id", "status"])
      .where("id", "=", args.reimbursementId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!reimbursement) throw new Error("Reimbursement not found");
    if (reimbursement.status !== "Draft")
      throw new Error(
        "Coding lines can only be edited while the reimbursement is Draft"
      );

    // The reimbursementLineDimension rows need no explicit delete — the line
    // delete cascades them (ON DELETE CASCADE on the line FK), so the replace
    // is one delete and two inserts.
    await trx
      .deleteFrom("reimbursementLine")
      .where("reimbursementId", "=", args.reimbursementId)
      .where("companyId", "=", args.companyId)
      .execute();

    if (args.lines.length === 0) return 0;

    // RETURNING id, so the dimension rows can be bound to the line they
    // belong to without relying on PostgreSQL's unspecified INSERT row
    // order — the same reason post-charge allocates journal line ids up
    // front. Insert order is preserved by `sequence`, but do NOT zip the
    // returned rows by position; key them by `sequence`.
    const inserted = await trx
      .insertInto("reimbursementLine")
      .values(
        args.lines.map((line, index) => ({
          reimbursementId: args.reimbursementId,
          companyId: args.companyId,
          accountId: line.accountId,
          costCenterId: line.costCenterId ?? null,
          projectId: line.projectId ?? null,
          description: line.description ?? null,
          amount: line.amount,
          sequence: index,
          createdBy: args.createdBy
        }))
      )
      .returning(["id", "sequence"])
      .execute();

    const idBySequence = new Map(inserted.map((r) => [r.sequence, r.id]));
    const dimensionRows = args.lines.flatMap((line, index) => {
      const lineId = idBySequence.get(index);
      if (!lineId) throw new Error("Failed to map reimbursement line");
      return (line.dimensions ?? []).map((d) => ({
        reimbursementLineId: lineId,
        companyId: args.companyId,
        dimensionId: d.dimensionId,
        valueId: d.valueId
      }));
    });
    if (dimensionRows.length) {
      await trx
        .insertInto("reimbursementLineDimension")
        .values(dimensionRows)
        .execute();
    }

    return args.lines.length;
  });
}

export async function getInvoiceSettlements(
  client: SupabaseClient<Database>,
  companyId: string,
  paymentId: string
) {
  type Settlement = Database["public"]["Tables"]["invoiceSettlement"]["Row"] & {
    salesInvoice: { invoiceId: string } | null;
    purchaseInvoice: { invoiceId: string } | null;
    targetMemo: { memoId: string } | null;
    targetReimbursement: { reimbursementId: string } | null;
  };
  return fetchAllFromTable<Settlement>(
    client,
    "invoiceSettlement",
    "*, salesInvoice:targetSalesInvoiceId(invoiceId), purchaseInvoice:targetPurchaseInvoiceId(invoiceId), targetMemo:targetMemoId(memoId), targetReimbursement:reimbursement!invoiceSettlement_targetReimbursementId_fkey(reimbursementId)",
    (query) =>
      query
        .eq("companyId", companyId)
        .eq("paymentId", paymentId)
        .order("appliedDate", { ascending: true })
        .order("id")
  );
}

// A settlement against an invoice can be sourced by either a cash payment or a
// credit/debit memo — both are invoiceSettlement rows. The panel shows them
// together, so the source is a tagged union.
export type InvoiceSettlementSource =
  | {
      type: "payment";
      id: string;
      readableId: string;
      status: string | null;
      date: string | null;
      currencyCode: string;
    }
  | {
      type: "memo";
      id: string;
      readableId: string;
      status: string | null;
      date: string | null;
      currencyCode: string;
      direction: string;
    };

export type InvoiceSettlementForInvoice = {
  id: string;
  sourceAmount: number | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number | null;
  targetExchangeRate: number;
  sourceExchangeRate: number | null;
  appliedDate: string;
  source: InvoiceSettlementSource;
};

// Posted settlements against a specific invoice — BOTH cash payments and applied
// credit/debit memos. Used by the "Applied" panel on the sales/purchase invoice
// detail page. Page the embedded parents with their applications so large histories
// retain every source without oversized ID lookups.
export async function getInvoiceSettlementsForInvoice(
  client: SupabaseClient<Database>,
  companyId: string,
  side: "sales" | "purchase",
  invoiceId: string
): Promise<{
  data: InvoiceSettlementForInvoice[] | null;
  error: unknown;
}> {
  const column =
    side === "sales" ? "targetSalesInvoiceId" : "targetPurchaseInvoiceId";
  type Settlement = Pick<
    Database["public"]["Tables"]["invoiceSettlement"]["Row"],
    | "id"
    | "paymentId"
    | "memoId"
    | "appliedViaPaymentId"
    | "sourceAmount"
    | "appliedAmount"
    | "discountAmount"
    | "writeOffAmount"
    | "fxGainLossAmount"
    | "targetExchangeRate"
    | "sourceExchangeRate"
    | "appliedDate"
  > & {
    payment: Pick<
      Database["public"]["Tables"]["payment"]["Row"],
      "id" | "paymentId" | "status" | "paymentDate" | "currencyCode"
    > | null;
    memo: Pick<
      Database["public"]["Tables"]["memo"]["Row"],
      | "id"
      | "memoId"
      | "status"
      | "postingDate"
      | "memoDate"
      | "currencyCode"
      | "direction"
    > | null;
    appliedViaPayment: { status: string | null } | null;
  };
  const apps = await fetchAllFromTable<Settlement>(
    client,
    "invoiceSettlement",
    "id, paymentId, memoId, appliedViaPaymentId, sourceAmount, appliedAmount, discountAmount, writeOffAmount, fxGainLossAmount, targetExchangeRate, sourceExchangeRate, appliedDate, payment:payment!invoiceSettlement_paymentId_fkey(id,paymentId,status,paymentDate,currencyCode), memo:memo!invoiceSettlement_memoId_fkey(id,memoId,status,postingDate,memoDate,currencyCode,direction), appliedViaPayment:payment!invoiceSettlement_appliedViaPaymentId_fkey(status)",
    (query) =>
      query
        .eq("companyId", companyId)
        .eq(column, invoiceId)
        .order("appliedDate", { ascending: false })
        .order("id")
  );
  if (apps.error) return { data: null, error: apps.error };

  const merged: InvoiceSettlementForInvoice[] = [];
  for (const a of apps.data ?? []) {
    if (
      !isEffectiveSettlement({
        paymentId: a.paymentId,
        memoId: a.memoId,
        appliedViaPaymentId: a.appliedViaPaymentId,
        paymentStatus: a.payment?.status ?? null,
        memoStatus: a.memo?.status ?? null,
        viaStatus: a.appliedViaPayment?.status ?? null
      })
    )
      continue;
    let source: InvoiceSettlementSource | null = null;
    if (a.paymentId && a.payment) {
      const p = a.payment;
      source = {
        type: "payment",
        id: p.id,
        readableId: p.paymentId,
        status: p.status,
        date: p.paymentDate,
        currencyCode: p.currencyCode
      };
    } else if (a.memoId && a.memo) {
      const m = a.memo;
      source = {
        type: "memo",
        id: m.id,
        readableId: m.memoId,
        status: m.status,
        date: m.postingDate ?? m.memoDate,
        currencyCode: m.currencyCode,
        direction: m.direction
      };
    }
    if (!source) continue;
    merged.push({
      id: a.id,
      sourceAmount: a.sourceAmount,
      appliedAmount: Number(a.appliedAmount),
      discountAmount: Number(a.discountAmount),
      writeOffAmount: Number(a.writeOffAmount),
      fxGainLossAmount:
        a.fxGainLossAmount == null ? null : Number(a.fxGainLossAmount),
      targetExchangeRate: Number(a.targetExchangeRate),
      sourceExchangeRate: Number(a.sourceExchangeRate),
      appliedDate: a.appliedDate,
      source
    });
  }

  const bySource = new Map<string, InvoiceSettlementForInvoice>();
  for (const row of merged) {
    const key = `${row.source.type}:${row.source.id}:${row.appliedDate}`;
    const previous = bySource.get(key);
    if (!previous) {
      bySource.set(key, { ...row });
      continue;
    }
    previous.appliedAmount = round(previous.appliedAmount + row.appliedAmount);
    previous.discountAmount = round(
      previous.discountAmount + row.discountAmount
    );
    previous.writeOffAmount = round(
      previous.writeOffAmount + row.writeOffAmount
    );
    previous.sourceAmount =
      previous.sourceAmount == null || row.sourceAmount == null
        ? null
        : round(previous.sourceAmount + row.sourceAmount);
    previous.fxGainLossAmount = round(
      Number(previous.fxGainLossAmount ?? 0) + Number(row.fxGainLossAmount ?? 0)
    );
    if (previous.sourceExchangeRate !== row.sourceExchangeRate)
      previous.sourceExchangeRate = null;
  }
  return { data: [...bySource.values()], error: null };
}

// Where a posted credit/debit memo's balance went — the documents it has been
// applied to. The reverse of the invoice "Payments" panel: drives the "Applied To"
// card on the memo detail page so you can see at a glance which invoices a memo
// settled without opening each one. Target is a tagged union (sales/purchase
// invoice, another memo when refunding a balance-increasing memo, or a
// reimbursement — the fourth settlement target column, kept here so the union
// stays total even though nothing writes a memo-sourced reimbursement
// settlement today).
export type MemoApplication = {
  id: string;
  appliedAmount: number;
  appliedDate: string;
  target:
    | { type: "salesInvoice"; id: string; readableId: string }
    | { type: "purchaseInvoice"; id: string; readableId: string }
    | { type: "memo"; id: string; readableId: string }
    | { type: "reimbursement"; id: string; readableId: string };
};

export async function getMemoApplications(
  client: SupabaseClient<Database>,
  companyId: string,
  memoId: string
): Promise<{ data: MemoApplication[] | null; error: unknown }> {
  // Embed the target documents' human-readable ids so the card can link out.
  //
  // Read through `fetchAllFromTable` rather than `client.from(...).select(...)`
  // for the same reason `getInvoiceSettlements` does: its `selectColumns` is a
  // plain `string`, so PostgREST's select-string type parser never runs. With
  // four embeds the inline literal form trips TS2589 ("Type instantiation is
  // excessively deep"). Paging is a free bonus — a heavily applied memo can
  // exceed PostgREST's 1000-row cap.
  type SettlementRow = Pick<
    Database["public"]["Tables"]["invoiceSettlement"]["Row"],
    | "id"
    | "appliedAmount"
    | "appliedDate"
    | "appliedViaPaymentId"
    | "targetSalesInvoiceId"
    | "targetPurchaseInvoiceId"
    | "targetMemoId"
    | "targetReimbursementId"
  > & {
    salesInvoice: { invoiceId: string } | null;
    purchaseInvoice: { invoiceId: string } | null;
    targetMemo: { memoId: string } | null;
    targetReimbursement: { reimbursementId: string } | null;
  };
  const settlements = await fetchAllFromTable<SettlementRow>(
    client,
    "invoiceSettlement",
    "id, appliedAmount, appliedDate, appliedViaPaymentId, targetSalesInvoiceId, targetPurchaseInvoiceId, targetMemoId, targetReimbursementId, salesInvoice:targetSalesInvoiceId(invoiceId), purchaseInvoice:targetPurchaseInvoiceId(invoiceId), targetMemo:targetMemoId(memoId), targetReimbursement:reimbursement!invoiceSettlement_targetReimbursementId_fkey(reimbursementId)",
    (query) =>
      query
        // `memoId` is a bare xid from the URL, so the tenant filter is what
        // decides which company's history a caller can read — exactly as
        // getInvoiceSettlements / getInvoiceSettlementsForInvoice do it. RLS is
        // the backstop, not the gate: it admits every company the caller is an
        // employee of, so without this a multi-company user's memo page would
        // happily render another company's applications.
        .eq("companyId", companyId)
        .eq("memoId", memoId)
        .order("appliedDate", { ascending: false })
        .order("id")
  );

  if (settlements.error) return { data: null, error: settlements.error };
  if (!settlements.data || settlements.data.length === 0)
    return { data: [], error: null };

  // A credit applied through a payment only takes effect once that payment is
  // Posted (mirrors getInvoiceSettlementsForInvoice and the balance views).
  const viaPaymentIds = settlements.data
    .map((s) => s.appliedViaPaymentId)
    .filter((id): id is string => Boolean(id));
  const postedViaPayments =
    viaPaymentIds.length > 0
      ? await client
          .from("payment")
          .select("id")
          .eq("companyId", companyId)
          .in("id", viaPaymentIds)
          .eq("status", "Posted")
      : { data: [] as { id: string }[], error: null };
  if (postedViaPayments.error)
    return { data: null, error: postedViaPayments.error };
  const postedViaSet = new Set(
    ((postedViaPayments.data ?? []) as { id: string }[]).map((p) => p.id)
  );

  const rows: MemoApplication[] = [];
  for (const s of settlements.data) {
    // Staged on a Draft payment — not applied yet, so omit it.
    if (s.appliedViaPaymentId && !postedViaSet.has(s.appliedViaPaymentId))
      continue;

    let target: MemoApplication["target"] | null = null;
    if (s.targetSalesInvoiceId) {
      target = {
        type: "salesInvoice",
        id: s.targetSalesInvoiceId,
        readableId: s.salesInvoice?.invoiceId ?? s.targetSalesInvoiceId
      };
    } else if (s.targetPurchaseInvoiceId) {
      target = {
        type: "purchaseInvoice",
        id: s.targetPurchaseInvoiceId,
        readableId: s.purchaseInvoice?.invoiceId ?? s.targetPurchaseInvoiceId
      };
    } else if (s.targetMemoId) {
      target = {
        type: "memo",
        id: s.targetMemoId,
        readableId: s.targetMemo?.memoId ?? s.targetMemoId
      };
    } else if (s.targetReimbursementId) {
      target = {
        type: "reimbursement",
        id: s.targetReimbursementId,
        readableId:
          s.targetReimbursement?.reimbursementId ?? s.targetReimbursementId
      };
    }
    if (!target) continue;

    rows.push({
      id: s.id,
      appliedAmount: Number(s.appliedAmount),
      appliedDate: s.appliedDate,
      target
    });
  }

  return { data: rows, error: null };
}

/**
 * The documents around a payment or memo, for its Documents panel: the
 * statuses of what it settles, the credits a payment draws (memo settlements
 * applied through it) and what those settle, its posting journal, and a
 * memo's return order. One query per table; ids the caller does not pass are
 * not queried.
 */
export async function getSettlementRelatedItems(
  client: SupabaseClient<Database>,
  companyId: string,
  args: {
    journalId: string | null;
    targets: {
      targetSalesInvoiceId: string | null;
      targetPurchaseInvoiceId: string | null;
      targetMemoId: string | null;
      targetReimbursementId: string | null;
    }[];
    appliedViaPaymentId?: string;
    // The payment is still Draft: credits applied through it are only staged,
    // so what they target is not settled yet (as in getMemoApplications).
    appliedViaPaymentStaged?: boolean;
    salesReturnOrderId?: string | null;
    purchaseReturnOrderId?: string | null;
    /** A rental early-return credit memo's agreement. */
    rentalAgreementId?: string | null;
  }
) {
  const viaPayment = args.appliedViaPaymentId
    ? await client
        .from("invoiceSettlement")
        .select(
          "memoId, targetSalesInvoiceId, targetPurchaseInvoiceId, targetMemoId, targetReimbursementId"
        )
        .eq("companyId", companyId)
        .eq("appliedViaPaymentId", args.appliedViaPaymentId)
    : null;
  if (viaPayment?.error) {
    logger.error("Failed to get credits applied via payment", {
      companyId,
      paymentId: args.appliedViaPaymentId,
      error: viaPayment.error
    });
  }
  const viaRows = viaPayment?.data ?? [];
  const targets = args.appliedViaPaymentStaged
    ? args.targets
    : [...args.targets, ...viaRows];

  const unique = (ids: (string | null | undefined)[]) => [
    ...new Set(ids.filter((id): id is string => Boolean(id)))
  ];
  const salesInvoiceIds = unique(targets.map((t) => t.targetSalesInvoiceId));
  const purchaseInvoiceIds = unique(
    targets.map((t) => t.targetPurchaseInvoiceId)
  );
  const creditIds = unique(viaRows.map((row) => row.memoId));
  const memoIds = unique([...targets.map((t) => t.targetMemoId), ...creditIds]);
  const reimbursementIds = unique(targets.map((t) => t.targetReimbursementId));

  const [
    journal,
    salesInvoices,
    purchaseInvoices,
    memos,
    reimbursements,
    salesReturnOrder,
    purchaseReturnOrder,
    rentalAgreement
  ] = await Promise.all([
    args.journalId
      ? client
          .from("journal")
          .select("id, journalEntryId, status")
          .eq("id", args.journalId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null,
    salesInvoiceIds.length > 0
      ? client
          .from("salesInvoices")
          .select("id, invoiceId, status")
          .in("id", salesInvoiceIds)
          .eq("companyId", companyId)
          .order("invoiceId")
      : null,
    purchaseInvoiceIds.length > 0
      ? client
          .from("purchaseInvoices")
          .select("id, invoiceId, status")
          .in("id", purchaseInvoiceIds)
          .eq("companyId", companyId)
          .order("invoiceId")
      : null,
    memoIds.length > 0
      ? client
          .from("memo")
          .select("id, memoId, status")
          .in("id", memoIds)
          .eq("companyId", companyId)
          .order("memoId")
      : null,
    reimbursementIds.length > 0
      ? client
          .from("reimbursement")
          .select("id, reimbursementId, status")
          .in("id", reimbursementIds)
          .eq("companyId", companyId)
          .order("reimbursementId")
      : null,
    args.salesReturnOrderId
      ? client
          .from("salesReturnOrder")
          .select("id, salesReturnOrderId, status")
          .eq("id", args.salesReturnOrderId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null,
    args.purchaseReturnOrderId
      ? client
          .from("purchaseReturnOrder")
          .select("id, purchaseReturnOrderId, status")
          .eq("id", args.purchaseReturnOrderId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null,
    args.rentalAgreementId
      ? client
          .from("rentalAgreement")
          .select("id, rentalAgreementId, status")
          .eq("id", args.rentalAgreementId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null
  ]);

  const failures = {
    journal,
    salesInvoices,
    purchaseInvoices,
    memos,
    reimbursements,
    salesReturnOrder,
    purchaseReturnOrder,
    rentalAgreement
  };
  for (const [read, result] of Object.entries(failures)) {
    if (result?.error) {
      logger.error("Failed to get settlement related {read}", {
        read,
        companyId,
        error: result.error
      });
    }
  }

  const credits = new Set(creditIds);
  const allMemos = memos?.data ?? [];
  return {
    journal: journal?.data ?? null,
    salesInvoices: salesInvoices?.data ?? [],
    purchaseInvoices: purchaseInvoices?.data ?? [],
    memos: allMemos.filter((memo) => !credits.has(memo.id)),
    credits: allMemos.filter((memo) => credits.has(memo.id)),
    reimbursements: reimbursements?.data ?? [],
    salesReturnOrder: salesReturnOrder?.data ?? null,
    purchaseReturnOrder: purchaseReturnOrder?.data ?? null,
    rentalAgreement: rentalAgreement?.data ?? null
  };
}

// Open sales invoices for a customer (active status and a positive
// balance). Drives the apply table on the AR payment detail.
export async function getOpenSalesInvoicesForCustomer(
  client: SupabaseClient<Database>,
  companyId: string,
  customerId: string,
  currencyCode?: string
) {
  return getOpenInvoicesForParty(
    client,
    companyId,
    true,
    customerId,
    currencyCode
  );
}
export async function getOpenPurchaseInvoicesForSupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierId: string,
  currencyCode?: string
) {
  return getOpenInvoicesForParty(
    client,
    companyId,
    false,
    supplierId,
    currencyCode
  );
}

async function getOpenInvoicesForParty(
  client: SupabaseClient<Database>,
  companyId: string,
  isAR: boolean,
  partyId: string,
  currencyCode?: string
) {
  type OpenInvoiceRow = Pick<
    Database["public"]["Views"]["salesInvoices" | "purchaseInvoices"]["Row"],
    | "id"
    | "invoiceId"
    // dateIssued + paymentTermId drive the early-payment discount window when a
    // payment is seeded from these invoices.
    | "dateIssued"
    | "dateDue"
    | "paymentTermId"
    | "currencyCode"
    | "exchangeRate"
    | "totalAmount"
    | "balance"
    | "status"
  >;
  type SettlementRow = SettlementBalanceRow & {
    paymentId: string | null;
    memoId: string | null;
    appliedViaPaymentId: string | null;
    payment: { status: string } | null;
    memo: { status: string } | null;
    appliedViaPayment: { status: string } | null;
  };
  type ControlRow = Pick<
    Database["public"]["Tables"]["journalLine"]["Row"],
    "documentId" | "amount"
  >;
  type DocumentLineRow = Pick<
    Database["public"]["Tables"]["salesInvoiceLine"]["Row"],
    "invoiceId" | "rentalAgreementId" | "salesOrderId"
  >;
  const [invoices, company] = await Promise.all([
    fetchAllFromTable<OpenInvoiceRow>(
      client,
      isAR ? "salesInvoices" : "purchaseInvoices",
      "id, invoiceId, dateIssued, dateDue, paymentTermId, currencyCode, exchangeRate, totalAmount, balance, status",
      (query) => {
        query = query
          .eq("companyId", companyId)
          .in(
            "status",
            isAR
              ? ["Submitted", "Partially Paid", "Overdue"]
              : ["Open", "Partially Paid", "Overdue"]
          )
          .eq(isAR ? "customerId" : "supplierId", partyId);
        if (currencyCode) query = query.eq("currencyCode", currencyCode);
        return query.order("dateDue", { ascending: true }).order("id");
      }
    ),
    client.from("company").select("companyGroupId").eq("id", companyId).single()
  ]);
  if (invoices.error) return { data: null, error: invoices.error };
  if (company.error || !company.data?.companyGroupId)
    return {
      data: null,
      error: { message: "Company currency configuration is missing" }
    };
  const currencies = await client
    .from("currency")
    .select("code, decimalPlaces")
    .eq("companyGroupId", company.data.companyGroupId);
  if (currencies.error) return { data: null, error: currencies.error };
  const ids = invoices.data.map((i) => i.id!);
  const settlements: SettlementRow[] = [];
  const controls: ControlRow[] = [];
  const documentLines: DocumentLineRow[] = [];
  // Bound filter URLs as well as response pages. A single invoice can itself
  // have more than one response page of control lines or settlements.
  for (const batch of chunkArray(ids, 100)) {
    const [batchSettlements, batchControls, batchDocumentLines] =
      await Promise.all([
        fetchAllFromTable<SettlementRow>(
          client,
          "invoiceSettlement",
          "paymentId, memoId, targetSalesInvoiceId, targetPurchaseInvoiceId, sourceAmount, appliedAmount, discountAmount, writeOffAmount, appliedViaPaymentId, payment:payment!invoiceSettlement_paymentId_fkey(status), memo:memo!invoiceSettlement_memoId_fkey(status), appliedViaPayment:payment!invoiceSettlement_appliedViaPaymentId_fkey(status)",
          (query) =>
            query
              .eq("companyId", companyId)
              .in(
                isAR ? "targetSalesInvoiceId" : "targetPurchaseInvoiceId",
                batch
              )
              .order("id")
        ),
        fetchAllFromTable<ControlRow>(
          client,
          "journalLine",
          "documentId, amount, journal:journalId!inner(status,sourceType,companyId)",
          (query) =>
            query
              .eq("companyId", companyId)
              .eq("journal.companyId", companyId)
              .eq("journal.status", "Posted")
              .eq(
                "journal.sourceType",
                isAR ? "Sales Invoice" : "Purchase Invoice"
              )
              .eq("documentType", "Invoice")
              .in(
                "description",
                isAR
                  ? RECEIVABLE_POSTING_DESCRIPTIONS
                  : PAYABLE_POSTING_DESCRIPTIONS
              )
              .in("documentId", batch)
              .order("id")
        ),
        // The documents each invoice bills: a customer deposit funds only an
        // invoice of its own rental agreement or sales order.
        isAR
          ? fetchAllFromTable<DocumentLineRow>(
              client,
              "salesInvoiceLine",
              "invoiceId, rentalAgreementId, salesOrderId",
              (query) =>
                query
                  .eq("companyId", companyId)
                  .in("invoiceId", batch)
                  .or("rentalAgreementId.not.is.null,salesOrderId.not.is.null")
                  .order("id")
            )
          : { data: [] as DocumentLineRow[], error: null }
      ]);
    const error =
      batchSettlements.error ?? batchControls.error ?? batchDocumentLines.error;
    if (error) return { data: null, error };
    settlements.push(...(batchSettlements.data ?? []));
    controls.push(...(batchControls.data ?? []));
    documentLines.push(...(batchDocumentLines.data ?? []));
  }
  const documentsByInvoice = new Map<
    string,
    { rentalAgreementIds: string[]; salesOrderIds: string[] }
  >();
  for (const line of documentLines) {
    const documents = documentsByInvoice.get(line.invoiceId) ?? {
      rentalAgreementIds: [],
      salesOrderIds: []
    };
    if (
      line.rentalAgreementId &&
      !documents.rentalAgreementIds.includes(line.rentalAgreementId)
    )
      documents.rentalAgreementIds.push(line.rentalAgreementId);
    if (
      line.salesOrderId &&
      !documents.salesOrderIds.includes(line.salesOrderId)
    )
      documents.salesOrderIds.push(line.salesOrderId);
    documentsByInvoice.set(line.invoiceId, documents);
  }
  try {
    const decimals = new Map(
      (currencies.data ?? []).map((c) => [c.code, c.decimalPlaces])
    );
    if (currencyCode) requireCurrencyDecimals(decimals, currencyCode);
    const effective = settlements.filter((s) =>
      isEffectiveSettlement({
        paymentId: s.paymentId,
        memoId: s.memoId,
        appliedViaPaymentId: s.appliedViaPaymentId,
        paymentStatus: s.payment?.status ?? null,
        memoStatus: s.memo?.status ?? null,
        viaStatus: s.appliedViaPayment?.status ?? null
      })
    );
    const controlAmounts = new Map<string, number>();
    for (const line of controls)
      if (line.documentId)
        controlAmounts.set(
          line.documentId,
          (controlAmounts.get(line.documentId) ?? 0) + Number(line.amount)
        );
    return {
      data: (invoices.data ?? [])
        .map((i) => {
          if (!i.id || !i.currencyCode)
            throw new Error("Invoice currency or identity is missing");
          const remaining = invoiceRemainingAmounts(
            i,
            effective,
            controlAmounts,
            requireCurrencyDecimals(decimals, i.currencyCode!),
            isAR
          );
          return {
            ...i,
            id: i.id,
            currencyCode: i.currencyCode,
            balance: remaining.remainingBase,
            remainingDocument: remaining.remainingDocument,
            rentalAgreementIds:
              documentsByInvoice.get(i.id)?.rentalAgreementIds ?? [],
            salesOrderIds: documentsByInvoice.get(i.id)?.salesOrderIds ?? []
          };
        })
        .filter((i) => i.remainingDocument > 0),
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Unable to load invoice balances"
      }
    };
  }
}

/**
 * Posted reimbursements an employee is still owed money on — the apply table's
 * target list when a payment's payee is an employee, and the source of the
 * balance the Pay expense modal defaults to.
 *
 * The supabase-client counterpart of `loadTransactionReimbursements`: same
 * arithmetic (`invoiceRemainingAmounts` with `isReimbursement`), same control
 * lookup, but a read rather than a `FOR UPDATE` lock — the transactional
 * version stays the authority, this one only decides what to offer.
 *
 * `reimbursement.amount` is DOCUMENT currency (there is no base-currency total
 * column), so it is converted once here; `invoiceRemainingAmounts` wants a base
 * total and converts back itself.
 */
export async function getOpenReimbursementsForEmployee(
  client: SupabaseClient<Database>,
  companyId: string,
  employeeId: string,
  currencyCode?: string
): Promise<{
  data:
    | {
        id: string;
        reimbursementId: string;
        reimbursementDate: string;
        currencyCode: string;
        exchangeRate: number;
        totalAmount: number;
        balance: number;
        remainingDocument: number;
      }[]
    | null;
  error: unknown;
}> {
  type ReimbursementRow = Pick<
    Database["public"]["Tables"]["reimbursement"]["Row"],
    | "id"
    | "reimbursementId"
    | "reimbursementDate"
    | "currencyCode"
    | "exchangeRate"
    | "amount"
  >;
  type SettlementRow = SettlementBalanceRow & {
    paymentId: string | null;
    memoId: string | null;
    appliedViaPaymentId: string | null;
    payment: { status: string } | null;
  };
  type ControlRow = Pick<
    Database["public"]["Tables"]["journalLine"]["Row"],
    "documentId" | "amount"
  >;
  const [reimbursements, company] = await Promise.all([
    fetchAllFromTable<ReimbursementRow>(
      client,
      "reimbursement",
      "id, reimbursementId, reimbursementDate, currencyCode, exchangeRate, amount",
      (query) => {
        query = query
          .eq("companyId", companyId)
          .eq("employeeId", employeeId)
          // Only a Posted reimbursement has a booked payable to settle.
          .eq("status", "Posted");
        if (currencyCode) query = query.eq("currencyCode", currencyCode);
        return query
          .order("reimbursementDate", { ascending: true })
          .order("id");
      }
    ),
    client.from("company").select("companyGroupId").eq("id", companyId).single()
  ]);
  if (reimbursements.error) return { data: null, error: reimbursements.error };
  if (company.error || !company.data?.companyGroupId)
    return {
      data: null,
      error: { message: "Company currency configuration is missing" }
    };
  if (!reimbursements.data.length) return { data: [], error: null };
  const currencies = await client
    .from("currency")
    .select("code, decimalPlaces")
    .eq("companyGroupId", company.data.companyGroupId);
  if (currencies.error) return { data: null, error: currencies.error };
  const ids = reimbursements.data.map((r) => r.id);
  const settlements: SettlementRow[] = [];
  const controls: ControlRow[] = [];
  // Bound the filter URL as well as the response pages, exactly as the invoice
  // reader does — one reimbursement can own more than a page of either.
  for (const batch of chunkArray(ids, 100)) {
    const [batchSettlements, batchControls] = await Promise.all([
      fetchAllFromTable<SettlementRow>(
        client,
        "invoiceSettlement",
        "paymentId, memoId, targetSalesInvoiceId, targetPurchaseInvoiceId, targetReimbursementId, sourceAmount, appliedAmount, discountAmount, writeOffAmount, appliedViaPaymentId, payment:payment!invoiceSettlement_paymentId_fkey(status)",
        (query) =>
          query
            .eq("companyId", companyId)
            .in("targetReimbursementId", batch)
            .order("id")
      ),
      fetchAllFromTable<ControlRow>(
        client,
        "journalLine",
        "documentId, amount, journal:journalId!inner(status,sourceType,companyId)",
        (query) =>
          query
            .eq("companyId", companyId)
            .eq("journal.companyId", companyId)
            .eq("journal.status", "Posted")
            .eq("journal.sourceType", "Reimbursement")
            .eq("documentType", "Reimbursement")
            .eq("description", REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION)
            .in("documentId", batch)
            .order("id")
      )
    ]);
    const error = batchSettlements.error ?? batchControls.error;
    if (error) return { data: null, error };
    settlements.push(...(batchSettlements.data ?? []));
    controls.push(...(batchControls.data ?? []));
  }
  try {
    const decimals = new Map(
      (currencies.data ?? []).map((c) => [c.code, c.decimalPlaces])
    );
    // A reimbursement is never settled by a memo, so a Posted payment is the
    // only source that can have taken effect.
    const effective = settlements.filter((s) =>
      isEffectiveSettlement({
        paymentId: s.paymentId,
        memoId: s.memoId,
        appliedViaPaymentId: s.appliedViaPaymentId,
        paymentStatus: s.payment?.status ?? null,
        memoStatus: null,
        viaStatus: null
      })
    );
    const controlAmounts = new Map<string, number>();
    for (const line of controls)
      if (line.documentId)
        controlAmounts.set(
          line.documentId,
          (controlAmounts.get(line.documentId) ?? 0) + Number(line.amount)
        );
    return {
      data: reimbursements.data
        .map((r) => {
          const rate = Number(r.exchangeRate);
          const totalAmount = toBaseAmount(Number(r.amount), rate);
          const remaining = invoiceRemainingAmounts(
            { id: r.id, totalAmount, exchangeRate: rate },
            effective,
            controlAmounts,
            requireCurrencyDecimals(decimals, r.currencyCode),
            false,
            true
          );
          return {
            id: r.id,
            reimbursementId: r.reimbursementId,
            reimbursementDate: r.reimbursementDate,
            currencyCode: r.currencyCode,
            exchangeRate: rate,
            totalAmount,
            balance: remaining.remainingBase,
            remainingDocument: remaining.remainingDocument
          };
        })
        .filter((r) => r.remainingDocument > 0),
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Unable to load reimbursement balances"
      }
    };
  }
}

type PaymentPartyOf =
  | { paymentType: "Receipt"; customerId: string }
  | { paymentType: "Disbursement"; supplierId: string };

function requireCurrencyDecimals(
  decimals: Map<string, number>,
  code: string
): number {
  const value = decimals.get(code);
  if (value == null || !Number.isInteger(value) || value < 0) {
    throw new Error(`Currency ${code} requires configured decimal places`);
  }
  assertCurrencyDecimals(value);
  return value;
}

export async function getPaymentCurrencyConfiguration(
  client: SupabaseClient<Database>,
  companyId: string,
  currencyCode: string
): Promise<{ baseCurrencyCode: string; currencyDecimals: number }> {
  const company = await client
    .from("company")
    .select("companyGroupId, baseCurrencyCode")
    .eq("id", companyId)
    .single();
  if (
    company.error ||
    !company.data?.companyGroupId ||
    !company.data.baseCurrencyCode
  ) {
    throw new Error("Company currency configuration is missing");
  }
  const currencies = await client
    .from("currency")
    .select("code, decimalPlaces")
    .eq("companyGroupId", company.data.companyGroupId)
    .eq("code", currencyCode);
  if (currencies.error) throw new Error(currencies.error.message);
  return {
    baseCurrencyCode: company.data.baseCurrencyCode,
    currencyDecimals: requireCurrencyDecimals(
      new Map((currencies.data ?? []).map((c) => [c.code, c.decimalPlaces])),
      currencyCode
    )
  };
}

async function loadOnAccountSources(
  client: SupabaseClient<Database>,
  companyId: string,
  party: PaymentPartyOf,
  currencyCode?: string
) {
  type OnAccountPaymentRow = FundingPaymentRow & {
    rentalAgreementId: string | null;
    salesOrderId: string | null;
    depositAgreement: { readableId: string } | null;
    depositOrder: { readableId: string } | null;
  };
  const [payments, company] = await Promise.all([
    fetchAllFromTable<OnAccountPaymentRow>(
      client,
      "payment",
      // A deposit's document comes along with its readable id so the composer
      // can say which document the deposit is reserved for.
      "id, totalAmount, exchangeRate, postingDate, paymentDate, currencyCode, rentalAgreementId, salesOrderId, depositAgreement:rentalAgreement!payment_rentalAgreementId_fkey(readableId:rentalAgreementId), depositOrder:salesOrder!payment_salesOrderId_fkey(readableId:salesOrderId)",
      (query) => {
        query = query
          .eq("companyId", companyId)
          .eq("status", "Posted")
          .eq("paymentType", party.paymentType);
        query =
          party.paymentType === "Receipt"
            ? query.eq("customerId", party.customerId)
            : query.eq("supplierId", party.supplierId);
        if (currencyCode) query = query.eq("currencyCode", currencyCode);
        return query.order("id");
      }
    ),
    client.from("company").select("companyGroupId").eq("id", companyId).single()
  ]);
  if (payments.error) throw new Error(payments.error.message);
  if (company.error || !company.data?.companyGroupId)
    throw new Error("Company currency configuration is missing");
  const currencies = await client
    .from("currency")
    .select("code, decimalPlaces")
    .eq("companyGroupId", company.data.companyGroupId);
  if (currencies.error) throw new Error(currencies.error.message);
  const decimals = new Map(
    (currencies.data ?? []).map((c) => [c.code, c.decimalPlaces])
  );
  if (currencyCode) requireCurrencyDecimals(decimals, currencyCode);
  if (!payments.data.length)
    return { sources: [] as FundingSource[], decimals };
  // Filter through the applying parent instead of sending an unbounded source-ID
  // list in the URL. Every valid use of prior funding has the same party/currency.
  const apps = await fetchAllFromTable<
    FundingConsumptionRow & { payment: { status: string } | null }
  >(
    client,
    "invoiceSettlement",
    "paymentId, sourcePaymentId, sourceAmount, appliedAmount, fxGainLossAmount, payment:payment!invoiceSettlement_paymentId_fkey!inner(status)",
    (query) => {
      query = query
        .eq("companyId", companyId)
        .eq("payment.companyId", companyId)
        .eq("payment.status", "Posted")
        .eq("payment.paymentType", party.paymentType);
      query =
        party.paymentType === "Receipt"
          ? query.eq("payment.customerId", party.customerId)
          : query.eq("payment.supplierId", party.supplierId);
      if (currencyCode) query = query.eq("payment.currencyCode", currencyCode);
      return query.order("id");
    }
  );
  if (apps.error) throw new Error(apps.error.message);
  const effective = (apps.data ?? []).filter(
    (a) => a.payment?.status === "Posted"
  );
  const isAR = party.paymentType === "Receipt";
  return {
    sources: remainingFundingSources(
      (payments.data ?? []).map((payment) => {
        const scope = isAR ? fundingScopeOf(payment) : null;
        return {
          ...payment,
          scope: scope && {
            ...scope,
            readableId:
              (scope.type === "rentalAgreement"
                ? payment.depositAgreement?.readableId
                : payment.depositOrder?.readableId) ?? null
          }
        };
      }),
      effective,
      decimals,
      isAR
    ),
    decimals
  };
}

/** On-account credit funds any invoice; a deposit only its own document's. */
function onAccountOnly(sources: FundingSource[]): FundingSource[] {
  return sources.filter((source) => !source.scope);
}

export async function getAvailableOnAccountCreditSources(
  client: SupabaseClient<Database>,
  companyId: string,
  party: PaymentPartyOf,
  currencyCode: string
): Promise<{
  data: {
    sources: FundingSource[];
    availableDocumentAmount: number;
    availableBaseAmount: number;
  } | null;
  error: { message: string } | null;
}> {
  try {
    const { sources, decimals } = await loadOnAccountSources(
      client,
      companyId,
      party,
      currencyCode
    );
    // `sources` keeps deposits (each carries its `scope`) for the allocator;
    // the totals are on-account credit only, which any invoice can draw on.
    const credit = onAccountOnly(sources);
    return {
      data: {
        sources,
        availableDocumentAmount: toDocumentAmount(
          credit.reduce((sum, p) => sum + p.remainingDocument, 0),
          1,
          requireCurrencyDecimals(decimals, currencyCode)
        ),
        availableBaseAmount: round(
          credit.reduce((sum, p) => sum + p.remainingBase, 0)
        )
      },
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Unable to load payment funding"
      }
    };
  }
}

/**
 * Base-total contract for other readers; the composer uses typed document sources.
 */
export async function getAvailableOnAccountCredit(
  client: SupabaseClient<Database>,
  companyId: string,
  party: PaymentPartyOf
): Promise<number> {
  try {
    const { sources } = await loadOnAccountSources(client, companyId, party);
    return round(
      onAccountOnly(sources).reduce((sum, p) => sum + p.remainingBase, 0)
    );
  } catch {
    return 0;
  }
}

export async function upsertPayment(
  client: SupabaseClient<Database>,
  payment:
    | (Omit<z.infer<typeof paymentValidator>, "id" | "paymentId"> & {
        paymentId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof paymentValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in payment) {
    return client
      .from("payment")
      .insert([
        {
          ...sanitize(payment),
          customerId: payment.customerId ?? null,
          supplierId: payment.supplierId ?? null,
          salesOrderId: payment.salesOrderId ?? null,
          rentalAgreementId: payment.rentalAgreementId ?? null,
          employeeId: payment.employeeId ?? null
        }
      ])
      .select("id, paymentId")
      .single();
  }
  return client
    .from("payment")
    .update({
      ...sanitize(payment),
      customerId: payment.customerId ?? null,
      supplierId: payment.supplierId ?? null,
      salesOrderId: payment.salesOrderId ?? null,
      rentalAgreementId: payment.rentalAgreementId ?? null,
      // Explicit null, like the two trade parties: switching a Draft payment's
      // payee must CLEAR the other two, or the widened one-of-three CHECK
      // rejects the update.
      employeeId: payment.employeeId ?? null
    })
    .eq("id", payment.id)
    .select("id, paymentId")
    .single();
}

// RLS DELETE policy on payment restricts to status='Draft'.
export async function deletePayment(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("payment")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function upsertInvoiceSettlement(
  client: SupabaseClient<Database>,
  app:
    | (Omit<z.infer<typeof invoiceSettlementValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof invoiceSettlementValidator>, "id"> & {
        id: string;
      })
) {
  if ("createdBy" in app) {
    return client
      .from("invoiceSettlement")
      .insert([sanitize(app)])
      .select("id")
      .single();
  }
  return client
    .from("invoiceSettlement")
    .update(sanitize(app))
    .eq("id", app.id)
    .select("id")
    .single();
}

// RLS DELETE policy requires parent payment.status='Draft'.
export async function deleteInvoiceSettlement(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("invoiceSettlement").delete().eq("id", id);
}

// Replace-all for the apply table. The delete + insert run in a single
// transaction so a failed insert can never leave the payment with its
// applications wiped and nothing in their place. Kysely bypasses RLS, so we
// re-assert the payment is Draft inside the txn — the FOR UPDATE lock also
// serializes this against a concurrent post/void of the same payment.
async function loadTransactionCurrency(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  code: string
) {
  const company = await db
    .selectFrom("company")
    .select(["companyGroupId", "baseCurrencyCode"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company?.companyGroupId)
    throw new Error("Company currency configuration is missing");
  const currencies = await db
    .selectFrom("currency")
    .select(["code", "decimalPlaces"])
    .where("companyGroupId", "=", company.companyGroupId)
    .execute();
  const decimals = new Map(currencies.map((c) => [c.code, c.decimalPlaces]));
  return {
    decimals,
    currencyDecimals: requireCurrencyDecimals(decimals, code)
  };
}

async function loadTransactionInvoices(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  ids: string[],
  isAR: boolean,
  currencyCode: string,
  partyId: string,
  decimals: number
) {
  const view = isAR ? "salesInvoices" : "purchaseInvoices";
  const targetColumn = isAR
    ? "invoiceSettlement.targetSalesInvoiceId"
    : "invoiceSettlement.targetPurchaseInvoiceId";
  const invoices = isAR
    ? await db
        .selectFrom("salesInvoice")
        .select([
          "id",
          "status",
          "exchangeRate",
          "currencyCode",
          "customerId as partyId"
        ])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .orderBy("id")
        .forUpdate()
        .execute()
    : await db
        .selectFrom("purchaseInvoice")
        .select([
          "id",
          "status",
          "exchangeRate",
          "currencyCode",
          "supplierId as partyId"
        ])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .orderBy("id")
        .forUpdate()
        .execute();
  for (const id of ids) {
    const invoice = invoices.find((i) => i.id === id);
    if (!invoice) throw new Error(`Invoice ${id} not found`);
    if (invoice.partyId !== partyId)
      throw new Error("A payment can only settle invoices for the same party");
    if (invoice.currencyCode !== currencyCode)
      throw new Error("Invoice and payment currency must match");
    if (
      !(
        isAR
          ? ["Submitted", "Partially Paid", "Overdue"]
          : ["Open", "Partially Paid", "Overdue"]
      ).includes(invoice.status)
    )
      throw new Error(`Invoice ${id} is not open`);
    assertExchangeRate(Number(invoice.exchangeRate));
  }
  const [totals, settlements, controls] = await Promise.all([
    db
      .selectFrom(view)
      .select(["id", "totalAmount", "exchangeRate"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute(),
    db
      .selectFrom("invoiceSettlement")
      .leftJoin(
        "payment as applyingPayment",
        "applyingPayment.id",
        "invoiceSettlement.paymentId"
      )
      .leftJoin(
        "memo as sourceMemo",
        "sourceMemo.id",
        "invoiceSettlement.memoId"
      )
      .leftJoin(
        "payment as viaPayment",
        "viaPayment.id",
        "invoiceSettlement.appliedViaPaymentId"
      )
      .select([
        "invoiceSettlement.targetSalesInvoiceId",
        "invoiceSettlement.targetPurchaseInvoiceId",
        "invoiceSettlement.sourceAmount",
        "invoiceSettlement.appliedAmount",
        "invoiceSettlement.discountAmount",
        "invoiceSettlement.writeOffAmount"
      ])
      .where("invoiceSettlement.companyId", "=", companyId)
      .where(targetColumn, "in", ids)
      .where((eb) =>
        eb.or([
          eb.and([
            eb("applyingPayment.companyId", "=", companyId),
            eb("applyingPayment.status", "=", "Posted")
          ]),
          eb.and([
            eb("sourceMemo.companyId", "=", companyId),
            eb("sourceMemo.status", "=", "Posted"),
            eb.or([
              eb("invoiceSettlement.appliedViaPaymentId", "is", null),
              eb.and([
                eb("viaPayment.companyId", "=", companyId),
                eb("viaPayment.status", "=", "Posted")
              ])
            ])
          ])
        ])
      )
      .execute(),
    db
      .selectFrom("journalLine")
      .innerJoin("journal", "journal.id", "journalLine.journalId")
      .select(["journalLine.documentId", "journalLine.amount"])
      .where("journalLine.companyId", "=", companyId)
      .where("journal.companyId", "=", companyId)
      .where("journal.status", "=", "Posted")
      .where(
        "journal.sourceType",
        "=",
        isAR ? "Sales Invoice" : "Purchase Invoice"
      )
      .where("journalLine.documentType", "=", "Invoice")
      .where(
        "journalLine.description",
        "in",
        isAR ? RECEIVABLE_POSTING_DESCRIPTIONS : PAYABLE_POSTING_DESCRIPTIONS
      )
      .where("journalLine.documentId", "in", ids)
      .execute()
  ]);
  const controlAmounts = new Map<string, number>();
  for (const line of controls)
    if (line.documentId)
      controlAmounts.set(
        line.documentId,
        (controlAmounts.get(line.documentId) ?? 0) + Number(line.amount)
      );
  return new Map(
    totals.map((i) => [
      i.id!,
      {
        ...invoiceRemainingAmounts(
          i,
          settlements,
          controlAmounts,
          decimals,
          isAR
        ),
        exchangeRate: Number(i.exchangeRate)
      }
    ])
  );
}

/**
 * The reimbursement counterpart of `loadTransactionInvoices`. A Posted
 * reimbursement is a TARGET exactly like a payable invoice — a liability whose
 * carrying value prior payouts draw down — so the balance arithmetic is the
 * shared `invoiceRemainingAmounts`, with only the target column and the
 * original-control lookup differing.
 *
 * `reimbursement.amount` is DOCUMENT currency (the `reimbursement` table has no
 * base-currency total column, unlike the `salesInvoices`/`purchaseInvoices`
 * views), so it is converted once here — `invoiceRemainingAmounts` expects a
 * base-currency `totalAmount` and converts back to document itself.
 */
async function loadTransactionReimbursements(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  ids: string[],
  currencyCode: string,
  employeeId: string,
  decimals: number
) {
  const reimbursements = await db
    .selectFrom("reimbursement")
    .select([
      "id",
      "status",
      "exchangeRate",
      "currencyCode",
      "amount",
      "employeeId"
    ])
    .where("companyId", "=", companyId)
    .where("id", "in", ids)
    .orderBy("id")
    .forUpdate()
    .execute();
  for (const id of ids) {
    const reimbursement = reimbursements.find((r) => r.id === id);
    if (!reimbursement) throw new Error(`Reimbursement ${id} not found`);
    if (reimbursement.employeeId !== employeeId)
      throw new Error(
        "A payment can only settle reimbursements for the same employee"
      );
    if (reimbursement.currencyCode !== currencyCode)
      throw new Error("Reimbursement and payment currency must match");
    // Only a Posted reimbursement has a booked payable to settle; a Draft has
    // no journal and a Voided one has been reversed.
    if (reimbursement.status !== "Posted")
      throw new Error(`Reimbursement ${id} is not posted`);
    assertExchangeRate(Number(reimbursement.exchangeRate));
  }
  const [settlements, controls] = await Promise.all([
    db
      .selectFrom("invoiceSettlement")
      .innerJoin(
        "payment as applyingPayment",
        "applyingPayment.id",
        "invoiceSettlement.paymentId"
      )
      .select([
        "invoiceSettlement.targetSalesInvoiceId",
        "invoiceSettlement.targetPurchaseInvoiceId",
        "invoiceSettlement.targetReimbursementId",
        "invoiceSettlement.sourceAmount",
        "invoiceSettlement.appliedAmount",
        "invoiceSettlement.discountAmount",
        "invoiceSettlement.writeOffAmount"
      ])
      .where("invoiceSettlement.companyId", "=", companyId)
      .where("invoiceSettlement.targetReimbursementId", "in", ids)
      // A reimbursement is never settled by a memo, so a posted payment is the
      // only source that can have taken effect.
      .where("applyingPayment.companyId", "=", companyId)
      .where("applyingPayment.status", "=", "Posted")
      .execute(),
    db
      .selectFrom("journalLine")
      .innerJoin("journal", "journal.id", "journalLine.journalId")
      .select(["journalLine.documentId", "journalLine.amount"])
      .where("journalLine.companyId", "=", companyId)
      .where("journal.companyId", "=", companyId)
      .where("journal.status", "=", "Posted")
      .where("journal.sourceType", "=", "Reimbursement")
      .where("journalLine.documentType", "=", "Reimbursement")
      .where(
        "journalLine.description",
        "=",
        REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION
      )
      .where("journalLine.documentId", "in", ids)
      .execute()
  ]);
  const controlAmounts = new Map<string, number>();
  for (const line of controls)
    if (line.documentId)
      controlAmounts.set(
        line.documentId,
        (controlAmounts.get(line.documentId) ?? 0) + Number(line.amount)
      );
  return new Map(
    reimbursements.map((r) => [
      r.id,
      {
        ...invoiceRemainingAmounts(
          {
            id: r.id,
            totalAmount: toBaseAmount(Number(r.amount), Number(r.exchangeRate)),
            exchangeRate: Number(r.exchangeRate)
          },
          settlements,
          controlAmounts,
          decimals,
          false,
          true
        ),
        exchangeRate: Number(r.exchangeRate)
      }
    ])
  );
}

/** Reserve both invoice applications and refunds against the same locked memo. */
async function loadTransactionMemoConsumption(
  trx: Kysely<KyselyDatabase>,
  companyId: string,
  memoIds: string[],
  excludePaymentId: string
) {
  return trx
    .selectFrom("invoiceSettlement")
    .leftJoin("payment as viaPayment", (join) =>
      join
        .onRef("viaPayment.id", "=", "invoiceSettlement.appliedViaPaymentId")
        .onRef("viaPayment.companyId", "=", "invoiceSettlement.companyId")
    )
    .leftJoin("payment as refund", (join) =>
      join
        .onRef("refund.id", "=", "invoiceSettlement.paymentId")
        .onRef("refund.companyId", "=", "invoiceSettlement.companyId")
    )
    .select([
      "invoiceSettlement.memoId",
      "invoiceSettlement.targetMemoId",
      "invoiceSettlement.sourceAmount",
      "invoiceSettlement.appliedAmount",
      "invoiceSettlement.fxGainLossAmount"
    ])
    .where("invoiceSettlement.companyId", "=", companyId)
    .where((eb) =>
      eb.or([
        eb.and([
          eb("invoiceSettlement.memoId", "in", memoIds),
          eb.or([
            eb("invoiceSettlement.appliedViaPaymentId", "is", null),
            eb.and([
              eb(
                "invoiceSettlement.appliedViaPaymentId",
                "!=",
                excludePaymentId
              ),
              eb("viaPayment.status", "in", ["Draft", "Posted"])
            ])
          ])
        ]),
        eb.and([
          eb("invoiceSettlement.targetMemoId", "in", memoIds),
          eb("invoiceSettlement.paymentId", "!=", excludePaymentId),
          eb("refund.status", "in", ["Draft", "Posted"])
        ])
      ])
    )
    .execute();
}

export async function replaceInvoiceSettlements(
  db: Kysely<KyselyDatabase>,
  args: {
    paymentId: string;
    companyId: string;
    createdBy: string;
    applications: Omit<
      z.infer<typeof invoiceSettlementValidator>,
      "id" | "paymentId"
    >[];
  }
) {
  return db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom("payment")
      .selectAll()
      .where("id", "=", args.paymentId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "Draft")
      throw new Error(
        "Applications can only be edited while the payment is Draft"
      );
    const { decimals, currencyDecimals } = await loadTransactionCurrency(
      trx,
      args.companyId,
      payment.currencyCode
    );
    assertExchangeRate(Number(payment.exchangeRate));
    const isAR = Boolean(payment.customerId);
    const cashIn = payment.paymentType === "Receipt";
    // An employee payee is a reimbursement payout, never a trade settlement:
    // it is always cash OUT against the employee-payable control account, so
    // it is neither AR nor a refund and has no on-account credit history to
    // draw on. Resolve it BEFORE the customer-XOR-supplier check, which a
    // three-way party can no longer satisfy.
    const isReimbursement = Boolean(payment.employeeId);
    const isRefund = !isReimbursement && cashIn !== isAR;
    const partyId = isReimbursement
      ? payment.employeeId
      : isAR
        ? payment.customerId
        : payment.supplierId;
    if (
      !partyId ||
      [payment.customerId, payment.supplierId, payment.employeeId].filter(
        Boolean
      ).length !== 1
    )
      throw new Error(
        "A payment requires exactly one party (customer, supplier, or employee)"
      );
    if (isReimbursement && cashIn)
      throw new Error("An employee payment must be a disbursement");
    for (const app of args.applications) {
      if (
        app.sourceAmount != null &&
        toDocumentAmount(app.sourceAmount, 1, currencyDecimals) !==
          app.sourceAmount
      ) {
        throw new Error("Source amount exceeds document currency precision");
      }
      if ("sourcePaymentId" in app || "fxGainLossAmount" in app || app.memoId)
        throw new Error("Funding source and FX are server-authoritative");
      if (app.sourceExchangeRate !== Number(payment.exchangeRate))
        throw new Error("Source exchange rate does not match the payment");
      // A reimbursement payout takes no trade discount and no write-off —
      // there is no negotiated settlement with an employee, and the AP
      // discount/write-off accounts are supplier-scoped by class.
      if (
        isReimbursement &&
        (!app.targetReimbursementId ||
          app.targetSalesInvoiceId ||
          app.targetPurchaseInvoiceId ||
          app.targetMemoId ||
          app.discountAmount !== 0 ||
          app.writeOffAmount !== 0)
      )
        throw new Error(
          "An employee payment targets reimbursements only, without discounts or write-offs"
        );
      if (
        !isReimbursement &&
        (isRefund
          ? !app.targetMemoId ||
            app.targetSalesInvoiceId ||
            app.targetPurchaseInvoiceId ||
            app.targetReimbursementId ||
            app.discountAmount !== 0 ||
            app.writeOffAmount !== 0
          : app.targetMemoId ||
            app.targetReimbursementId ||
            (isAR
              ? !app.targetSalesInvoiceId || app.targetPurchaseInvoiceId
              : !app.targetPurchaseInvoiceId || app.targetSalesInvoiceId))
      )
        throw new Error(
          "Payments target same-side invoices; refunds target reducing memos without adjustments"
        );
    }
    if (isReimbursement) {
      const ids = [
        ...new Set(args.applications.map((app) => app.targetReimbursementId!))
      ].sort();
      if (!ids.length) {
        await trx
          .deleteFrom("invoiceSettlement")
          .where("paymentId", "=", args.paymentId)
          .where("companyId", "=", args.companyId)
          .execute();
        return;
      }
      const reimbursements = await loadTransactionReimbursements(
        trx,
        args.companyId,
        ids,
        payment.currencyCode,
        partyId,
        currencyDecimals
      );
      const requests = new Map<string, FundingRequest>();
      const dates = new Map<string, string>();
      for (const app of args.applications) {
        const id = app.targetReimbursementId!;
        const target = reimbursements.get(id);
        if (!target) throw new Error(`Reimbursement ${id} balance not found`);
        if (app.targetExchangeRate !== target.exchangeRate)
          throw new Error(
            "Target exchange rate does not match the reimbursement"
          );
        // Paying the balance in full releases the exact document remainder, so
        // a payout never strands a minor unit the base-rounded conversion
        // would leave behind.
        const sourceAmount =
          app.sourceAmount ??
          (app.appliedAmount === target.remainingBase
            ? target.remainingDocument
            : toDocumentAmount(
                app.appliedAmount,
                target.exchangeRate,
                currencyDecimals
              ));
        const request = requests.get(id) ?? {
          targetId: id,
          targetExchangeRate: target.exchangeRate,
          remainingDocument: target.remainingDocument,
          remainingBase: target.remainingBase,
          requestedDocumentPrincipal: 0,
          discountAmount: 0,
          writeOffAmount: 0
        };
        request.requestedDocumentPrincipal = toDocumentAmount(
          request.requestedDocumentPrincipal + sourceAmount,
          1,
          currencyDecimals
        );
        requests.set(id, request);
        dates.set(id, app.appliedDate);
      }
      const allocation = allocatePaymentFunding({
        currentPayment: {
          paymentId: payment.id,
          postingDate: payment.paymentDate,
          exchangeRate: Number(payment.exchangeRate),
          remainingDocument: Number(payment.totalAmount),
          remainingBase: toBaseAmount(
            Number(payment.totalAmount),
            Number(payment.exchangeRate)
          )
        },
        // An employee has no on-account credit history to draw on: a
        // reimbursement payout is always funded by the current disbursement.
        priorSources: [],
        requests: [...requests.values()],
        currencyDecimals,
        isAR: cashIn
      });
      await trx
        .deleteFrom("invoiceSettlement")
        .where("paymentId", "=", payment.id)
        .where("companyId", "=", args.companyId)
        .execute();
      if (allocation.applications.length)
        await trx
          .insertInto("invoiceSettlement")
          .values(
            allocation.applications.map(({ targetId, ...application }) => ({
              ...application,
              paymentId: payment.id,
              targetReimbursementId: targetId,
              targetSalesInvoiceId: null,
              targetPurchaseInvoiceId: null,
              targetMemoId: null,
              appliedDate: dates.get(targetId)!,
              createdBy: args.createdBy,
              companyId: args.companyId
            }))
          )
          .execute();
      return;
    }
    if (isRefund) {
      const ids = [
        ...new Set(args.applications.map((app) => app.targetMemoId!))
      ].sort();
      const memos = ids.length
        ? await trx
            .selectFrom("memo")
            .selectAll()
            .where("companyId", "=", args.companyId)
            .where("id", "in", ids)
            .orderBy("id")
            .forUpdate()
            .execute()
        : [];
      if (memos.length !== ids.length)
        throw new Error("Refund memo not found in this company");
      for (const memo of memos) {
        if (
          memo.status !== "Posted" ||
          memo.direction !== (isAR ? "Credit" : "Debit") ||
          (isAR ? memo.customerId : memo.supplierId) !== partyId ||
          memo.currencyCode !== payment.currencyCode
        ) {
          throw new Error(
            "Refund target must be a posted reducing memo with matching party and currency"
          );
        }
      }
      const consumption = ids.length
        ? await loadTransactionMemoConsumption(
            trx,
            args.companyId,
            ids,
            payment.id
          )
        : [];
      const remaining = new Map(
        remainingFundingSources(
          memos.map((memo) => ({
            ...memo,
            totalAmount: memo.amount,
            paymentDate: memo.memoDate
          })),
          consumption.map((row) => ({
            ...row,
            paymentId: row.memoId ?? row.targetMemoId,
            sourcePaymentId: null,
            fxGainLossAmount: row.targetMemoId ? 0 : row.fxGainLossAmount
          })),
          decimals,
          isAR
        ).map((source) => [source.paymentId, source])
      );
      const requests = new Map<string, FundingRequest>();
      const dates = new Map<string, string>();
      for (const app of args.applications) {
        const memo = remaining.get(app.targetMemoId!);
        if (!memo) throw new Error("Memo has no remaining refund balance");
        if (app.targetExchangeRate !== memo.exchangeRate)
          throw new Error("Target exchange rate does not match the memo");
        const requested =
          app.sourceAmount ??
          (app.appliedAmount === memo.remainingBase
            ? memo.remainingDocument
            : toDocumentAmount(
                app.appliedAmount,
                memo.exchangeRate,
                currencyDecimals
              ));
        const request = requests.get(app.targetMemoId!) ?? {
          targetId: app.targetMemoId!,
          targetExchangeRate: memo.exchangeRate,
          remainingDocument: memo.remainingDocument,
          remainingBase: memo.remainingBase,
          requestedDocumentPrincipal: 0,
          discountAmount: 0,
          writeOffAmount: 0
        };
        request.requestedDocumentPrincipal = toDocumentAmount(
          request.requestedDocumentPrincipal + requested,
          1,
          currencyDecimals
        );
        requests.set(app.targetMemoId!, request);
        dates.set(app.targetMemoId!, app.appliedDate);
      }
      const allocation = allocatePaymentFunding({
        currentPayment: {
          paymentId: payment.id,
          postingDate: payment.paymentDate,
          exchangeRate: Number(payment.exchangeRate),
          remainingDocument: Number(payment.totalAmount),
          remainingBase: toBaseAmount(
            Number(payment.totalAmount),
            Number(payment.exchangeRate)
          )
        },
        priorSources: [],
        requests: [...requests.values()],
        currencyDecimals,
        isAR: cashIn
      });
      await trx
        .deleteFrom("invoiceSettlement")
        .where("paymentId", "=", payment.id)
        .where("companyId", "=", args.companyId)
        .execute();
      if (allocation.applications.length)
        await trx
          .insertInto("invoiceSettlement")
          .values(
            allocation.applications.map(({ targetId, ...application }) => ({
              ...application,
              paymentId: payment.id,
              targetMemoId: targetId,
              targetSalesInvoiceId: null,
              targetPurchaseInvoiceId: null,
              appliedDate: dates.get(targetId)!,
              createdBy: args.createdBy,
              companyId: args.companyId
            }))
          )
          .execute();
      return;
    }
    const ids = [
      ...new Set(
        args.applications.map(
          (a) => (isAR ? a.targetSalesInvoiceId : a.targetPurchaseInvoiceId)!
        )
      )
    ].sort();
    if (!ids.length) {
      await trx
        .deleteFrom("invoiceSettlement")
        .where("paymentId", "=", args.paymentId)
        .where("companyId", "=", args.companyId)
        .execute();
      return;
    }
    const invoices = await loadTransactionInvoices(
      trx,
      args.companyId,
      ids,
      isAR,
      payment.currencyCode,
      partyId,
      currencyDecimals
    );
    // Existing staged memos reserve target capacity while the cash half is edited.
    const staged = await trx
      .selectFrom("invoiceSettlement")
      .selectAll()
      .where("companyId", "=", args.companyId)
      .where("appliedViaPaymentId", "=", args.paymentId)
      .execute();
    const stagedMemoIds = [
      ...new Set(
        staged
          .map((row) => row.memoId)
          .filter((id): id is string => Boolean(id))
      )
    ].sort();
    const stagedMemos = stagedMemoIds.length
      ? await trx
          .selectFrom("memo")
          .select([
            "id",
            "status",
            "direction",
            "customerId",
            "supplierId",
            "currencyCode",
            "exchangeRate"
          ])
          .where("companyId", "=", args.companyId)
          .where("id", "in", stagedMemoIds)
          .orderBy("id")
          .forUpdate()
          .execute()
      : [];
    const stagedMemoById = new Map(stagedMemos.map((memo) => [memo.id, memo]));
    for (const row of staged) {
      const memo = row.memoId ? stagedMemoById.get(row.memoId) : undefined;
      if (
        !memo ||
        memo.status !== "Posted" ||
        memo.direction !== (isAR ? "Credit" : "Debit")
      ) {
        throw new Error("Staged applications must use a posted credit memo");
      }
      if (
        (isAR ? memo.customerId : memo.supplierId) !== partyId ||
        memo.currencyCode !== payment.currencyCode
      ) {
        throw new Error(
          "Staged credit and payment currency and party must match"
        );
      }
      const id = isAR ? row.targetSalesInvoiceId : row.targetPurchaseInvoiceId;
      const invoice = id ? invoices.get(id) : undefined;
      if (!invoice) continue;
      if (Number(memo.exchangeRate) !== invoice.exchangeRate)
        throw new Error("Staged credit and invoice exchange rates must match");
      const reserved = reduceInvoiceSettlements(
        [row],
        invoice.exchangeRate,
        currencyDecimals
      );
      invoice.remainingDocument = toDocumentAmount(
        invoice.remainingDocument - reserved.document,
        1,
        currencyDecimals
      );
      invoice.remainingBase = round(invoice.remainingBase - reserved.base);
    }
    let priorQuery = trx
      .selectFrom("payment")
      .selectAll()
      .where("companyId", "=", args.companyId)
      .where("status", "=", "Posted")
      .where("paymentType", "=", payment.paymentType)
      .where("currencyCode", "=", payment.currencyCode);
    priorQuery = isAR
      ? priorQuery.where("customerId", "=", partyId)
      : priorQuery.where("supplierId", "=", partyId);
    const priorPayments = (
      await priorQuery.orderBy("id").forUpdate().execute()
    ).map((p) => ({
      ...p,
      // A customer deposit funds only invoices of its own document.
      scope: isAR ? fundingScopeOf(p) : null
    }));
    const currentScope: FundingScope | null = isAR
      ? await loadDepositScope(trx, args.companyId, payment)
      : null;
    // Only read the invoices' documents when a deposit is in play.
    const invoiceDocuments =
      currentScope || priorPayments.some((p) => p.scope)
        ? await loadSalesInvoiceDocumentIds(trx, args.companyId, ids)
        : new Map<string, InvoiceDocumentIds>();
    const sourceIds = priorPayments.map((p) => p.id);
    const consumption = sourceIds.length
      ? await trx
          .selectFrom("invoiceSettlement")
          .innerJoin(
            "payment as applyingPayment",
            "applyingPayment.id",
            "invoiceSettlement.paymentId"
          )
          .select([
            "invoiceSettlement.paymentId",
            "invoiceSettlement.sourcePaymentId",
            "invoiceSettlement.sourceAmount",
            "invoiceSettlement.appliedAmount",
            "invoiceSettlement.fxGainLossAmount"
          ])
          .where("invoiceSettlement.companyId", "=", args.companyId)
          .where("applyingPayment.companyId", "=", args.companyId)
          .where("applyingPayment.status", "=", "Posted")
          .where((eb) =>
            eb.or([
              eb("invoiceSettlement.sourcePaymentId", "in", sourceIds),
              eb("invoiceSettlement.paymentId", "in", sourceIds)
            ])
          )
          .execute()
      : [];
    const requests = new Map<string, FundingRequest>();
    const dates = new Map<string, string>();
    for (const app of args.applications) {
      const id = (
        isAR ? app.targetSalesInvoiceId : app.targetPurchaseInvoiceId
      )!;
      const invoice = invoices.get(id);
      if (!invoice) throw new Error(`Invoice ${id} balance not found`);
      if (app.targetExchangeRate !== invoice.exchangeRate)
        throw new Error("Target exchange rate does not match the invoice");
      const sourceAmount =
        app.sourceAmount ??
        (round(app.appliedAmount + app.discountAmount + app.writeOffAmount) ===
        invoice.remainingBase
          ? toDocumentAmount(
              invoice.remainingDocument -
                toDocumentAmount(
                  app.discountAmount + app.writeOffAmount,
                  invoice.exchangeRate,
                  currencyDecimals
                ),
              1,
              currencyDecimals
            )
          : toDocumentAmount(
              app.appliedAmount,
              invoice.exchangeRate,
              currencyDecimals
            ));
      const request = requests.get(id) ?? {
        targetId: id,
        targetExchangeRate: invoice.exchangeRate,
        remainingDocument: invoice.remainingDocument,
        remainingBase: invoice.remainingBase,
        requestedDocumentPrincipal: 0,
        discountAmount: 0,
        writeOffAmount: 0,
        ...invoiceDocuments.get(id)
      };
      request.requestedDocumentPrincipal = toDocumentAmount(
        request.requestedDocumentPrincipal + sourceAmount,
        1,
        currencyDecimals
      );
      request.discountAmount = round(
        request.discountAmount + app.discountAmount
      );
      request.writeOffAmount = round(
        request.writeOffAmount + app.writeOffAmount
      );
      requests.set(id, request);
      dates.set(id, app.appliedDate);
    }
    const result = allocatePaymentFunding({
      currentPayment: {
        paymentId: payment.id,
        postingDate: payment.paymentDate,
        exchangeRate: Number(payment.exchangeRate),
        remainingDocument: Number(payment.totalAmount),
        remainingBase: toBaseAmount(
          Number(payment.totalAmount),
          Number(payment.exchangeRate)
        ),
        scope: currentScope
      },
      priorSources: remainingFundingSources(
        priorPayments,
        consumption,
        decimals,
        isAR
      ),
      requests: [...requests.values()],
      currencyDecimals,
      isAR
    });
    await trx
      .deleteFrom("invoiceSettlement")
      .where("paymentId", "=", args.paymentId)
      .where("companyId", "=", args.companyId)
      .execute();
    if (result.applications.length)
      await trx
        .insertInto("invoiceSettlement")
        .values(
          result.applications.map(({ targetId, ...a }) => ({
            ...a,
            paymentId: args.paymentId,
            companyId: args.companyId,
            createdBy: args.createdBy,
            targetSalesInvoiceId: isAR ? targetId : null,
            targetPurchaseInvoiceId: isAR ? null : targetId,
            appliedDate: dates.get(targetId)!
          }))
        )
        .execute();
  });
}

// Memos (credit/debit). A memo is payment-shaped: a party (customer XOR
// supplier), a signed amount against a reason GL account, and a set of
// invoiceSettlement applications (memo as SOURCE) to open invoices of the same
// party. Direction (Credit/Debit) is the discriminator; numbering uses the
// creditMemo / debitMemo sequences. Posting is handled by the post-memo server
// function; the apply table is editable only while the memo is Draft.

export async function getMemo(
  client: SupabaseClient<Database>,
  id: string,
  companyId?: string
) {
  let query = client.from("memo").select("*").eq("id", id);
  if (companyId) query = query.eq("companyId", companyId);
  return query.single();
}

export async function getMemos(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    direction: "Credit" | "Debit" | null;
    status: "Draft" | "Posted" | "Voided" | null;
    counterpartyIds: string[] | null;
    // Restrict to one party. A memo carries exactly one of customerId /
    // supplierId, so the two invoicing submodules pass "customer" (Credit Memos,
    // AR) or "supplier" (Supplier Credits, AP); null returns both parties.
    party: "customer" | "supplier" | null;
  }
) {
  let query = client
    .from("memo")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("memoId", `%${args.search}%`);
  }
  if (args.party === "customer") {
    query = query.not("customerId", "is", null);
  } else if (args.party === "supplier") {
    query = query.not("supplierId", "is", null);
  }
  if (args.direction) {
    query = query.eq("direction", args.direction);
  }
  if (args.status) {
    query = query.eq("status", args.status);
  }
  if (args.counterpartyIds && args.counterpartyIds.length > 0) {
    // A memo carries either customerId or supplierId; match the selected ids
    // against both columns (customer/supplier id spaces don't overlap).
    const csv = args.counterpartyIds.join(",");
    query = query.or(`customerId.in.(${csv}),supplierId.in.(${csv})`);
  }

  // Newest first by creation date (not the readable memoId — Credit and Debit
  // share the table but use separate CR-/DR- sequences, so a memoId sort
  // interleaves them oddly).
  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

export async function upsertMemo(
  client: SupabaseClient<Database>,
  memo:
    | (Omit<z.infer<typeof memoValidator>, "id" | "memoId"> & {
        memoId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof memoValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in memo) {
    return client
      .from("memo")
      .insert([sanitize(memo)])
      .select("id, memoId")
      .single();
  }
  return client
    .from("memo")
    .update(sanitize(memo))
    .eq("id", memo.id)
    .select("id, memoId")
    .single();
}

// RLS DELETE policy on memo restricts to status='Draft'.
/** Not published: `invoicing.memo.delete` also refuses a posted memo and releases a rental credit's periods. */
export async function deleteMemo(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client.from("memo").delete().eq("id", id).eq("companyId", companyId);
}

// The party's available credit to draw on when clearing invoices alongside cash:
// their POSTED, balance-reducing memos with credit remaining. A customer's Credit
// memos reduce AR (apply to sales invoices); a supplier's Debit memos reduce AP
// (apply to purchase invoices). `remaining` = amount − Σ already applied (memo as
// settlement source). Drives the credits section of the invoice "Receive Payment"
// composer.
type AvailableMemoCredit = {
  id: string;
  memoId: string;
  direction: string;
  currencyCode: string;
  exchangeRate: number;
  amount: number;
  remaining: number;
  remainingDocument: number;
};

async function loadAvailableMemoCredits(
  client: SupabaseClient<Database>,
  companyId: string,
  side: "sales" | "purchase",
  partyId?: string,
  excludePaymentId?: string,
  currencyCode?: string
): Promise<AvailableMemoCredit[]> {
  const [memos, company] = await Promise.all([
    fetchAllFromTable<
      Omit<AvailableMemoCredit, "remaining" | "remainingDocument"> & {
        memoDate: string;
        postingDate: string | null;
      }
    >(
      client,
      "memo",
      "id, memoId, direction, currencyCode, exchangeRate, amount, memoDate, postingDate",
      (query) => {
        query = query
          .eq("companyId", companyId)
          .eq("status", "Posted")
          .eq("direction", side === "sales" ? "Credit" : "Debit");
        if (partyId)
          query =
            side === "sales"
              ? query.eq("customerId", partyId)
              : query.eq("supplierId", partyId);
        if (currencyCode) query = query.eq("currencyCode", currencyCode);
        return query.order("id");
      }
    ),
    client.from("company").select("companyGroupId").eq("id", companyId).single()
  ]);
  if (memos.error) throw new Error(memos.error.message);
  if (company.error || !company.data?.companyGroupId)
    throw new Error("Company currency configuration is missing");
  const currencies = await client
    .from("currency")
    .select("code, decimalPlaces")
    .eq("companyGroupId", company.data.companyGroupId);
  if (currencies.error) throw new Error(currencies.error.message);
  const decimals = new Map(
    (currencies.data ?? []).map((c) => [c.code, c.decimalPlaces])
  );
  if (currencyCode) requireCurrencyDecimals(decimals, currencyCode);
  if (!memos.data?.length) return [];
  const apps = await fetchAllFromTable<{
    memoId: string | null;
    sourceAmount: number | null;
    appliedAmount: number;
    fxGainLossAmount: number | null;
    appliedViaPaymentId: string | null;
    appliedViaPayment: { status: string } | null;
  }>(
    client,
    "invoiceSettlement",
    "memoId, sourceAmount, appliedAmount, fxGainLossAmount, appliedViaPaymentId, appliedViaPayment:payment!invoiceSettlement_appliedViaPaymentId_fkey(status), memo:memo!invoiceSettlement_memoId_fkey!inner(status)",
    (query) => {
      query = query
        .eq("companyId", companyId)
        .eq("memo.companyId", companyId)
        .eq("memo.status", "Posted")
        .eq("memo.direction", side === "sales" ? "Credit" : "Debit");
      if (partyId)
        query =
          side === "sales"
            ? query.eq("memo.customerId", partyId)
            : query.eq("memo.supplierId", partyId);
      if (currencyCode) query = query.eq("memo.currencyCode", currencyCode);
      return query.order("id");
    }
  );
  if (apps.error) throw new Error(apps.error.message);
  const refunds = await fetchAllFromTable<{
    targetMemoId: string | null;
    paymentId: string | null;
    sourceAmount: number | null;
    appliedAmount: number;
    payment: { status: string } | null;
  }>(
    client,
    "invoiceSettlement",
    "targetMemoId, paymentId, sourceAmount, appliedAmount, payment:payment!invoiceSettlement_paymentId_fkey(status), targetMemo:memo!invoiceSettlement_targetMemoId_fkey!inner(status)",
    (query) => {
      query = query
        .eq("companyId", companyId)
        .eq("targetMemo.companyId", companyId)
        .eq("targetMemo.status", "Posted")
        .eq("targetMemo.direction", side === "sales" ? "Credit" : "Debit");
      if (partyId)
        query = query.eq(
          side === "sales" ? "targetMemo.customerId" : "targetMemo.supplierId",
          partyId
        );
      if (currencyCode)
        query = query.eq("targetMemo.currencyCode", currencyCode);
      return query.order("id");
    }
  );
  if (refunds.error) throw new Error(refunds.error.message);
  const reservedRefunds = refunds.data.filter(
    (row) =>
      row.targetMemoId &&
      !(excludePaymentId && row.paymentId === excludePaymentId) &&
      ["Draft", "Posted"].includes(row.payment?.status ?? "")
  );
  // Memo availability reserves competing Draft applications as well as Posted
  // ones; sharing the arithmetic must not change this eligibility policy.
  const reserved = apps.data.filter(
    (row) =>
      row.memoId &&
      !(excludePaymentId && row.appliedViaPaymentId === excludePaymentId) &&
      (!row.appliedViaPaymentId ||
        ["Draft", "Posted"].includes(row.appliedViaPayment?.status ?? ""))
  );
  const sources = remainingFundingSources(
    memos.data.map((memo) => ({
      ...memo,
      totalAmount: memo.amount,
      paymentDate: memo.memoDate
    })),
    [
      ...reserved.map((row) => ({
        ...row,
        paymentId: row.memoId,
        sourcePaymentId: null
      })),
      ...reservedRefunds.map((row) => ({
        ...row,
        paymentId: row.targetMemoId,
        sourcePaymentId: null,
        fxGainLossAmount: 0
      }))
    ],
    decimals,
    side === "sales"
  );
  const remaining = new Map(
    sources.map((source) => [source.paymentId, source])
  );
  return memos.data.flatMap((memo) => {
    const source = remaining.get(memo.id);
    return source
      ? [
          {
            id: memo.id,
            memoId: memo.memoId,
            direction: memo.direction,
            currencyCode: memo.currencyCode,
            exchangeRate: memo.exchangeRate,
            amount: toBaseAmount(
              Number(memo.amount),
              Number(memo.exchangeRate)
            ),
            remaining: source.remainingBase,
            remainingDocument: source.remainingDocument
          }
        ]
      : [];
  });
}

export async function getAvailableCreditsForParty(
  client: SupabaseClient<Database>,
  companyId: string,
  party:
    | { side: "sales"; customerId: string }
    | { side: "purchase"; supplierId: string },
  excludePaymentId?: string,
  currencyCode?: string
): Promise<{ data: AvailableMemoCredit[] | null; error: unknown }> {
  try {
    return {
      data: await loadAvailableMemoCredits(
        client,
        companyId,
        party.side,
        party.side === "sales" ? party.customerId : party.supplierId,
        excludePaymentId,
        currencyCode
      ),
      error: null
    };
  } catch (error) {
    return { data: null, error };
  }
}

export async function getCompanyHasOpenCredits(
  client: SupabaseClient<Database>,
  companyId: string,
  side: "sales" | "purchase"
): Promise<boolean> {
  try {
    return (await loadAvailableMemoCredits(client, companyId, side)).length > 0;
  } catch {
    return false;
  }
}

// Apply posted credits to invoices — additive insert of memo-sourced
// invoiceSettlement rows (the credits half of the "Receive Payment" composer).
// GL-neutral (the memos already posted their own journals), so no journal here;
// caps are validated under FOR UPDATE locks. Each application matches the memo's
// exchange rate to the invoice's (v1 requires equal rates — no cross-rate FX on
// credit application).
// The credit applications currently staged on a (Draft) payment — drives the
// composer's pre-fill so a staged credit stays visible and editable instead of
// silently vanishing from the available list.
export async function getStagedCreditsForPayment(
  client: SupabaseClient<Database>,
  paymentId: string,
  side: "sales" | "purchase",
  companyId?: string
): Promise<{
  data:
    | {
        memoId: string;
        invoiceId: string;
        amount: number;
        sourceAmount: number | null;
      }[]
    | null;
  error: unknown;
}> {
  let query = client
    .from("invoiceSettlement")
    .select(
      "memoId, targetSalesInvoiceId, targetPurchaseInvoiceId, appliedAmount, sourceAmount"
    )
    .eq("appliedViaPaymentId", paymentId);
  if (companyId) query = query.eq("companyId", companyId);
  const apps = await query;
  if (apps.error) return { data: null, error: apps.error };
  const rows = (apps.data ?? []) as Array<{
    memoId: string | null;
    targetSalesInvoiceId: string | null;
    targetPurchaseInvoiceId: string | null;
    appliedAmount: number;
    sourceAmount: number | null;
  }>;
  const data = rows
    .map((r) => ({
      memoId: r.memoId ?? "",
      invoiceId:
        side === "sales"
          ? (r.targetSalesInvoiceId ?? "")
          : (r.targetPurchaseInvoiceId ?? ""),
      amount: Number(r.appliedAmount),
      sourceAmount: r.sourceAmount
    }))
    .filter((r) => r.memoId && r.invoiceId);
  return { data, error: null };
}

export async function applyCreditsToInvoices(
  db: Kysely<KyselyDatabase>,
  args: {
    paymentId: string;
    companyId: string;
    createdBy: string;
    appliedDate: string;
    side: "sales" | "purchase";
    applications: {
      memoId: string;
      invoiceId: string;
      amount: number;
      sourceAmount?: number;
    }[];
  }
) {
  return db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom("payment")
      .selectAll()
      .where("id", "=", args.paymentId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "Draft")
      throw new Error(
        "Credit applications can only be edited while the payment is Draft"
      );
    const isAR = args.side === "sales";
    if ((payment.paymentType === "Receipt") !== isAR)
      throw new Error("Payment and invoice side must match");
    const partyId = isAR ? payment.customerId : payment.supplierId;
    if (!partyId) throw new Error("Payment party is required");
    const { currencyDecimals } = await loadTransactionCurrency(
      trx,
      args.companyId,
      payment.currencyCode
    );
    if (!args.applications.length) {
      await trx
        .deleteFrom("invoiceSettlement")
        .where("appliedViaPaymentId", "=", args.paymentId)
        .where("companyId", "=", args.companyId)
        .execute();
      return;
    }
    const ids = [...new Set(args.applications.map((a) => a.invoiceId))].sort();
    const memoIds = [...new Set(args.applications.map((a) => a.memoId))].sort();
    const invoices = await loadTransactionInvoices(
      trx,
      args.companyId,
      ids,
      isAR,
      payment.currencyCode,
      partyId,
      currencyDecimals
    );
    const memos = await trx
      .selectFrom("memo")
      .selectAll()
      .where("companyId", "=", args.companyId)
      .where("id", "in", memoIds)
      .orderBy("id")
      .forUpdate()
      .execute();
    const [prior, cash] = await Promise.all([
      loadTransactionMemoConsumption(
        trx,
        args.companyId,
        memoIds,
        args.paymentId
      ),
      trx
        .selectFrom("invoiceSettlement")
        .selectAll()
        .where("companyId", "=", args.companyId)
        .where("paymentId", "=", args.paymentId)
        .execute()
    ]);
    for (const row of cash) {
      const id = isAR ? row.targetSalesInvoiceId : row.targetPurchaseInvoiceId;
      const invoice = id ? invoices.get(id) : undefined;
      if (!invoice) continue;
      const reserved = reduceInvoiceSettlements(
        [row],
        invoice.exchangeRate,
        currencyDecimals
      );
      invoice.remainingDocument = toDocumentAmount(
        invoice.remainingDocument - reserved.document,
        1,
        currencyDecimals
      );
      invoice.remainingBase = round(invoice.remainingBase - reserved.base);
    }
    for (const id of memoIds) {
      const memo = memos.find((m) => m.id === id);
      if (!memo || memo.status !== "Posted")
        throw new Error("Only posted credits can be applied");
      if (memo.direction !== (isAR ? "Credit" : "Debit"))
        throw new Error("Memo direction does not reduce this invoice balance");
      if ((isAR ? memo.customerId : memo.supplierId) !== partyId)
        throw new Error("Memo and payment party must match");
      if (memo.currencyCode !== payment.currencyCode)
        throw new Error("Memo and payment currency must match");
    }
    const sources = new Map(
      remainingFundingSources(
        memos.map((memo) => ({
          ...memo,
          totalAmount: memo.amount,
          paymentDate: memo.memoDate
        })),
        prior.map((row) => ({
          ...row,
          paymentId: row.memoId ?? row.targetMemoId,
          sourcePaymentId: null,
          fxGainLossAmount: row.targetMemoId ? 0 : row.fxGainLossAmount
        })),
        new Map([[payment.currencyCode, currencyDecimals]]),
        isAR
      ).map((source) => [source.paymentId, source])
    );
    const values: Database["public"]["Tables"]["invoiceSettlement"]["Insert"][] =
      [];
    for (const app of args.applications) {
      const source = sources.get(app.memoId);
      if (!source) throw new Error("Credit has no remaining funding balance");
      const invoice = invoices.get(app.invoiceId);
      if (!invoice)
        throw new Error(`Invoice ${app.invoiceId} balance not found`);
      if (source.exchangeRate !== invoice.exchangeRate)
        throw new Error("Applying a credit requires matching exchange rates");
      if (!Number.isFinite(app.amount) || app.amount < 0)
        throw new Error("Applied amount must be nonnegative and finite");
      const sourceAmount =
        app.sourceAmount ??
        (app.amount === source.remainingBase
          ? source.remainingDocument
          : app.amount === invoice.remainingBase
            ? invoice.remainingDocument
            : toDocumentAmount(
                app.amount,
                invoice.exchangeRate,
                currencyDecimals
              ));
      if (sourceAmount <= 0)
        throw new Error("Applied document amount must be greater than zero");
      const result = allocatePaymentFunding({
        currentPayment: source,
        priorSources: [],
        currencyDecimals,
        isAR,
        requests: [
          {
            targetId: app.invoiceId,
            targetExchangeRate: invoice.exchangeRate,
            remainingDocument: invoice.remainingDocument,
            remainingBase: invoice.remainingBase,
            requestedDocumentPrincipal: sourceAmount,
            discountAmount: 0,
            writeOffAmount: 0
          }
        ]
      });
      const allocated = result.applications[0];
      sources.set(app.memoId, { ...source, ...result.sourceRemainders[0] });
      invoice.remainingDocument = toDocumentAmount(
        invoice.remainingDocument - sourceAmount,
        1,
        currencyDecimals
      );
      invoice.remainingBase = round(
        invoice.remainingBase - allocated.appliedAmount
      );
      values.push({
        memoId: app.memoId,
        appliedViaPaymentId: args.paymentId,
        companyId: args.companyId,
        createdBy: args.createdBy,
        targetSalesInvoiceId: isAR ? app.invoiceId : null,
        targetPurchaseInvoiceId: isAR ? null : app.invoiceId,
        sourceAmount: allocated.sourceAmount,
        appliedAmount: allocated.appliedAmount,
        discountAmount: 0,
        writeOffAmount: 0,
        sourceExchangeRate: source.exchangeRate,
        targetExchangeRate: invoice.exchangeRate,
        // Matching-snapshot memo applications are GL-neutral.
        fxGainLossAmount: 0,
        appliedDate: args.appliedDate
      });
    }
    await trx
      .deleteFrom("invoiceSettlement")
      .where("appliedViaPaymentId", "=", args.paymentId)
      .where("companyId", "=", args.companyId)
      .execute();
    if (values.length)
      await trx.insertInto("invoiceSettlement").values(values).execute();
  });
}

// Tie-out RPCs (migration 20260519140000_ar-ap-tie-out)

export async function getArTieOut(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client
    .rpc("get_ar_tie_out", {
      _company_id: companyId,
      _as_of_date: asOfDate
    })
    .single();
}

export async function getApTieOut(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client
    .rpc("get_ap_tie_out", {
      _company_id: companyId,
      _as_of_date: asOfDate
    })
    .single();
}

export async function getArOpenByCustomer(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client.rpc("get_ar_open_by_customer", {
    _company_id: companyId,
    _as_of_date: asOfDate
  });
}

export async function getApOpenBySupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client.rpc("get_ap_open_by_supplier", {
    _company_id: companyId,
    _as_of_date: asOfDate
  });
}

// Aging RPCs (migration 20260519150000_ar-ap-aging)

export type AgingOptions = {
  agingMethod?: "dueDate" | "documentDate";
  bucketDays?: [number, number, number];
};

export async function getArAging(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string,
  options: AgingOptions = {}
) {
  const [b1, b2, b3] = options.bucketDays ?? [30, 60, 90];
  return client.rpc("get_ar_aging", {
    _company_id: companyId,
    _as_of_date: asOfDate,
    _aging_method: options.agingMethod ?? "dueDate",
    _bucket1: b1,
    _bucket2: b2,
    _bucket3: b3
  });
}

export async function getApAging(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string,
  options: AgingOptions = {}
) {
  const [b1, b2, b3] = options.bucketDays ?? [30, 60, 90];
  return client.rpc("get_ap_aging", {
    _company_id: companyId,
    _as_of_date: asOfDate,
    _aging_method: options.agingMethod ?? "dueDate",
    _bucket1: b1,
    _bucket2: b2,
    _bucket3: b3
  });
}
// Documents a customer payment can be a deposit for — or a refund of: every
// open sales order and Draft/Active rental agreement (a new deposit), plus
// every document a posted deposit receipt already references (a refund of a
// Closed agreement's deposit) and any ids the caller must keep listed. Loaded
// company-wide with the customer on each row because the form's customer can
// change before the payment is saved; the picker narrows to that customer.
export async function getDepositDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  keepSalesOrderIds: (string | null | undefined)[] = []
): Promise<DepositDocument[]> {
  const [deposits, rentalAgreements, openOrders] = await Promise.all([
    client
      .from("payment")
      .select("salesOrderId")
      .eq("companyId", companyId)
      .eq("paymentType", "Receipt")
      .eq("status", "Posted")
      .not("salesOrderId", "is", null),
    client
      .from("rentalAgreement")
      .select("id, rentalAgreementId, customerId, status")
      .eq("companyId", companyId)
      .order("rentalAgreementId", { ascending: false }),
    fetchAllFromTable<{
      id: string;
      salesOrderId: string;
      customerId: string;
      status: string;
    }>(client, "salesOrder", "id, salesOrderId, customerId, status", (query) =>
      query
        .eq("companyId", companyId)
        .in("status", [...OPEN_SALES_ORDER_STATUSES])
        .order("salesOrderId", { ascending: false })
    )
  ]);
  const firstError =
    deposits.error ?? rentalAgreements.error ?? openOrders.error;
  if (firstError) throw new Error(firstError.message);
  const listed = new Set((openOrders.data ?? []).map((order) => order.id));
  const missingOrderIds = [
    ...new Set(
      [
        ...(deposits.data ?? []).map((deposit) => deposit.salesOrderId),
        ...keepSalesOrderIds
      ].filter((id): id is string => Boolean(id) && !listed.has(id!))
    )
  ];
  const closedOrders = missingOrderIds.length
    ? await client
        .from("salesOrder")
        .select("id, salesOrderId, customerId, status")
        .eq("companyId", companyId)
        .in("id", missingOrderIds)
    : { data: [], error: null };
  if (closedOrders.error) throw new Error(closedOrders.error.message);
  return [
    ...(rentalAgreements.data ?? []).map((agreement) => ({
      id: agreement.id,
      readableId: agreement.rentalAgreementId,
      customerId: agreement.customerId,
      kind: "rentalAgreement" as const,
      status: agreement.status,
      open: agreement.status === "Draft" || agreement.status === "Active"
    })),
    ...[...(openOrders.data ?? []), ...(closedOrders.data ?? [])].map(
      (order) => ({
        id: order.id,
        readableId: order.salesOrderId,
        customerId: order.customerId,
        kind: "salesOrder" as const,
        status: order.status,
        open: listed.has(order.id)
      })
    )
  ];
}

/**
 * Checks the document a customer payment names as its deposit (a Receipt) or
 * the deposit it refunds (a Disbursement): it must be this company's and the
 * payment's customer's, and a NEW deposit can only be taken against an open
 * document — an open sales order, or a Draft/Active rental agreement. The
 * payment's own saved link stays valid after its document closes, as the
 * "Deposit for" picker keeps it listed. Returns the error for the picker's
 * field, or null when the reference is fine (or absent).
 */
export async function checkDepositDocument(
  client: SupabaseClient<Database>,
  companyId: string,
  payment: {
    paymentType: "Receipt" | "Disbursement";
    customerId?: string | null;
    salesOrderId?: string | null;
    rentalAgreementId?: string | null;
  },
  saved: {
    salesOrderId?: string | null;
    rentalAgreementId?: string | null;
  } = {}
): Promise<string | null> {
  const { salesOrderId, rentalAgreementId, customerId } = payment;
  if (!salesOrderId && !rentalAgreementId) return null;
  // The validator already requires a customer for a deposit.
  if (!customerId) return "Only a customer payment can be a deposit";

  const document = salesOrderId
    ? await client
        .from("salesOrder")
        .select("customerId, status")
        .eq("id", salesOrderId)
        .eq("companyId", companyId)
        .maybeSingle()
    : await client
        .from("rentalAgreement")
        .select("customerId, status")
        .eq("id", rentalAgreementId!)
        .eq("companyId", companyId)
        .maybeSingle();
  if (document.error) throw new Error(document.error.message);
  if (!document.data) return "The deposit document was not found";
  if (document.data.customerId !== customerId) {
    return "The deposit document belongs to a different customer";
  }

  const unchanged = salesOrderId
    ? salesOrderId === saved.salesOrderId
    : rentalAgreementId === saved.rentalAgreementId;
  if (payment.paymentType !== "Receipt" || unchanged) return null;

  const status = document.data.status as string;
  const open = salesOrderId
    ? (OPEN_SALES_ORDER_STATUSES as readonly string[]).includes(status)
    : status === "Draft" || status === "Active";
  if (open) return null;
  return salesOrderId
    ? `The sales order is ${status} and cannot take a new deposit`
    : `The rental agreement is ${status} and cannot take a new deposit`;
}

/**
 * One field set on several invoices, as a Properties panel posts it: `ids`
 * repeats in a form, and an empty `value` clears the field.
 */
export function fieldUpdate<const F extends readonly [string, ...string[]]>(
  fields: F
) {
  return z.object({
    ids: zfd.repeatableOfType(z.string().min(1)),
    field: z.enum(fields),
    value: z.string().nullish()
  });
}

/** What a sales-rule check found: the violation modal's payload. */
export type SalesRuleCheck = {
  violations: Violation[];
  ruleNames: Record<string, string>;
};

// --- Sales invoices -----------------------------------------------------------

/** A Draft sales invoice this company owns, or why it cannot be changed. */
export async function unlockedSalesInvoice(
  ctx: ServiceContext,
  invoiceId: string,
  message: string
) {
  const refused = await refuseUnlessOwned(ctx, "salesInvoice", {
    id: invoiceId
  });
  if (refused) return refused;
  const invoice = await getSalesInvoice(ctx.asCaller.supabase, invoiceId);
  if (invoice.error) {
    return ctx.error("internal", "Failed to load sales invoice", invoice.error);
  }
  if (isSalesInvoiceLocked(invoice.data.status)) {
    return ctx.error("rule", message);
  }
  return null;
}

type InvoiceTable = "salesInvoice" | "purchaseInvoice";

/** The dates a posted invoice still takes; every other field needs a Draft. */
const POSTED_INVOICE_FIELDS = ["dateIssued", "dateDue", "datePaid"];

/** Why `field` cannot be set on these invoices, or null when it can. */
export async function refuseLockedInvoices(
  ctx: ServiceContext,
  table: InvoiceTable,
  ids: string[],
  field: string,
  message: string
) {
  if (POSTED_INVOICE_FIELDS.includes(field)) return null;
  // Both tables hold `status`; the cast only names one for supabase-js.
  const invoices = await ctx.asCaller.supabase
    .from(table as "salesInvoice")
    .select("status")
    .in("id", ids)
    .eq("companyId", ctx.company.id);
  if (invoices.error) {
    return ctx.error("internal", "Failed to load the invoices", invoices.error);
  }
  return invoices.data.some((invoice) => isSalesInvoiceLocked(invoice.status))
    ? ctx.error("rule", message)
    : null;
}

/**
 * Write one field on invoices of either kind. A new issue date or payment
 * term on a single invoice recomputes its due date (with several, nothing is
 * written); a new currency brings today's exchange rate; an empty value
 * clears the field.
 */
export async function writeInvoiceField(
  ctx: ServiceContext,
  table: InvoiceTable,
  { ids, field, value }: { ids: string[]; field: string; value?: string | null }
) {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  let changes: Record<string, unknown> = { [field]: value || null };

  if (field === "dateIssued" || field === "paymentTermId") {
    if (ids.length !== 1) return { ids };
    const invoice = await client
      .from(table as "salesInvoice")
      .select("dateIssued, paymentTermId")
      .eq("id", ids[0]!)
      .eq("companyId", companyId)
      .single();
    const dateDue = await computeInvoiceDateDue(client, {
      dateIssued: field === "dateIssued" ? value : invoice.data?.dateIssued,
      paymentTermId:
        field === "paymentTermId" ? value : invoice.data?.paymentTermId,
      companyId
    });
    if (dateDue) changes = { ...changes, dateDue };
  } else if (field === "currencyCode" && value) {
    const rate = await getExchangeRate(client, companyId, value);
    if (rate.error) {
      return ctx.error(
        "internal",
        "Failed to get the exchange rate",
        rate.error
      );
    }
    changes = { currencyCode: value, exchangeRate: rate.data };
  }

  const update = await client
    .from(table as "salesInvoice")
    .update(
      unchecked({
        ...changes,
        updatedBy: ctx.auditUserId,
        updatedAt: datetime.timestamp()
      })
    )
    .in("id", ids)
    .eq("companyId", companyId);
  if (update.error) {
    return ctx.error("internal", "Failed to update the invoices", update.error);
  }
  return { ids };
}

/** A party's currency at today's rate, or null when it has none. */
export async function partyCurrency(
  ctx: ServiceContext,
  table: "customer" | "supplier",
  id: string
) {
  const client = ctx.asCaller.supabase;
  const party = await client
    .from(table as "customer")
    .select("currencyCode")
    .eq("id", id)
    .eq("companyId", ctx.company.id)
    .single();
  if (party.error) {
    return ctx.error(
      "internal",
      "Failed to load the invoice party",
      party.error
    );
  }
  if (!party.data.currencyCode) return null;
  const rate = await getExchangeRate(
    client,
    ctx.company.id,
    party.data.currencyCode
  );
  if (rate.error) {
    return ctx.error("internal", "Failed to get the exchange rate", rate.error);
  }
  return { currencyCode: party.data.currencyCode, exchangeRate: rate.data };
}

/** A sales invoice line keeps only the target its type uses. */
function withInvoiceLineTarget<
  L extends {
    invoiceLineType: string;
    accountId?: string;
    assetId?: string;
    itemId?: string;
  }
>(line: L): L {
  if (line.invoiceLineType === "Fixed Asset") {
    return { ...line, accountId: undefined, itemId: undefined };
  }
  return { ...line, accountId: undefined, assetId: undefined };
}

/**
 * Check one sales invoice line's item against the sales rules at `shipTo`.
 * A blocked check is recorded against the line.
 */
export async function salesInvoiceLineGate(
  ctx: ServiceContext,
  args: {
    invoiceId: string;
    lineId: string | null;
    itemId: string;
    quantity: number;
    shipTo: { customerId: string | null; customerLocationId: string | null };
    acknowledged: boolean;
  }
): Promise<{ blocked: SalesRuleCheck | null; check: SalesRuleCheck }> {
  const found = await evaluateSalesRuleLines({
    client: ctx.asSystem.supabase,
    companyId: ctx.company.id,
    userId: ctx.auditUserId,
    surface: "salesInvoiceLine",
    lines: [
      {
        lineId: args.lineId ?? "new",
        itemId: args.itemId,
        quantity: args.quantity
      }
    ],
    customerId: args.shipTo.customerId,
    customerLocationId: args.shipTo.customerLocationId
  });
  const check = {
    violations: dedupeViolations(found.violations),
    ruleNames: found.ruleNames
  };
  if (
    check.violations.length === 0 ||
    !isBlocked(check.violations, args.acknowledged)
  ) {
    return { blocked: null, check };
  }
  await recordSalesInvoiceLineOutcome(ctx, args, "blocked", check);
  return { blocked: check, check };
}

/** Record a line check's outcome against the line it is about. */
export function recordSalesInvoiceLineOutcome(
  ctx: ServiceContext,
  line: { invoiceId: string; lineId: string | null; itemId: string },
  outcome: "blocked" | "acknowledged",
  check: SalesRuleCheck
) {
  return recordSalesRuleOutcome(ctx.asSystem.supabase, {
    companyId: ctx.company.id,
    userId: ctx.auditUserId,
    documentType: "salesInvoice",
    documentId: line.invoiceId,
    documentLineId: line.lineId,
    itemId: line.itemId,
    outcome,
    ...check
  });
}

/** The line as the column stores it: the discount as a 0–1 fraction. */
export function salesInvoiceLineRow<
  L extends { discountPercent?: number; invoiceLineType: string }
>(line: L): L {
  const row = withInvoiceLineTarget(line);
  return row.discountPercent === undefined
    ? row
    : { ...row, discountPercent: round(row.discountPercent / 100) };
}

export type StripeSendContext = {
  stripeAccountId: string;
  /** Resolved and linked by the preflight: it exists on the connected account. */
  stripeCustomerId: string;
};

/**
 * Resolve the Stripe customer the invoice will be billed to, and link it.
 *
 * Runs BEFORE the invoice is posted, so a customer that cannot be resolved
 * stops the post rather than leaving a posted invoice that was never sent.
 * The user's choice is never taken at face value: `linkStripeCustomerForBilling`
 * re-runs the resolution the modal showed and checks the action against the
 * connected account as it is now.
 */
export async function preflightStripeSend(
  ctx: ServiceContext,
  args: {
    invoiceId: string;
    customerContact?: string;
    stripeCustomerAction?: (typeof stripeCustomerActions)[number];
    stripeCustomerId?: string;
    stripeContactEmail?: string;
  }
): Promise<
  { ok: true; context: StripeSendContext } | { ok: false; message: string }
> {
  const serviceRole = ctx.asSystem.supabase;
  const { invoiceId } = args;
  if (!args.customerContact) {
    return { ok: false, message: "a customer contact is required" };
  }
  if (!args.stripeCustomerAction) {
    return { ok: false, message: "the Stripe customer was not confirmed" };
  }

  const [lines, shipment] = await Promise.all([
    getSalesInvoiceLines(serviceRole, invoiceId),
    getSalesInvoiceShipment(serviceRole, invoiceId)
  ]);
  // The same arithmetic the send reconciles against, so an invoice billable
  // only through its surcharges is not refused here as empty.
  const { total } = expectedConnectInvoiceTotal({
    lines: toStripeInvoiceLines(lines.data ?? []),
    shippingCost: shipment.data?.shippingCost ?? undefined
  });
  if (total <= 0) {
    return { ok: false, message: "Stripe cannot send a zero-amount invoice" };
  }

  const billingCustomerId = await getBillingCustomerId(
    serviceRole,
    invoiceId,
    ctx.company.id
  );
  if (!billingCustomerId) {
    return { ok: false, message: "this invoice has no customer to bill" };
  }

  const linked = await linkStripeCustomerForBilling({
    serviceRole,
    db: ctx.asSystem.pg,
    companyId: ctx.company.id,
    userId: ctx.auditUserId,
    billingCustomerId,
    customerContactId: args.customerContact,
    action: args.stripeCustomerAction,
    stripeCustomerId: args.stripeCustomerId,
    contactEmail: args.stripeContactEmail
  });
  if (!linked.ok) return linked;
  return {
    ok: true,
    context: {
      stripeAccountId: linked.stripeAccountId,
      stripeCustomerId: linked.stripeCustomerId
    }
  };
}

/**
 * File a posted invoice's PDF and send it. Past the post nothing is undone:
 * a failure stamps `sendError` on the invoice (so it shows "Not sent" with a
 * Send retry, as invoice automation does) and is returned as the warning.
 */
export async function sendPostedSalesInvoice(
  ctx: ServiceContext,
  args: {
    invoiceId: string;
    notification: "Email" | "Stripe" | null;
    customerContact?: string;
    cc?: string[];
    stripeSend: StripeSendContext | null;
    stripeDueDate?: string;
    locale: string;
  }
): Promise<string | null> {
  const { invoiceId, notification, locale } = args;
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  const stampSendError = async (sendError: string) => {
    if (!notification) return;
    const stamped = await serviceRole
      .from("salesInvoice")
      .update({ sendError })
      .eq("id", invoiceId)
      .eq("companyId", companyId);
    if (stamped.error) {
      logger.error("Failed to stamp sales invoice send error", {
        companyId,
        invoiceId,
        error: stamped.error
      });
    }
  };
  const stampSent = async (sentTo: string) => {
    const stamped = await serviceRole
      .from("salesInvoice")
      .update({ sentAt: datetime.timestamp(), sentTo, sendError: null })
      .eq("id", invoiceId)
      .eq("companyId", companyId);
    if (stamped.error) {
      logger.error("Failed to stamp sales invoice as sent", {
        companyId,
        invoiceId,
        error: stamped.error
      });
    }
  };
  const fail = async (warning: string, sendError = warning) => {
    await stampSendError(sendError);
    return warning;
  };

  const salesInvoice = await getSalesInvoice(serviceRole, invoiceId);
  if (salesInvoice.error) {
    logger.error("Failed to read the posted sales invoice", {
      companyId,
      invoiceId,
      error: salesInvoice.error
    });
    return "Failed to get sales invoice";
  }

  let filed: {
    path: string;
    fileName: string;
    document: Awaited<ReturnType<typeof loadSalesInvoiceDocument>>;
  };
  try {
    const document = await loadSalesInvoiceDocument({
      client: serviceRole,
      companyId,
      companyGroupId: ctx.company.groupId,
      invoiceId,
      locale,
      storageUrl: SUPABASE_URL ?? ""
    });
    const file = await renderSalesInvoicePdf(document.pdfProps);
    const fileName = stripSpecialCharacters(
      `${salesInvoice.data.invoiceId} - ${datetime.timestamp().slice(0, -5)}.pdf`
    );
    const { opportunityId } = salesInvoice.data;
    const path = `${companyId}/${opportunityId ? `opportunity/${opportunityId}` : `sales-invoice/${invoiceId}`}/${fileName}`;

    const upload = await storage(serviceRole)
      .company(companyId)
      .upload(path, file, {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: true
      });
    if (upload.error) {
      logger.error("Failed to upload the sales invoice PDF", {
        companyId,
        invoiceId,
        error: upload.error
      });
      return fail("Failed to upload file", "Failed to upload the invoice PDF");
    }

    const recorded = await upsertDocument(serviceRole, {
      path,
      name: fileName,
      size: round(file.byteLength / 1024, 0),
      sourceDocument: "Sales Invoice",
      sourceDocumentId: invoiceId,
      readGroups: [userId],
      writeGroups: [userId],
      createdBy: userId,
      companyId
    });
    if (recorded.error) {
      logger.error("Failed to record the sales invoice PDF", {
        companyId,
        invoiceId,
        error: recorded.error
      });
      return fail(
        "Failed to create document",
        "Failed to record the invoice PDF"
      );
    }
    filed = { path, fileName, document };
  } catch (err) {
    logger.error("Failed to generate the sales invoice PDF", {
      companyId,
      invoiceId,
      error: err
    });
    return fail("Failed to generate PDF", "Failed to generate the invoice PDF");
  }

  if (notification === "Email") {
    try {
      if (!args.customerContact) {
        return fail("Customer contact is required");
      }
      const [customer, seller] = await Promise.all([
        getCustomerContact(serviceRole, args.customerContact, companyId),
        getUser(serviceRole, userId)
      ]);
      const contact = customer?.data?.contact;
      if (!contact) return fail("Failed to get customer contact");
      if (!seller.data) return fail("Failed to get user");

      // The same reads the PDF rendered from.
      const template = SalesInvoiceEmail({
        ...filed.document.email,
        locale,
        recipient: {
          email: contact.email ?? "",
          firstName: contact.firstName ?? undefined,
          lastName: contact.lastName ?? undefined
        },
        sender: {
          email: seller.data.email,
          firstName: seller.data.firstName,
          lastName: seller.data.lastName
        }
      });
      const html = await renderAsync(template);
      const text = await renderAsync(template, { plainText: true });
      const signed = await storage(serviceRole)
        .company(companyId)
        .createSignedUrl(filed.path, 3600);
      if (signed.error) {
        logger.error("Failed to create signed URL for attachment", {
          storagePath: filed.path,
          error: signed.error
        });
      }

      await trigger("send-email", {
        to: [seller.data.email, contact.email!],
        cc: args.cc?.length ? args.cc : undefined,
        from: seller.data.email,
        subject: `Invoice ${filed.document.invoiceReadableId} from ${filed.document.email.company.name}`,
        html,
        text,
        attachments: signed.data
          ? [{ path: signed.data.signedUrl, filename: filed.fileName }]
          : undefined,
        companyId
      });

      // trigger() only queues the email, so sentAt here means "queued".
      await stampSent(
        [contact.email, ...(args.cc ?? [])].filter(Boolean).join(", ")
      );
    } catch (err) {
      logger.error("Failed to send sales invoice email", {
        companyId,
        invoiceId,
        error: err
      });
      return fail("Failed to send email");
    }
  }

  if (notification === "Stripe") {
    if (!args.stripeSend) {
      return fail(
        "Invoice posted, but the Stripe send was not prepared",
        "The Stripe send was not prepared"
      );
    }
    const { stripeAccountId, stripeCustomerId } = args.stripeSend;
    try {
      await sendPostedSalesInvoiceViaStripe({
        serviceRole,
        companyId,
        userId,
        invoiceId,
        stripeAccountId,
        stripeCustomerId,
        dueDateOverride: args.stripeDueDate,
        linkStripeInvoice: (stripeInvoiceId, metadata) =>
          createMappingService(ctx.asSystem.pg, companyId).link(
            "salesInvoice",
            invoiceId,
            STRIPE_CONNECT_INTEGRATION,
            stripeInvoiceId,
            { metadata }
          )
      });
    } catch (err) {
      logger.error("Failed to send sales invoice via Stripe", {
        companyId,
        invoiceId,
        error: err
      });
      const reason = err instanceof Error ? err.message : undefined;
      return fail(
        `Invoice posted, but failed to send via Stripe: ${reason ?? "unknown error"}`,
        reason ?? "Failed to send via Stripe"
      );
    }
    // Stripe emails the invoice itself; the stamp names the channel.
    await stampSent("Stripe");
  }

  return null;
}

// --- Purchase invoices --------------------------------------------------------

/** A Draft purchase invoice this company owns, or why it cannot be changed. */
export async function unlockedPurchaseInvoice(
  ctx: ServiceContext,
  invoiceId: string,
  message: string
) {
  const refused = await refuseUnlessOwned(ctx, "purchaseInvoice", {
    id: invoiceId
  });
  if (refused) return refused;
  const invoice = await getPurchaseInvoice(ctx.asCaller.supabase, invoiceId);
  if (invoice.error) {
    return ctx.error(
      "internal",
      "Failed to load purchase invoice",
      invoice.error
    );
  }
  if (isPurchaseInvoiceLocked(invoice.data.status)) {
    return ctx.error("rule", message);
  }
  return null;
}

// --- Payments -----------------------------------------------------------------

/**
 * Open invoices a payment can settle, for the payment's party: a receipt's
 * customer, or a disbursement's supplier.
 */
export async function getSeedableOpenInvoices(
  client: SupabaseClient<Database>,
  companyId: string,
  paymentType: "Receipt" | "Disbursement",
  partyId: string
) {
  const res =
    paymentType === "Receipt"
      ? await getOpenSalesInvoicesForCustomer(client, companyId, partyId)
      : await getOpenPurchaseInvoicesForSupplier(client, companyId, partyId);
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

/**
 * The early-payment discount per invoice as of `asOfDate`, in the invoice's
 * DOCUMENT currency: computed from `remainingDocument` (not the base
 * `balance`), so it lines up with the payment's cash total. All zero when
 * the currency cannot be resolved, so a missing currency never blocks.
 */
export async function getSeededDiscounts(
  client: SupabaseClient<Database>,
  companyId: string,
  companyGroupId: string,
  currencyCode: string,
  asOfDate: string,
  invoices: {
    id?: string | null;
    remainingDocument: number;
    dateIssued?: string | null;
    paymentTermId?: string | null;
  }[]
): Promise<Map<string, number>> {
  const currency = await getCurrencyByCode(
    client,
    companyGroupId,
    currencyCode
  );
  const currencyDecimals = currency.data?.decimalPlaces;
  if (currencyDecimals == null) {
    return new Map(invoices.map((inv) => [inv.id ?? "", 0]));
  }
  return computeEarlyPaymentDiscounts(client, {
    companyId,
    asOfDate,
    currencyDecimals,
    invoices: invoices.map((inv) => ({
      id: inv.id ?? "",
      balance: inv.remainingDocument,
      dateIssued: inv.dateIssued ?? null,
      paymentTermId: inv.paymentTermId ?? null
    }))
  });
}

/**
 * One application per selected invoice for its full open balance. Each
 * balance and rate is read again here, so the seed matches the current books.
 */
export async function seedPaymentApplications(
  ctx: ServiceContext,
  payment: {
    id: string;
    paymentType: "Receipt" | "Disbursement";
    customerId?: string;
    supplierId?: string;
    currencyCode: string;
    exchangeRate: number;
    paymentDate: string;
    seedInvoiceIds: string[];
  }
) {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const isReceipt = payment.paymentType === "Receipt";
  const partyId = isReceipt ? payment.customerId : payment.supplierId;
  if (!partyId) return;

  const open = await getSeedableOpenInvoices(
    client,
    companyId,
    payment.paymentType,
    partyId
  );
  const selected = open.filter(
    (inv) =>
      payment.seedInvoiceIds.includes(inv.id ?? "") &&
      inv.currencyCode === payment.currencyCode
  );
  if (selected.length === 0) return;

  // As of the payment date, which moves the discount window; `applied +
  // discount` still settles the invoice in full.
  const discounts = await getSeededDiscounts(
    client,
    companyId,
    ctx.company.groupId,
    payment.currencyCode,
    payment.paymentDate,
    selected
  );
  await replaceInvoiceSettlements(ctx.asSystem.pg, {
    paymentId: payment.id,
    companyId,
    createdBy: ctx.auditUserId,
    applications: selected.map((inv) => {
      // The discount is a DOCUMENT amount. `sourceAmount` is document
      // principal; `appliedAmount` and `discountAmount` are company base, so
      // the base half is converted at the invoice's own rate.
      const discountDocument = discounts.get(inv.id ?? "") ?? 0;
      const discountBase = discountDocument
        ? toBaseAmount(discountDocument, Number(inv.exchangeRate))
        : 0;
      return {
        targetSalesInvoiceId: isReceipt ? (inv.id ?? undefined) : undefined,
        targetPurchaseInvoiceId: isReceipt ? undefined : (inv.id ?? undefined),
        appliedAmount: round(Number(inv.balance ?? 0) - discountBase),
        sourceAmount: round(inv.remainingDocument - discountDocument),
        discountAmount: discountBase,
        writeOffAmount: 0,
        targetExchangeRate: Number(inv.exchangeRate),
        sourceExchangeRate: Number(payment.exchangeRate),
        appliedDate: payment.paymentDate
      };
    })
  });
}

// --- Receivables and payables ------------------------------------------------

/**
 * The two lines of a tie-out adjustment. A subledger above the GL (variance
 * > 0) means the control account is understated: receivables (an asset) is
 * debited to raise it, payables (a liability) credited. Below the GL, the
 * other way. The rounding account takes the opposite side.
 */
export function tieOutAdjustmentLines(args: {
  side: "receivables" | "payables";
  variance: number;
  controlAccount: string;
  offsetAccount: string;
  description: string;
}) {
  const { side, variance, description } = args;
  const amount = Math.abs(variance);
  const raisesWithDebit = side === "receivables";
  const controlDebit = variance > 0 ? raisesWithDebit : !raisesWithDebit;
  const line = (accountId: string, debit: boolean) => ({
    accountId,
    description,
    debit: debit ? amount : 0,
    credit: debit ? 0 : amount
  });
  return [
    line(args.controlAccount, controlDebit),
    line(args.offsetAccount, !controlDebit)
  ];
}

/**
 * Turn the tie-out variance of one side into a balanced Draft journal entry:
 * the control account against the rounding account. The variance is read
 * again here, never taken from the caller.
 */
export async function adjustTieOut(
  ctx: ServiceContext,
  side: "receivables" | "payables",
  asOfDate: string | undefined
) {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;

  // Adjusting entries only count once journals do (after the cutover).
  const settings = await getCompanySettings(client, companyId);
  if (!hasAccountingCutover(settings.data)) {
    return ctx.error("rule", "Accounting is not set up");
  }

  const date =
    asOfDate ??
    datetime
      .today(await getCachedCompanyTimeZone(client, companyId))
      .toString();
  const [tieOut, defaults] = await Promise.all([
    side === "receivables"
      ? getArTieOut(client, companyId, date)
      : getApTieOut(client, companyId, date),
    getDefaultAccounts(client, companyId)
  ]);
  const variance = Number(tieOut.data?.variance ?? 0);
  const controlAccount =
    side === "receivables"
      ? defaults.data?.receivablesAccount
      : defaults.data?.payablesAccount;
  const offsetAccount = defaults.data?.roundingAccount;
  if (!controlAccount || !offsetAccount || variance === 0) {
    return ctx.error("rule", `No ${side} variance to adjust`);
  }

  const journalEntry = await invokeCreate(ctx, {
    type: "journalEntry"
  });
  if (journalEntry.error || !journalEntry.data) {
    return ctx.error(
      "internal",
      "Failed to create adjusting entry",
      journalEntry.error
    );
  }
  const journalId = String(journalEntry.data.id);
  const description = `${side === "receivables" ? "AR" : "AP"} tie-out adjustment as of ${date}`;

  const saved = await saveJournalEntryWithLines(client, {
    journalEntryId: journalId,
    postingDate: date,
    description,
    updatedBy: ctx.auditUserId,
    companyId,
    companyGroupId: ctx.company.groupId,
    lines: tieOutAdjustmentLines({
      side,
      variance,
      controlAccount,
      offsetAccount,
      description
    })
  });
  if (saved.error) {
    // The Draft journal exists: the user finishes it by hand.
    logger.error("Failed to seed the adjusting entry", {
      companyId,
      journalId,
      error: saved.error
    });
    return {
      journalId,
      warning: "Entry created, but seeding the lines failed"
    };
  }
  return { journalId, warning: null };
}

// --- Reimbursements -------------------------------------------------------------

/**
 * The line sum must equal the header amount before a reimbursement may post.
 * The threshold is `EPSILON`, as in `post-reimbursement`'s `requireLineSum`
 * and `DocumentLineEditor` — NOT its 0.01 journal tolerance, which governs
 * the journal's debit/credit residual, a different question.
 */
export function linesBalanceHeader(
  headerAmount: number,
  lineAmounts: number[]
): boolean {
  const total = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  return Math.abs(total - headerAmount) <= EPSILON;
}

/** A reimbursement this company owns, with its lines. */
export async function loadReimbursement(
  ctx: ServiceContext,
  reimbursementId: string
) {
  const refused = await refuseUnlessOwned(ctx, "reimbursement", {
    id: reimbursementId
  });
  if (refused) return refused;
  const reimbursement = await getReimbursement(
    ctx.asCaller.supabase,
    ctx.company.id,
    reimbursementId
  );
  if (reimbursement.error || !reimbursement.data) {
    return ctx.error(
      "internal",
      "Failed to load reimbursement",
      reimbursement.error
    );
  }
  return reimbursement.data;
}
type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

export type { StripeCustomerSources };
// The pure Carbon → Stripe field mapping lives in its own module so it can be
// unit tested without this file's database and Stripe imports.
export { buildStripeCustomerInput };

/**
 * Gather every table a Stripe customer is assembled from.
 *
 * The billing address is NOT "the customer's first location" — Carbon points at
 * it explicitly through `customerPayment.invoiceCustomerLocationId`, which can
 * differ from the shipping location and can even belong to a different customer
 * (bill-to ≠ sold-to). Resolving it any other way bills the wrong address.
 *
 * `customerContactId` is scoped to `customerId = billingCustomerId` (not just
 * `companyId`) — `customerContact` carries no `companyId` column of its own, and
 * `billingCustomerId` is already validated against the invoice's `companyId` by
 * `getBillingCustomerId`. Without this, a caller who knows a contact UUID from
 * another tenant's customer could resolve that contact's email into this Stripe
 * lookup. With no contact (a contract need not name one) the email can only
 * come from the caller's `emailOverride`.
 */
export async function resolveStripeCustomerSources(
  serviceRole: ServiceRole,
  companyId: string,
  billingCustomerId: string,
  customerContactId: string | null
): Promise<StripeCustomerSources | null> {
  const [customer, contact, payment, customerTax] = await Promise.all([
    getCustomer(serviceRole, billingCustomerId, companyId),
    customerContactId
      ? serviceRole
          .from("customerContact")
          .select(
            "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes)"
          )
          .eq("id", customerContactId)
          .eq("customerId", billingCustomerId)
          .eq("companyId", companyId)
          .single()
      : { data: null },
    getCustomerPayment(serviceRole, billingCustomerId, companyId),
    getCustomerTax(serviceRole, billingCustomerId, companyId)
  ]);

  if (!customer.data) return null;

  // `getCustomerLocation` (singular) is the only reader that selects
  // `address.countryCode`; the plural `getCustomerLocations` embeds
  // `country(alpha2, name)` instead and cannot supply Stripe's `address.country`.
  const billingLocationId = payment.data?.invoiceCustomerLocationId;
  const billingLocation = billingLocationId
    ? (await getCustomerLocation(serviceRole, billingLocationId, companyId))
        .data
    : null;

  return {
    customer: customer.data,
    contact: contact.data,
    billingLocation,
    customerTax: customerTax.data
  };
}

/** A Stripe customer, reduced to what the confirmation panel shows. */
export type StripeCustomerSummary = {
  id: string;
  name: string | null;
  email: string | null;
};

/**
 * What posting this invoice through Stripe would do to the connected account.
 *
 * Deliberately a closed union rather than a bag of optional fields: every state
 * demands a different question of the user, and the caller must handle all of
 * them before anything is created on a merchant's live account.
 */
export type StripeCustomerResolution =
  | { state: "unavailable"; message: string }
  | { state: "missing-email"; customerName: string }
  | { state: "linked"; customer: StripeCustomerSummary }
  | { state: "match-found"; matches: StripeCustomerSummary[] }
  | {
      state: "new";
      preview: {
        name: string;
        email: string;
        phone?: string;
        addressLines: string[];
        taxExempt: "none" | "exempt" | "reverse";
      };
    };

function toSummary(customer: {
  id: string;
  name?: string | null;
  email?: string | null;
}): StripeCustomerSummary {
  return {
    id: customer.id,
    name: customer.name ?? null,
    email: customer.email ?? null
  };
}

/**
 * Who gets billed for this invoice.
 *
 * `invoiceCustomerId` is the bill-to and takes precedence — it is set when the
 * customer receiving the goods is not the one paying for them.
 */
export async function getBillingCustomerId(
  serviceRole: ServiceRole,
  invoiceId: string,
  companyId: string
): Promise<string | null> {
  const invoice = await serviceRole
    .from("salesInvoice")
    .select("customerId, invoiceCustomerId")
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (!invoice.data) return null;
  return invoice.data.invoiceCustomerId ?? invoice.data.customerId ?? null;
}

/**
 * Decide what would happen to the connected account, without changing anything.
 *
 * Read-only by design: both the modal (to ask the user) and the post action (to
 * check the answer it got back) call this. Running the same resolution on both
 * sides is what stops a client from claiming "just link me to cus_X" for a
 * customer that does not exist, belongs to another account, or was never offered.
 *
 * Starts from an INVOICE: the billed customer is its bill-to. A contract (or
 * anything else that already knows who it bills) uses
 * `resolveStripeCustomerForBilling` directly.
 */
export async function resolveStripeCustomer({
  serviceRole,
  db,
  companyId,
  invoiceId,
  customerContactId,
  emailOverride
}: {
  serviceRole: ServiceRole;
  db: Kysely<KyselyDatabase>;
  companyId: string;
  invoiceId: string;
  customerContactId: string;
  emailOverride?: string;
}): Promise<StripeCustomerResolutionResult> {
  const stripeAccountId = await getStripeConnectAccountId(
    serviceRole,
    companyId
  );
  if (!stripeAccountId) return notConnected();

  const billingCustomerId = await getBillingCustomerId(
    serviceRole,
    invoiceId,
    companyId
  );
  if (!billingCustomerId) {
    return {
      resolution: {
        state: "unavailable",
        message: "this invoice has no customer to bill"
      },
      sources: null
    };
  }

  return resolveForAccount({
    serviceRole,
    db,
    companyId,
    stripeAccountId,
    billingCustomerId,
    customerContactId,
    emailOverride
  });
}

type StripeCustomerResolutionResult =
  | { resolution: StripeCustomerResolution; sources: null }
  | {
      resolution: StripeCustomerResolution;
      sources: StripeCustomerSources;
      stripeAccountId: string;
      billingCustomerId: string;
      input: ConnectCustomerInput | null;
    };

function notConnected(): StripeCustomerResolutionResult {
  return {
    resolution: {
      state: "unavailable",
      message: "Stripe Connect is not connected for this company"
    },
    sources: null
  };
}

/**
 * `resolveStripeCustomer`, starting from the customer who is billed rather
 * than from an invoice. `billingCustomerId` must already be the bill-to (a
 * contract's `invoiceCustomerId ?? customerId`); it is loaded scoped to
 * `companyId`, so a customer of another company resolves to `unavailable`
 * before anything reaches Stripe.
 *
 * `customerContactId` is optional: a contract need not name an invoice
 * contact, and the Stripe customer's email can then come only from
 * `emailOverride`.
 */
export async function resolveStripeCustomerForBilling({
  serviceRole,
  db,
  companyId,
  billingCustomerId,
  customerContactId,
  emailOverride
}: {
  serviceRole: ServiceRole;
  db: Kysely<KyselyDatabase>;
  companyId: string;
  billingCustomerId: string;
  customerContactId?: string | null;
  emailOverride?: string;
}): Promise<StripeCustomerResolutionResult> {
  const stripeAccountId = await getStripeConnectAccountId(
    serviceRole,
    companyId
  );
  if (!stripeAccountId) return notConnected();

  return resolveForAccount({
    serviceRole,
    db,
    companyId,
    stripeAccountId,
    billingCustomerId,
    customerContactId,
    emailOverride
  });
}

async function resolveForAccount({
  serviceRole,
  db,
  companyId,
  stripeAccountId,
  billingCustomerId,
  customerContactId,
  emailOverride
}: {
  serviceRole: ServiceRole;
  db: Kysely<KyselyDatabase>;
  companyId: string;
  stripeAccountId: string;
  billingCustomerId: string;
  customerContactId?: string | null;
  emailOverride?: string;
}): Promise<StripeCustomerResolutionResult> {
  const sources = await resolveStripeCustomerSources(
    serviceRole,
    companyId,
    billingCustomerId,
    customerContactId ?? null
  );
  if (!sources) {
    return {
      resolution: {
        state: "unavailable",
        message: "the customer could not be loaded"
      },
      sources: null
    };
  }

  const found = { stripeAccountId, billingCustomerId, sources };
  const input = buildStripeCustomerInput(sources, emailOverride);

  // No email means no invoice can be sent, so ask for one before looking
  // anything up — an email is also the only key we can match Stripe on.
  if (!input) {
    return {
      ...found,
      input: null,
      resolution: {
        state: "missing-email",
        customerName: sources.customer.name ?? ""
      }
    };
  }

  const mappingService = createMappingService(db, companyId);
  const mapping = await mappingService.getByEntity(
    "customer",
    billingCustomerId,
    STRIPE_CONNECT_INTEGRATION
  );

  if (mapping?.externalId) {
    const existing = await retrieveConnectCustomer(
      stripeAccountId,
      mapping.externalId
    );
    // A mapping whose customer was deleted in the Stripe dashboard falls
    // through to the search below rather than failing the post.
    if (existing) {
      return {
        ...found,
        input,
        resolution: { state: "linked", customer: toSummary(existing) }
      };
    }
  }

  const matches = await findConnectCustomersByEmail(
    stripeAccountId,
    input.email
  );

  if (matches.length) {
    return {
      ...found,
      input,
      resolution: { state: "match-found", matches: matches.map(toSummary) }
    };
  }

  return {
    ...found,
    input,
    resolution: {
      state: "new",
      preview: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        addressLines: [
          input.address?.line1,
          input.address?.line2,
          [
            input.address?.city,
            input.address?.state,
            input.address?.postal_code
          ]
            .filter(Boolean)
            .join(", "),
          input.address?.country
        ].filter((line): line is string => Boolean(line)),
        taxExempt: input.taxExempt ?? "none"
      }
    }
  };
}

/**
 * Act on the user's Stripe customer choice for the customer who is billed,
 * and link the result in `externalIntegrationMapping`.
 *
 * The choice comes from a form (the invoice post modal, the contract confirm
 * modal), so it is never taken at face value: the resolution is re-run here —
 * the same one the modal showed — and the action is checked against what the
 * connected account looks like now. That closes the gap between the dialog
 * being shown and the form being submitted (a customer deleted in the Stripe
 * dashboard, a mapping written by a concurrent post, a hand-rolled form body
 * naming someone else's customer id).
 *
 * `contactEmail` is an address the user typed for a contact that had none; it
 * is saved to that contact before resolving, so the match search runs on it.
 */
export async function linkStripeCustomerForBilling({
  serviceRole,
  db,
  companyId,
  userId,
  billingCustomerId,
  customerContactId,
  action,
  stripeCustomerId,
  contactEmail
}: {
  serviceRole: ServiceRole;
  db: Kysely<KyselyDatabase>;
  companyId: string;
  userId: string;
  billingCustomerId: string;
  customerContactId?: string | null;
  action: (typeof stripeCustomerActions)[number];
  stripeCustomerId?: string;
  contactEmail?: string;
}): Promise<
  | {
      ok: true;
      stripeAccountId: string;
      stripeCustomerId: string;
      customerName: string;
    }
  | { ok: false; message: string }
> {
  if (contactEmail && customerContactId) {
    // customerContactId comes from the form and the service role bypasses RLS:
    // scope it so another company's contact is never read or rewritten.
    const contact = await getCustomerContact(
      serviceRole,
      customerContactId,
      companyId
    );
    if (contact.data && !contact.data.contact?.email) {
      const update = await updateCustomerContact(serviceRole, {
        contactId: contact.data.contactId,
        contact: {
          firstName: contact.data.contact?.firstName ?? "",
          lastName: contact.data.contact?.lastName ?? "",
          email: contactEmail
        }
      });
      if (update.error) {
        return { ok: false, message: "the contact email could not be saved" };
      }
    }
  }

  const resolveNow = () =>
    resolveStripeCustomerForBilling({
      db,
      serviceRole,
      companyId,
      billingCustomerId,
      customerContactId,
      emailOverride: contactEmail
    });

  const resolved = await resolveNow();

  if (!resolved.sources) {
    return {
      ok: false,
      message:
        resolved.resolution.state === "unavailable"
          ? resolved.resolution.message
          : "the Stripe customer could not be resolved"
    };
  }

  const { stripeAccountId, sources, input } = resolved;

  if (!input) {
    return { ok: false, message: "the selected contact has no email address" };
  }

  const customerName = sources.customer.name;
  if (!customerName) {
    return { ok: false, message: "the customer could not be loaded" };
  }

  let resolvedCustomerId: string;

  switch (action) {
    case "use-linked": {
      // The dialog showed a linked customer; it must still be linked and live.
      // Falling through to a create here would put a customer on the merchant's
      // account that the user never agreed to.
      if (resolved.resolution.state !== "linked") {
        return {
          ok: false,
          message:
            "the linked Stripe customer is no longer available — reopen the dialog"
        };
      }
      resolvedCustomerId = resolved.resolution.customer.id;
      break;
    }
    case "link-existing": {
      if (!stripeCustomerId) {
        return {
          ok: false,
          message: "no Stripe customer was selected to link"
        };
      }
      // Confirm the id exists on THIS connected account before writing it into
      // the mapping — an id from another account (or an invented one) would
      // otherwise be linked and every future invoice would fail at send.
      const existing = await retrieveConnectCustomer(
        stripeAccountId,
        stripeCustomerId
      );
      if (!existing) {
        return {
          ok: false,
          message: "that Stripe customer no longer exists on this account"
        };
      }
      resolvedCustomerId = existing.id;
      break;
    }
    case "create": {
      // A concurrent post (or a link made since the dialog opened) means this
      // Carbon customer now HAS a Stripe customer. Creating a second one is
      // exactly what this flow exists to prevent, so stop and let the user
      // confirm the one that now exists.
      if (resolved.resolution.state === "linked") {
        return {
          ok: false,
          message:
            "this customer was just linked to a Stripe customer — reopen the dialog to confirm it"
        };
      }
      try {
        resolvedCustomerId = await upsertConnectCustomer(
          stripeAccountId,
          null,
          input
        );
      } catch (err) {
        // A genuinely concurrent post for the same unlinked customer reuses
        // the same idempotency key (upsertConnectCustomer scopes it by
        // companyId+carbonCustomerId) — Stripe rejects the SECOND request
        // in-flight with an idempotency_error rather than returning the
        // first request's result. The winning request finishes and links
        // its mapping shortly after, so re-resolve once instead of failing
        // outright.
        if ((err as { type?: string }).type !== "idempotency_error") {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        const retried = await resolveNow();
        if (retried.resolution.state !== "linked") {
          throw err;
        }
        resolvedCustomerId = retried.resolution.customer.id;
      }
      break;
    }
  }

  await createMappingService(db, companyId).link(
    "customer",
    billingCustomerId,
    STRIPE_CONNECT_INTEGRATION,
    resolvedCustomerId,
    { createdBy: userId }
  );

  return {
    ok: true,
    stripeAccountId,
    stripeCustomerId: resolvedCustomerId,
    customerName
  };
}
export type ContractPostingAccounts = {
  deferredRevenue: SalesPostingAccount;
  contractAsset: SalesPostingAccount;
  fxGain: SalesPostingAccount | null;
  fxLoss: SalesPostingAccount | null;
};

/** A journal line beyond the builder's revenue legs, as a signed credit
 *  (negative = debit) on `account`. */
export type ContractReclassLine = {
  account: SalesPostingAccount;
  accountClass: "Asset" | "Liability" | "Revenue" | "Expense";
  description: string;
  credit: number;
};

/**
 * One contract invoice line's revenue side.
 * - `revenueLegs` replace the Sales leg in `buildSalesPostingLines`: the pool
 *   the movement draws first (Contract Assets for a normal line, Deferred
 *   Revenue for a negative one), clipped to the line's revenue so it shares
 *   the line's sign, then the other pool as the remainder.
 * - `reclass` are the lines that bring each pool to exactly its ledger delta
 *   and book the FX difference; they sum to zero, so the entry still
 *   balances. Empty in the base-currency case.
 */
export function planContractInvoiceLine(args: {
  position: ContractPosition;
  /** The line's sales revenue in base, signed (`salesRevenueBase`). */
  revenueBase: number;
  /** The invoice's rate, foreign units per base unit. */
  rate: number;
  accounts: ContractPostingAccounts;
  customerContractId: string;
}): {
  movement: ContractMovement;
  revenueLegs: SalesRevenueLeg[];
  reclass: ContractReclassLine[];
} {
  const { position, revenueBase, rate, accounts, customerContractId } = args;
  // The line's revenue in the contract (document) currency: the base price
  // was derived from it at the invoice's rate.
  const amount = round(revenueBase * rate);
  const movement = applyContractMovement({
    position,
    amount,
    rate,
    counterpart: "receivable"
  });
  const credits = movementCredits(movement, revenueBase);

  const asset = {
    account: accounts.contractAsset,
    accountClass: "Asset" as const,
    description: "Contract Assets",
    target: credits.asset
  };
  const deferred = {
    account: accounts.deferredRevenue,
    accountClass: "Liability" as const,
    description: "Deferred Revenue",
    target: credits.deferred
  };
  const [first, second] =
    revenueBase >= 0 ? [asset, deferred] : [deferred, asset];
  // Clipped into [0, revenueBase] (or [revenueBase, 0]): an explicit leg
  // must carry the line's sign and cannot exceed it.
  const firstLeg =
    revenueBase >= 0
      ? Math.min(Math.max(first.target, 0), revenueBase)
      : Math.max(Math.min(first.target, 0), revenueBase);
  const secondLeg = round(revenueBase - firstLeg);
  const document = {
    documentType: "Contract" as const,
    documentId: customerContractId
  };
  const revenueLegs: SalesRevenueLeg[] = [
    {
      account: first.account,
      accountClass: first.accountClass,
      description: first.description,
      amount: firstLeg,
      ...document
    },
    {
      account: second.account,
      accountClass: second.accountClass,
      description: second.description,
      ...document
    }
  ];

  const reclass: ContractReclassLine[] = [];
  const push = (line: Omit<ContractReclassLine, "credit">, value: number) => {
    const amount = round(value);
    if (amount !== 0) reclass.push({ ...line, credit: amount });
  };
  push(first, first.target - firstLeg);
  push(second, second.target - secondLeg);
  if (credits.fx !== 0) {
    const gain = credits.fx > 0;
    const account = gain ? accounts.fxGain : accounts.fxLoss;
    if (!account) {
      throw new Error(
        `Map the realized exchange ${gain ? "gain" : "loss"} account (an active ${gain ? "Revenue" : "Expense"} leaf) in the accounting defaults; this contract invoice clears a balance carried at another rate`
      );
    }
    push(
      {
        account,
        accountClass: gain ? "Revenue" : "Expense",
        description: gain ? "Realized FX gain" : "Realized FX loss"
      },
      credits.fx
    );
  }
  return { movement, revenueLegs, reclass };
}
type Tables = Database["public"]["Tables"];

type AccountDefaults = Tables["accountDefault"]["Row"];

/** The defaults the lines need, beyond the receivables, sales, shipping and
 *  tax accounts that every invoice reads. */
export type SalesInvoiceAccountNeeds = {
  /** A line defers to the Deferred Revenue default. */
  deferredRevenue: boolean;
  /** The invoice has rental lines, and one of them exercises a purchase
   *  option. */
  rental: { purchaseOption: boolean } | null;
  /** The invoice has contract lines. */
  contract: boolean;
  /** Other accounts that a line posts to, read with the defaults. */
  accountIds: (string | null | undefined)[];
};

/**
 * The accounts a sales invoice journal reads. The intercompany receivables
 * default falls back to receivables when empty. An empty optional default
 * becomes a stand-in before the cutover (`salesInvoiceStandIns`). Refuses an
 * empty default that a line needs and can never take a stand-in: the
 * deferral, rental and contract defaults name schedule rows.
 */
export function planSalesInvoiceAccounts(
  defaults: AccountDefaults,
  postingStatus: AutomaticJournalStatus,
  needs: SalesInvoiceAccountNeeds
) {
  const standIns = salesInvoiceStandIns(defaults, postingStatus);
  const ids = new Set<string>();
  const read = (...candidates: (string | null | undefined)[]) => {
    for (const id of candidates) if (id) ids.add(id);
  };

  // An intercompany customer books to Inter-Company Receivables, resolved from
  // accountDefault (a stable id), never by account number.
  const receivables = {
    standard: defaults.receivablesAccount,
    intercompany: resolveDefaultAccount(
      defaults,
      "intercompanyReceivablesAccount",
      postingStatus
    ).accountId
  };
  const shippingAccountId = standIns.defaultId("salesShippingRevenueAccount");
  read(
    receivables.standard,
    receivables.intercompany,
    defaults.salesAccount,
    shippingAccountId,
    defaults.salesTaxPayableAccount
  );

  // A dated line with no deferral account refuses to post rather than book
  // deferrable revenue straight to Sales.
  const deferredRevenueAccountId = needs.deferredRevenue
    ? defaults.deferredRevenueAccount
    : null;
  if (needs.deferredRevenue && !deferredRevenueAccountId) {
    throw new MissingAccountDefaultError("deferredRevenueAccount");
  }
  read(deferredRevenueAccountId);

  // Rental lines always post through deferred revenue, contract assets and
  // rental income: rent is recognized by schedule, never at billing.
  let rentalAccountIds: Record<
    "deferredRevenue" | "contractAsset" | "rentalIncome",
    string
  > | null = null;
  if (needs.rental) {
    const {
      deferredRevenueAccount,
      contractAssetAccount,
      rentalIncomeAccount
    } = defaults;
    if (
      !deferredRevenueAccount ||
      !contractAssetAccount ||
      !rentalIncomeAccount
    ) {
      throw new InvalidInputError(
        "Rental invoices need the Deferred Revenue, Contract Assets and Rental Income accounts mapped in the accounting defaults"
      );
    }
    rentalAccountIds = {
      deferredRevenue: deferredRevenueAccount,
      contractAsset: contractAssetAccount,
      rentalIncome: rentalIncomeAccount
    };
    read(deferredRevenueAccount, contractAssetAccount, rentalIncomeAccount);
    // Read with the others, but only required (and validated) once the
    // agreement lines show a Sale line (`netInvestmentInLeasesAccount`).
    read(standIns.defaultId("netInvestmentInLeasesAccount"));
    // An exercised purchase option settles the rest of the net investment to
    // one of these; each is required only when its settlement leg is.
    if (needs.rental.purchaseOption) {
      read(
        defaults.costOfGoodsSoldAccount,
        standIns.defaultId("leaseRevenueAccount")
      );
    }
  }

  // Contract lines post to Deferred Revenue / Contract Assets, and to
  // realized FX when a pool carried at another rate is cleared.
  if (needs.contract) {
    read(
      defaults.deferredRevenueAccount,
      defaults.contractAssetAccount,
      defaults.realizedExchangeGainAccount,
      defaults.realizedExchangeLossAccount
    );
  }
  read(...needs.accountIds);

  return {
    defaults,
    standIns,
    receivables,
    shippingAccountId,
    deferredRevenueAccountId,
    rentalAccountIds,
    contract: needs.contract,
    /** The ids to read. A stand-in is not an account. */
    accountIds: [...ids].filter((id) => !standIns.isPlaceholder(id))
  };
}

export type SalesInvoiceAccountPlan = ReturnType<
  typeof planSalesInvoiceAccounts
>;

/** An active posting account of the class. */
export const isLeaf = (
  account: SalesPostingAccount | null | undefined,
  accountClass: string
): account is SalesPostingAccount =>
  !!account &&
  account.class === accountClass &&
  account.active &&
  !account.isGroup;

/**
 * The accounts the plan read, with a stand-in for each placeholder. Refuses
 * a deferral, rental or contract account that is not an active leaf of its
 * class: the schedule rows and the recognition run credit them later, even
 * when this posting skips them.
 */
export function resolveSalesInvoiceAccounts(
  plan: SalesInvoiceAccountPlan,
  rows: Iterable<SalesPostingAccount>,
  companyGroupId: string
) {
  const accountsById = new Map<string, SalesPostingAccount>();
  for (const row of rows) accountsById.set(row.id, row);
  // A stand-in resolves to an account of the class its default must have;
  // the journal insert swaps it for Retained Earnings.
  for (const placeholder of plan.standIns.placeholderAccounts(companyGroupId)) {
    accountsById.set(placeholder.id, placeholder);
  }
  const account = (id: string | null | undefined) =>
    id ? accountsById.get(id) : undefined;

  const deferredRevenue = plan.deferredRevenueAccountId
    ? (account(plan.deferredRevenueAccountId) ?? null)
    : null;
  if (plan.deferredRevenueAccountId && !isLeaf(deferredRevenue, "Liability")) {
    throw new Error(
      "Deferred Revenue account is invalid; expected an active Liability leaf in this company group"
    );
  }

  let rental: Record<
    "deferredRevenue" | "contractAsset" | "rentalIncome",
    SalesPostingAccount
  > | null = null;
  if (plan.rentalAccountIds) {
    const resolved = (
      key: keyof NonNullable<SalesInvoiceAccountPlan["rentalAccountIds"]>,
      accountClass: string,
      label: string
    ) => {
      const candidate = account(plan.rentalAccountIds?.[key]);
      if (!isLeaf(candidate, accountClass)) {
        throw new Error(
          `${label} account is invalid; expected an active ${accountClass} leaf in this company group`
        );
      }
      return candidate;
    };
    rental = {
      deferredRevenue: resolved(
        "deferredRevenue",
        "Liability",
        "Deferred Revenue"
      ),
      contractAsset: resolved("contractAsset", "Asset", "Contract Assets"),
      rentalIncome: resolved("rentalIncome", "Revenue", "Rental Income")
    };
  }

  let contract: ContractPostingAccounts | null = null;
  if (plan.contract) {
    const leaf = (
      id: string | null | undefined,
      accountClass: string,
      label: string,
      required: boolean
    ) => {
      const candidate = account(id);
      if (!id && !required) return null;
      // The FX accounts are only needed when a line clears a pool carried at
      // another rate; the planner refuses then.
      if (!required && !isLeaf(candidate, accountClass)) return null;
      if (!isLeaf(candidate, accountClass)) {
        if (!id) {
          throw new InvalidInputError(
            `Contract invoices need the ${label} account mapped in the accounting defaults`
          );
        }
        throw new Error(
          `${label} account is invalid; expected an active ${accountClass} leaf in this company group`
        );
      }
      return candidate;
    };
    const { defaults } = plan;
    contract = {
      deferredRevenue: leaf(
        defaults.deferredRevenueAccount,
        "Liability",
        "Deferred Revenue",
        true
      )!,
      contractAsset: leaf(
        defaults.contractAssetAccount,
        "Asset",
        "Contract Assets",
        true
      )!,
      fxGain: leaf(
        defaults.realizedExchangeGainAccount,
        "Revenue",
        "Realized Exchange Gain",
        false
      ),
      fxLoss: leaf(
        defaults.realizedExchangeLossAccount,
        "Expense",
        "Realized Exchange Loss",
        false
      )
    };
    // The run recognizes from both pools into Sales.
    leaf(defaults.salesAccount, "Revenue", "Sales", true);
  }

  const receivablesAccountId = (intercompany: boolean) =>
    intercompany ? plan.receivables.intercompany : plan.receivables.standard;

  return {
    defaults: plan.defaults,
    standIns: plan.standIns,
    shippingAccountId: plan.shippingAccountId,
    account,
    receivablesAccountId,
    /** The accounts of the AR, sales, shipping and tax legs. */
    charges: (intercompany: boolean) => ({
      receivables: account(receivablesAccountId(intercompany)),
      sales: account(plan.defaults.salesAccount),
      shipping: account(plan.shippingAccountId),
      tax: account(plan.defaults.salesTaxPayableAccount)
    }),
    deferredRevenue,
    rental,
    contract
  };
}

export type SalesInvoiceAccounts = ReturnType<
  typeof resolveSalesInvoiceAccounts
>;

/**
 * The Net Investment in Leases account, which a sales-type line's rent and
 * purchase option collect. Null when no agreement line is a sale: an
 * operating-only invoice never needs the account mapped.
 */
export function netInvestmentInLeasesAccount(
  accounts: SalesInvoiceAccounts,
  agreementLines: Iterable<
    Pick<Tables["rentalAgreementLine"]["Row"], "lessorClassification">
  >
): SalesPostingAccount | null {
  if (
    ![...agreementLines].some((line) => line.lessorClassification === "Sale")
  ) {
    return null;
  }
  const id = accounts.standIns.defaultId("netInvestmentInLeasesAccount");
  const candidate = accounts.account(id);
  if (!id) {
    throw new Error(
      "Rentals treated as a sale need the Net Investment in Leases account mapped in the accounting defaults"
    );
  }
  if (!isLeaf(candidate, "Asset")) {
    throw new Error(
      "Net Investment in Leases account is invalid; expected an active Asset leaf in this company group"
    );
  }
  return candidate;
}
/** A journal line as the posting inserts it, before its journal exists. */
export type SalesInvoiceJournalLine = Omit<
  Tables["journalLine"]["Insert"],
  "journalId"
>;

/** The invoice line fields the journal reads. */
export type SalesInvoiceLine = Pick<
  Tables["salesInvoiceLine"]["Row"],
  | "id"
  | "invoiceLineType"
  | "itemId"
  | "quantity"
  | "unitPrice"
  | "discountPercent"
  | "shippingCost"
  | "addOnCost"
  | "nonTaxableAddOnCost"
  | "taxPercent"
  | "salesOrderLineId"
  | "methodType"
  | "locationId"
  | "projectId"
  | "customerContractId"
  | "customerContractLineId"
  | "serviceStartDate"
  | "serviceEndDate"
  | "assetId"
  | "rentalAgreementLineId"
  | "rentalBillingPeriodId"
  | "rentalLineType"
>;

/** The line types that sell an item. */
export const ITEM_LINE_TYPES: ReadonlySet<string> = new Set([
  "Part",
  "Service",
  "Consumable",
  "Fixture",
  "Material",
  "Tool"
]);

/**
 * An item line with no sales order that is not built to order. Its posting
 * ships it: it writes the shipment and the item ledger, and its COGS pair
 * is in the invoice journal. A sales-order or Make-to-Order line keeps the
 * COGS that its shipment posted.
 */
export function isDirectItemLine(line: SalesInvoiceLine): boolean {
  return (
    ITEM_LINE_TYPES.has(line.invoiceLineType) &&
    line.salesOrderLineId === null &&
    line.methodType !== "Make to Order"
  );
}

/**
 * The service range of a line whose revenue the posting defers. Only a
 * Service line is deferred: every other item type is a physical good, earned
 * when it ships, so dates left on one (a line whose type changed, an API
 * write) must not move its revenue. Rental and contract lines defer through
 * their own paths (plan D6).
 */
export function deferredServicePeriod(
  line: SalesInvoiceLine
): { startDate: string; endDate: string } | null {
  return line.invoiceLineType === "Service" &&
    !line.customerContractLineId &&
    line.serviceStartDate &&
    line.serviceEndDate
    ? { startDate: line.serviceStartDate, endDate: line.serviceEndDate }
    : null;
}

/** Where a line's revenue goes. The legs, AR, tax and shipping follow. */
export type SalesLineRevenue =
  /** The Sales Account, whatever the line's type. */
  | { book: "sales" }
  /** Deferred Revenue now, recognized straight-line over the period. */
  | { book: "deferral"; startDate: string; endDate: string }
  /** These revenue legs. The last leg takes the remainder. */
  | { book: "legs"; legs: SalesRevenueLeg[] }
  /** The contract line's position (`planContractInvoiceLine`). */
  | { book: "contract" }
  /** The rental agreement line (`planRentalLine`). */
  | { book: "rental" }
  /** The asset's disposal: proceeds against its carrying value. */
  | { book: "disposal" };

/** Where the posting books a line's revenue. A Comment line posts nothing
 *  and never gets here. */
export function postingLineRevenue(line: SalesInvoiceLine): SalesLineRevenue {
  if (ITEM_LINE_TYPES.has(line.invoiceLineType)) {
    if (line.customerContractLineId) return { book: "contract" };
    const period = deferredServicePeriod(line);
    return period ? { book: "deferral", ...period } : { book: "sales" };
  }
  if (line.invoiceLineType === "Fixed Asset") return { book: "disposal" };
  if (line.invoiceLineType === "Rental") return { book: "rental" };
  throw new Error("Unsupported invoice line type");
}

type FixedAssetClassAccounts = Pick<
  Tables["fixedAssetClass"]["Row"],
  | "assetAccountId"
  | "accumulatedDepreciationAccountId"
  | "writeOffAccountId"
  | "gainOnDisposalAccountId"
  | "lossOnDisposalAccountId"
>;

/** The defaults the posting reads for these lines and the classes of the
 *  assets that they sell. */
export function postingAccountNeeds(
  lines: readonly SalesInvoiceLine[],
  assetClasses: Iterable<FixedAssetClassAccounts | null>
): SalesInvoiceAccountNeeds {
  const rentalLines = lines.filter((line) => line.invoiceLineType === "Rental");
  return {
    deferredRevenue: lines.some((line) => deferredServicePeriod(line) !== null),
    rental:
      rentalLines.length > 0
        ? {
            purchaseOption: rentalLines.some(
              (line) => line.rentalLineType === "Purchase Option"
            )
          }
        : null,
    contract: lines.some(
      (line) =>
        !!line.customerContractLineId && line.invoiceLineType !== "Comment"
    ),
    accountIds: [...assetClasses].flatMap((assetClass) => [
      assetClass?.assetAccountId,
      assetClass?.accumulatedDepreciationAccountId,
      assetClass?.writeOffAccountId,
      assetClass?.gainOnDisposalAccountId,
      assetClass?.lossOnDisposalAccountId
    ])
  };
}

export type RentalAgreementLineFacts = Pick<
  Tables["rentalAgreementLine"]["Row"],
  "id" | "rentalAgreementId" | "itemId" | "lessorClassification"
>;

/** A fixed asset sold on a Fixed Asset line, with its class's accounts. */
export type DisposableAsset = Pick<
  Tables["fixedAsset"]["Row"],
  | "id"
  | "status"
  | "acquisitionCost"
  | "accumulatedDepreciation"
  | "locationId"
  | "fixedAssetClassId"
> & {
  fixedAssetClass:
    | (Pick<Tables["fixedAssetClass"]["Row"], "id"> & FixedAssetClassAccounts)
    | null;
};

/** The facts a contract line moves its position with. */
export type SalesInvoiceContractFacts = {
  /** Each contract line's position before this invoice. */
  positions: ReadonlyMap<string, ContractPosition>;
  /** The invoice's rate, foreign units per base unit. */
  rate: number;
};

/** The facts a rental line posts with, by agreement line. */
export type SalesInvoiceRentalFacts = {
  netInvestmentInLeases: SalesPostingAccount | null;
  billingPeriods: ReadonlyMap<
    string,
    { periodStart: string; periodEnd: string }
  >;
  /** Unbilled Accrual rows (Planned or Posted). */
  accruals: ReadonlyMap<string, RentalScheduleFact[]>;
  /** Planned Deferral rows. */
  deferrals: ReadonlyMap<string, RentalScheduleFact[]>;
  /** The lease schedule's closing balance, which a purchase option settles. */
  leaseClosing: ReadonlyMap<
    string,
    { periodDate: string; closingNetInvestment: number }
  >;
};

/** The facts a Fixed Asset line disposes its asset with. */
export type SalesInvoiceDisposalFacts = {
  assets: ReadonlyMap<string, DisposableAsset>;
  /** The latest disposal of each asset, which its shipment wrote. */
  latestDisposal: ReadonlyMap<
    string,
    Pick<Tables["fixedAssetDisposal"]["Row"], "id" | "netBookValueAtDisposal">
  >;
};

export type SalesInvoiceJournalFacts = {
  companyId: string;
  companyGroupId: string;
  invoice: {
    id: string;
    customerId: string | null;
    customerReference: string | null;
  };
  customerTypeId: string | null;
  /** The customer's company in the group; null for an outside customer. */
  intercompanyPartnerId: string | null;
  /** In posting order. */
  lines: readonly SalesInvoiceLine[];
  /** The header shipping of each line (`allocateSalesHeaderShipping`). */
  headerShipping: ReadonlyMap<string, number>;
  items: ReadonlyMap<
    string,
    Pick<Tables["item"]["Row"], "itemTrackingType" | "replenishmentSystem">
  >;
  /** Each item's posting group. */
  postingGroups: ReadonlyMap<string, string | null>;
  salesOrderLines: ReadonlyMap<
    string,
    Pick<Tables["salesOrderLine"]["Row"], "locationId" | "sentComplete">
  >;
  assets: ReadonlyMap<
    string,
    Pick<Tables["fixedAsset"]["Row"], "locationId" | "fixedAssetClassId">
  >;
  rentalAgreementLines: ReadonlyMap<string, RentalAgreementLineFacts>;
  accounts: SalesInvoiceAccounts;
  /** Where each line's revenue goes. */
  revenue: (line: SalesInvoiceLine) => SalesLineRevenue;
  /** The cost of a direct inventory line's COGS pair, called once per such
   *  line in order. Null writes no pair. */
  directCost: (line: SalesInvoiceLine) => number | null;
  /** Required by a `contract` line. */
  contract: SalesInvoiceContractFacts | null;
  /** Required by a `rental` line. */
  rental: SalesInvoiceRentalFacts | null;
  /** Required by a `disposal` line. */
  disposal: SalesInvoiceDisposalFacts | null;
};

/** What the posting writes with the journal, from the same lines. */
export type SalesInvoiceJournal = {
  lines: SalesInvoiceJournalLine[];
  /** One per line: the dimensions it carries. */
  metadata: SalesPostingMetadata[];
  /** Deferred service lines, spread into Planned Deferral rows. */
  deferrals: {
    salesInvoiceLineId: string;
    amountBase: number;
    debitAccountId: string;
    creditAccountId: string;
    startDate: string;
    endDate: string;
  }[];
  /** One movement per contract line that moved its position. */
  contractMovements: {
    customerContractId: string;
    customerContractLineId: string;
    salesInvoiceLineId: string;
    movement: ContractMovement;
  }[];
  /** Planned Deferral rows of rent. */
  rentalSchedules: (ScheduleRow & {
    salesInvoiceLineId: string;
    rentalAgreementLineId: string;
    debitAccountId: string;
    creditAccountId: string;
  })[];
  /** Accrual rows this invoice bills, by the invoice line that bills them. */
  billedAccruals: Map<string, string>;
  /** The journalLineReference of each direct line's COGS pair, by invoice
   *  line id: the posting fills that pair once it relieves the cost. */
  directCogsReferences: Map<string, string>;
  /** Assets sold after their shipment wrote the disposal. */
  shippedDisposals: {
    disposalId: string;
    assetId: string;
    saleProceeds: number;
    gainLoss: number;
  }[];
  /** Assets sold on the invoice alone. */
  directDisposals: {
    assetId: string;
    saleProceeds: number;
    netBookValue: number;
    gainLoss: number;
  }[];
};

/** The metadata of a line's legs, by its type. */
function lineMetadata(
  facts: SalesInvoiceJournalFacts,
  line: SalesInvoiceLine
): SalesPostingMetadata {
  const projectId = line.projectId ?? null;
  if (line.invoiceLineType === "Fixed Asset") {
    const asset = line.assetId ? facts.assets.get(line.assetId) : undefined;
    const salesOrderLine = line.salesOrderLineId
      ? facts.salesOrderLines.get(line.salesOrderLineId)
      : undefined;
    return {
      customerTypeId: facts.customerTypeId,
      itemPostingGroupId: null,
      itemId: null,
      locationId:
        line.locationId ??
        salesOrderLine?.locationId ??
        asset?.locationId ??
        null,
      costCenterId: null,
      fixedAssetClassId: asset?.fixedAssetClassId ?? null,
      projectId
    };
  }
  if (line.invoiceLineType === "Rental") {
    const agreementLine = line.rentalAgreementLineId
      ? facts.rentalAgreementLines.get(line.rentalAgreementLineId)
      : undefined;
    return {
      customerTypeId: facts.customerTypeId,
      itemPostingGroupId: null,
      // The rented unit's item, for the Item dimension only.
      itemId: agreementLine?.itemId ?? null,
      locationId: line.locationId ?? null,
      costCenterId: null,
      fixedAssetClassId: null,
      projectId
    };
  }
  return {
    customerTypeId: facts.customerTypeId,
    itemPostingGroupId: line.itemId
      ? (facts.postingGroups.get(line.itemId) ?? null)
      : null,
    itemId: line.itemId ?? null,
    locationId: line.locationId ?? null,
    costCenterId: null,
    fixedAssetClassId: null,
    projectId
  };
}

/** The COGS pair of a direct inventory line, at `cost`: Dr Cost of Goods Sold,
 *  Cr the item's inventory account. */
function directCogsLines(
  facts: SalesInvoiceJournalFacts,
  line: SalesInvoiceLine,
  cost: number
): SalesInvoiceJournalLine[] {
  const { defaults } = facts.accounts;
  const item = line.itemId ? facts.items.get(line.itemId) : undefined;
  const inventoryAccount = resolveInventoryAccount(
    item?.replenishmentSystem ?? null,
    defaults
  );
  const keys = {
    quantity: round(line.quantity),
    documentType: "Invoice" as const,
    documentId: facts.invoice.id,
    externalDocumentId: facts.invoice.customerReference,
    journalLineReference: nanoid(),
    companyId: facts.companyId
  };
  return [
    {
      accountId: defaults.costOfGoodsSoldAccount,
      description: "Cost of Goods Sold",
      amount: round(debit("expense", cost)),
      ...keys
    },
    {
      accountId: inventoryAccount.account,
      description: inventoryAccount.description,
      amount: round(credit("asset", cost)),
      ...keys
    }
  ];
}

/**
 * Sets the cost of a direct line's COGS pair, written at zero before the
 * posting relieved the cost. The pair is found by its journalLineReference
 * (`directCogsReferences`), not by quantity, so two direct lines of one
 * quantity can never take each other's cost. Returns false when there is
 * no such pair.
 */
export function fillDirectCogs(
  lines: SalesInvoiceJournalLine[],
  journalLineReference: string | undefined,
  totalCost: number
): boolean {
  if (!journalLineReference) return false;
  const pair = lines.filter(
    (line) => line.journalLineReference === journalLineReference
  );
  const cogs = pair.find((line) => line.description === "Cost of Goods Sold");
  const inventory = pair.find((line) => line !== cogs);
  if (!cogs || !inventory) return false;
  cogs.amount = round(debit("expense", totalCost));
  inventory.amount = round(credit("asset", totalCost));
  return true;
}

const required = <T>(value: T | null, what: string): T => {
  if (value === null) throw new Error(`A sales invoice line needs ${what}`);
  return value;
};

/**
 * The journal of one sales invoice: for each line, its revenue legs (as
 * `facts.revenue` books them), shipping, tax and receivable through
 * `buildSalesPostingLines`, then the COGS pair of a direct inventory line.
 * Throws on the first line that cannot post.
 */
export function buildSalesInvoiceJournal(
  facts: SalesInvoiceJournalFacts
): SalesInvoiceJournal {
  const { accounts, invoice, companyId } = facts;
  const charges = accounts.charges(facts.intercompanyPartnerId !== null);
  // Each contract line's running position, so two lines of one contract
  // line on this invoice see each other.
  const positions = new Map(facts.contract?.positions ?? []);
  const journal: SalesInvoiceJournal = {
    lines: [],
    metadata: [],
    deferrals: [],
    contractMovements: [],
    rentalSchedules: [],
    billedAccruals: new Map(),
    directCogsReferences: new Map(),
    shippedDisposals: [],
    directDisposals: []
  };
  const push = (
    lines: SalesInvoiceJournalLine[],
    metadata: SalesPostingMetadata | SalesPostingMetadata[]
  ) => {
    lines.forEach((line, index) => {
      journal.lines.push(line);
      journal.metadata.push(
        Array.isArray(metadata) ? metadata[index]! : metadata
      );
    });
  };

  for (const line of facts.lines) {
    if (line.invoiceLineType === "Comment") continue;
    const revenue = facts.revenue(line);
    const metadata = lineMetadata(facts, line);
    const postingLine = {
      ...line,
      allocatedHeaderShipping: facts.headerShipping.get(line.id) ?? 0
    };
    const context = {
      companyId,
      companyGroupId: facts.companyGroupId,
      documentId: invoice.id,
      externalDocumentId: invoice.customerReference,
      documentLineReference: line.salesOrderLineId
        ? journalReference.to.salesInvoice(line.salesOrderLineId)
        : null,
      journalLineReference: nanoid(),
      intercompanyPartnerId: facts.intercompanyPartnerId
    };

    switch (revenue.book) {
      case "sales":
      case "legs": {
        const built = buildSalesPostingLines({
          line: {
            ...postingLine,
            // Booked as plain revenue, a rental or fixed-asset line needs no
            // rental legs and no disposal.
            invoiceLineType:
              line.invoiceLineType === "Rental" ||
              line.invoiceLineType === "Fixed Asset"
                ? "Part"
                : line.invoiceLineType
          },
          context,
          accounts: charges,
          revenueLegs: revenue.book === "legs" ? revenue.legs : undefined,
          metadata
        });
        push(built.lines, built.metadata);
        break;
      }
      case "deferral": {
        // The sales leg is credited to Deferred Revenue now, and a
        // straight-line schedule recognizes it into Sales later.
        const deferredRevenue = required(
          accounts.deferredRevenue,
          "the Deferred Revenue account to defer"
        );
        const built = buildSalesPostingLines({
          line: postingLine,
          context,
          accounts: charges,
          deferredRevenueAccount: deferredRevenue,
          metadata
        });
        push(built.lines, built.metadata);
        if (built.amounts.salesRevenueBase !== 0) {
          // The run credits Sales when it recognizes, so the revenue account
          // must be valid even though this posting skipped it.
          const salesAccount = charges.sales;
          if (!isLeaf(salesAccount, "Revenue")) {
            throw new Error(
              "Invalid or missing Sales Account; a deferred line needs an active Revenue leaf to recognize into"
            );
          }
          journal.deferrals.push({
            salesInvoiceLineId: line.id,
            // The builder's sales component IS the deferral leg in base
            // currency (credit("liability", x) === x).
            amountBase: built.amounts.salesRevenueBase,
            debitAccountId: deferredRevenue.id,
            creditAccountId: salesAccount.id,
            startDate: revenue.startDate,
            endDate: revenue.endDate
          });
        }
        break;
      }
      case "contract": {
        // A contract line moves its position: Cr Contract Assets for what the
        // run accrued ahead of billing, the rest Cr Deferred Revenue (a
        // negative line the reverse), and the run recognizes from there. No
        // schedule rows (plan D6).
        const contract = required(facts.contract, "its contract positions");
        const contractAccounts = required(
          accounts.contract,
          "the contract accounts"
        );
        const contractLineId = required(
          line.customerContractLineId,
          "a contract line"
        );
        const contractDocumentId = line.customerContractId ?? invoice.id;
        const position = positions.get(contractLineId) ?? EMPTY_POSITION;
        const plan = planContractInvoiceLine({
          position,
          revenueBase: roundSalesPostingAmounts(postingLine).salesRevenueBase,
          rate: contract.rate,
          accounts: contractAccounts,
          customerContractId: contractDocumentId
        });
        const built = buildSalesPostingLines({
          line: postingLine,
          context,
          accounts: charges,
          revenueLegs: plan.revenueLegs,
          metadata
        });
        push(built.lines, built.metadata);
        // Same journal line reference, so a VOID reverses them with the line.
        push(
          plan.reclass.map((reclass) => ({
            accountId: reclass.account.id,
            description: reclass.description,
            amount: signedCreditAmount(reclass.accountClass, reclass.credit),
            quantity: round(line.quantity),
            documentType: "Contract" as const,
            documentId: contractDocumentId,
            externalDocumentId: context.externalDocumentId,
            documentLineReference: context.documentLineReference,
            journalLineReference: context.journalLineReference,
            companyId
          })),
          metadata
        );
        positions.set(contractLineId, addMovement(position, plan.movement));
        if (
          plan.movement.deferredAmount !== 0 ||
          plan.movement.assetAmount !== 0 ||
          plan.movement.deferredBase !== 0 ||
          plan.movement.assetBase !== 0
        ) {
          journal.contractMovements.push({
            customerContractId: line.customerContractId!,
            customerContractLineId: contractLineId,
            salesInvoiceLineId: line.id,
            movement: plan.movement
          });
        }
        break;
      }
      case "disposal": {
        const disposalFacts = required(facts.disposal, "its asset facts");
        if (!line.assetId)
          throw new Error(
            `Fixed Asset invoice line ${line.id} has no asset selected`
          );
        const asset = disposalFacts.assets.get(line.assetId);
        const assetClass = asset?.fixedAssetClass;
        if (!asset || !assetClass)
          throw new Error(`Failed to fetch fixed asset/class ${line.assetId}`);
        const salesOrderLine = line.salesOrderLineId
          ? facts.salesOrderLines.get(line.salesOrderLineId)
          : undefined;
        const wasShipped =
          salesOrderLine?.sentComplete === true && !!line.salesOrderLineId;
        const disposal = wasShipped
          ? disposalFacts.latestDisposal.get(line.assetId)
          : undefined;
        if (wasShipped && !disposal) {
          throw new Error(
            `No disposal record found for asset ${line.assetId} — shipment must create it before invoice posting`
          );
        }
        const disposalAccounts = {
          gainAccount: accounts.account(assetClass.gainOnDisposalAccountId),
          lossAccount: accounts.account(assetClass.lossOnDisposalAccountId)
        };
        const built = buildSalesPostingLines({
          line: postingLine,
          context,
          accounts: charges,
          metadata,
          disposal:
            wasShipped && disposal
              ? {
                  mode: "shipment",
                  netBookValue: Number(disposal.netBookValueAtDisposal),
                  clearingAccount: accounts.account(
                    assetClass.writeOffAccountId
                  ),
                  ...disposalAccounts
                }
              : {
                  mode: "direct",
                  acquisitionCost: Number(asset.acquisitionCost),
                  accumulatedDepreciation: Number(
                    asset.accumulatedDepreciation
                  ),
                  assetAccount: accounts.account(assetClass.assetAccountId),
                  accumulatedDepreciationAccount: accounts.account(
                    assetClass.accumulatedDepreciationAccountId
                  ),
                  ...disposalAccounts
                }
        });
        push(built.lines, built.metadata);
        if (built.netBookValue === null || built.gainLoss === null) {
          throw new Error(
            "Fixed asset disposal posting is missing carrying values"
          );
        }
        if (wasShipped && disposal) {
          journal.shippedDisposals.push({
            disposalId: disposal.id,
            assetId: line.assetId,
            saleProceeds: built.saleProceeds,
            gainLoss: built.gainLoss
          });
        } else {
          journal.directDisposals.push({
            assetId: line.assetId,
            saleProceeds: built.saleProceeds,
            netBookValue: built.netBookValue,
            gainLoss: built.gainLoss
          });
        }
        break;
      }
      case "rental": {
        // A Rental line has no item: nothing ships, nothing leaves stock, and
        // there is no COGS. Only its revenue legs differ from a sale.
        const rental = required(facts.rental, "its rental facts");
        const rentalAccounts = required(accounts.rental, "the rental accounts");
        const agreementLine = line.rentalAgreementLineId
          ? facts.rentalAgreementLines.get(line.rentalAgreementLineId)
          : undefined;
        if (!agreementLine) {
          throw new Error(
            `Rental invoice line ${line.id} has no rental agreement line`
          );
        }
        if (!line.rentalLineType) {
          throw new Error(
            `Rental invoice line ${line.id} has no rental line type`
          );
        }
        const billingPeriod = line.rentalBillingPeriodId
          ? rental.billingPeriods.get(line.rentalBillingPeriodId)
          : undefined;
        if (line.rentalBillingPeriodId && !billingPeriod) {
          throw new Error(
            `Rental billing period ${line.rentalBillingPeriodId} was not found`
          );
        }
        const period = billingPeriod
          ? {
              periodStart: billingPeriod.periodStart,
              periodEnd: billingPeriod.periodEnd
            }
          : line.serviceStartDate && line.serviceEndDate
            ? {
                periodStart: line.serviceStartDate,
                periodEnd: line.serviceEndDate
              }
            : null;
        const plan = planRentalLine({
          lineType: line.rentalLineType,
          classification: agreementLine.lessorClassification,
          revenueBase: roundSalesPostingAmounts(postingLine).salesRevenueBase,
          period,
          unbilledAccruals: (
            rental.accruals.get(agreementLine.id) ?? []
          ).filter((row) => !journal.billedAccruals.has(row.id)),
          plannedDeferrals: rental.deferrals.get(agreementLine.id) ?? [],
          accounts: {
            ...rentalAccounts,
            netInvestmentInLeases: rental.netInvestmentInLeases
          },
          rentalAgreementId: agreementLine.rentalAgreementId
        });
        const built = buildSalesPostingLines({
          line: postingLine,
          context,
          accounts: charges,
          revenueLegs: plan.revenueLegs,
          metadata
        });
        push(built.lines, built.metadata);
        // An exercised purchase option derecognizes the whole net
        // investment: the schedule's closing balance less the option just
        // credited goes to COGS (a shortfall) or Lease Revenue (a gain), on
        // the same journal line reference so a VOID reverses it.
        if (
          line.rentalLineType === "Purchase Option" &&
          agreementLine.lessorClassification === "Sale" &&
          rental.netInvestmentInLeases
        ) {
          const closing = rental.leaseClosing.get(agreementLine.id);
          if (!closing) {
            throw new Error(
              `Rental agreement line ${agreementLine.id} has no lease schedule to settle the purchase option against`
            );
          }
          push(
            leaseSettlementJournalLines(
              purchaseOptionSettlement({
                closingTarget: closing.closingNetInvestment,
                // The Net Investment leg is the plan's only revenue leg.
                optionAmount: built.revenueLegAmounts[0] ?? 0,
                accounts: {
                  netInvestmentInLeases: rental.netInvestmentInLeases,
                  costOfGoodsSold: accounts.account(
                    accounts.defaults.costOfGoodsSoldAccount
                  ),
                  leaseRevenue: accounts.account(
                    accounts.standIns.defaultId("leaseRevenueAccount")
                  )
                },
                rentalAgreementId: agreementLine.rentalAgreementId
              }),
              {
                companyId,
                quantity: line.quantity,
                journalLineReference: context.journalLineReference,
                externalDocumentId: context.externalDocumentId,
                documentLineReference: context.documentLineReference
              }
            ),
            // Derecognition (COGS / Lease Revenue) is not the line's revenue
            // side, so it carries no project.
            { ...metadata, projectId: null }
          );
        }
        for (const accrualId of plan.billedAccrualIds) {
          journal.billedAccruals.set(accrualId, line.id);
        }
        // The deferred-revenue leg is always the last revenue leg; its posted
        // base amount is what the Deferral rows must sum to.
        const deferredAmount =
          built.revenueLegAmounts[built.revenueLegAmounts.length - 1] ?? 0;
        for (const row of rentalScheduleRows(plan.schedule, deferredAmount)) {
          journal.rentalSchedules.push({
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            scheduledDate: row.scheduledDate,
            amount: row.amount,
            salesInvoiceLineId: line.id,
            rentalAgreementLineId: agreementLine.id,
            debitAccountId: rentalAccounts.deferredRevenue.id,
            creditAccountId: rentalAccounts.rentalIncome.id
          });
        }
        break;
      }
    }

    // A direct line ships here, so its COGS is in this journal.
    if (isDirectItemLine(line)) {
      const item = line.itemId ? facts.items.get(line.itemId) : undefined;
      if ((item?.itemTrackingType ?? "Inventory") === "Inventory") {
        const cost = facts.directCost(line);
        if (cost !== null) {
          const pair = directCogsLines(facts, line, cost);
          journal.directCogsReferences.set(
            line.id,
            pair[0]!.journalLineReference
          );
          push(pair, {
            ...metadata,
            projectId: null
          });
        }
      }
    }
  }
  return journal;
}

/** A line's dimension values by entity type, in write order
 *  (`journalLineDimensionRows`). The project is on the revenue side only
 *  (`buildSalesPostingLines`); the customer is on every line. */
export function salesLineDimensions(
  meta: SalesPostingMetadata,
  customerId: string | null
): JournalLineDimensionValues {
  return {
    CustomerType: meta.customerTypeId,
    ItemPostingGroup: meta.itemPostingGroupId,
    Location: meta.locationId,
    CostCenter: meta.costCenterId,
    FixedAssetClass: meta.fixedAssetClassId,
    Item: meta.itemId,
    Project: meta.projectId ?? null,
    Customer: customerId
  };
}
export type RentalLineType = "Rent" | "Charge" | "Purchase Option";

export type RentalClassification = "Rental" | "Sale" | "Financing";

/** A revenueRecognitionSchedule row of the agreement line, dates `YYYY-MM-DD`. */
export type RentalScheduleFact = {
  id: string;
  periodStart: string;
  periodEnd: string;
  scheduledDate: string;
  amount: number;
};

export type RentalLinePlanInput = {
  lineType: RentalLineType;
  classification: RentalClassification | null;
  /** The line's revenue in base currency (quantity × unit price), signed. */
  revenueBase: number;
  /** The billing period the line bills; null for a charge. */
  period: { periodStart: string; periodEnd: string } | null;
  /** Accrual rows of the agreement line not yet billed by any line, Planned
   *  or Posted: a run's Accrual rows usually post AFTER the arrears invoice
   *  that bills them, and a Planned row posting later debits the contract
   *  asset this invoice credits, so it nets to zero either way. Each row is a
   *  slice inside exactly one billing period. */
  unbilledAccruals: RentalScheduleFact[];
  /** Planned Deferral rows of the agreement line. */
  plannedDeferrals: RentalScheduleFact[];
  accounts: {
    deferredRevenue: SalesPostingAccount;
    contractAsset: SalesPostingAccount;
    rentalIncome: SalesPostingAccount;
    /** Required for a Sale line's rent and purchase option only. */
    netInvestmentInLeases?: SalesPostingAccount | null;
  };
  /** The rental agreement's row id — the revenue legs reference it. */
  rentalAgreementId: string;
};

/** How the deferred-revenue leg (always the LAST revenue leg) turns into
 *  Deferral rows once its posted base amount is known. */
export type RentalSchedulePlan =
  | { kind: "spread"; startDate: string; endDate: string }
  | { kind: "shrink"; buckets: RentalScheduleFact[] }
  | null;

export type RentalLinePlan = {
  revenueLegs: SalesRevenueLeg[];
  /** Accrual rows this line bills (stamp `billedBySalesInvoiceLineId`). */
  billedAccrualIds: string[];
  schedule: RentalSchedulePlan;
};

const overlaps = (
  row: { periodStart: string; periodEnd: string },
  period: { periodStart: string; periodEnd: string }
) => row.periodStart <= period.periodEnd && row.periodEnd >= period.periodStart;

const within = (
  row: { periodStart: string; periodEnd: string },
  period: { periodStart: string; periodEnd: string }
) => row.periodStart >= period.periodStart && row.periodEnd <= period.periodEnd;

export function planRentalLine(input: RentalLinePlanInput): RentalLinePlan {
  const { lineType, classification, revenueBase, period, accounts } = input;
  // A line activated before classification existed carries no value and is
  // operating by definition. Financing has no input in v1.
  if (
    classification !== null &&
    classification !== "Rental" &&
    classification !== "Sale"
  ) {
    throw new Error(`${classification} rental lines cannot be invoiced yet`);
  }
  const document = {
    documentType: "Rental Agreement" as const,
    documentId: input.rentalAgreementId
  };
  const deferredLeg: SalesRevenueLeg = {
    account: accounts.deferredRevenue,
    accountClass: "Liability",
    description: "Deferred Revenue",
    ...document
  };

  if (lineType === "Charge") {
    // Variable lease payments are recognized when billed — never deferred,
    // and never part of a sales-type lease's net investment.
    return {
      revenueLegs: [
        {
          account: accounts.rentalIncome,
          accountClass: "Revenue",
          description: "Rental Income",
          ...document
        }
      ],
      billedAccrualIds: [],
      schedule: null
    };
  }

  if (classification === "Sale") {
    // The lease revenue was recognized at commencement and the receivable
    // booked as the net investment; a rent payment or the exercised purchase
    // option collects part of it. Interest is posted by the recognition run
    // from the lease schedule, so nothing is deferred or accrued here.
    if (revenueBase < 0) {
      throw new Error(
        "Early-return credits do not apply to a rental treated as a sale"
      );
    }
    if (!accounts.netInvestmentInLeases) {
      throw new Error(
        "Rentals treated as a sale need the Net Investment in Leases account mapped in the accounting defaults"
      );
    }
    return {
      revenueLegs: [
        {
          account: accounts.netInvestmentInLeases,
          accountClass: "Asset",
          description: "Net Investment in Leases",
          ...document
        }
      ],
      billedAccrualIds: [],
      schedule: null
    };
  }

  if (lineType === "Purchase Option") {
    throw new Error(
      "Purchase option billing requires a line treated as a sale"
    );
  }

  if (!period) throw new Error("A rent line needs its billing period");
  if (period.periodEnd < period.periodStart) {
    throw new Error("A rent line's billing period ends before it starts");
  }

  if (revenueBase >= 0) {
    // Rent already earned and accrued (Dr contract asset / Cr rental income,
    // posted now or by a later run) is billed by moving it off the contract
    // asset; the rest is unearned and deferred from the day after the last
    // accrued day.
    const billed = input.unbilledAccruals
      .filter((row) => overlaps(row, period))
      .sort((a, b) =>
        a.periodStart < b.periodStart
          ? -1
          : a.periodStart > b.periodStart
            ? 1
            : 0
      );
    const accrued = round(billed.reduce((sum, row) => sum + row.amount, 0));
    const fromContractAsset = round(
      Math.min(Math.max(accrued, 0), revenueBase)
    );
    const coveredThrough = billed.reduce<string | null>(
      (latest, row) =>
        latest === null || row.periodEnd > latest ? row.periodEnd : latest,
      null
    );
    const startDate =
      coveredThrough !== null && coveredThrough >= period.periodStart
        ? coveredThrough < period.periodEnd
          ? addDays(coveredThrough, 1)
          : period.periodEnd
        : period.periodStart;
    return {
      revenueLegs: [
        {
          account: accounts.contractAsset,
          accountClass: "Asset",
          description: "Contract Assets",
          amount: fromContractAsset,
          ...document
        },
        deferredLeg
      ],
      billedAccrualIds: billed.map((row) => row.id),
      schedule: { kind: "spread", startDate, endDate: period.periodEnd }
    };
  }

  // An early-return credit on rent billed in advance: the unearned part still
  // sits in deferred revenue as this period's Planned rows, so the credit
  // comes off deferred revenue and those rows shrink (by negative Deferral
  // rows of this line, so a VOID simply deletes them). Whatever the period
  // already recognized comes off rental income instead.
  const buckets = plannedBuckets(input.plannedDeferrals, period);
  const capacity = round(
    buckets.reduce((sum, bucket) => sum + Math.max(bucket.amount, 0), 0)
  );
  const fromDeferred = round(Math.min(-revenueBase, capacity));
  return {
    revenueLegs: [
      {
        account: accounts.rentalIncome,
        accountClass: "Revenue",
        description: "Rental Income",
        amount: round(revenueBase + fromDeferred),
        ...document
      },
      deferredLeg
    ],
    billedAccrualIds: [],
    schedule: { kind: "shrink", buckets }
  };
}

/** The period's Planned Deferral rows summed per recognition slice, latest
 *  slice first — the unused days of an early return are the last ones. */
function plannedBuckets(
  rows: RentalScheduleFact[],
  period: { periodStart: string; periodEnd: string }
): RentalScheduleFact[] {
  const bySlice = new Map<string, RentalScheduleFact>();
  for (const row of rows) {
    if (!within(row, period)) continue;
    const key = `${row.periodStart}|${row.periodEnd}|${row.scheduledDate}`;
    const bucket = bySlice.get(key);
    if (bucket) bucket.amount = round(bucket.amount + row.amount);
    else bySlice.set(key, { ...row, id: key, amount: row.amount });
  }
  return [...bySlice.values()].sort((a, b) =>
    a.periodEnd > b.periodEnd ? -1 : a.periodEnd < b.periodEnd ? 1 : 0
  );
}

/** The Deferral rows for the deferred-revenue leg's posted base amount. A
 *  spread straight-lines it; a shrink takes it (negative) out of the period's
 *  Planned slices, latest first, never below zero. */
export function rentalScheduleRows(
  schedule: RentalSchedulePlan,
  deferredAmount: number
): ScheduleRow[] {
  if (schedule === null || deferredAmount === 0) return [];
  if (schedule.kind === "spread") {
    if (deferredAmount < 0) {
      throw new Error("A rent line cannot defer a negative amount");
    }
    return spreadStraightLine({
      amount: deferredAmount,
      startDate: schedule.startDate,
      endDate: schedule.endDate
    });
  }
  if (deferredAmount > 0) {
    throw new Error("An early-return credit cannot add deferred revenue");
  }
  let remaining = -deferredAmount;
  const rows: ScheduleRow[] = [];
  for (const bucket of schedule.buckets) {
    if (remaining <= EPSILON) break;
    const take = round(Math.min(remaining, Math.max(bucket.amount, 0)));
    if (take <= 0) continue;
    rows.push({
      periodStart: bucket.periodStart,
      periodEnd: bucket.periodEnd,
      scheduledDate: bucket.scheduledDate,
      amount: -take
    });
    remaining = round(remaining - take);
  }
  if (remaining > EPSILON) {
    throw new Error("The credit exceeds the period's unrecognized rent");
  }
  return rows;
}

/** One leg of the purchase option settlement: a positive base amount on the
 *  given side of `account`. */
export type LeaseSettlementLeg = {
  account: SalesPostingAccount;
  accountClass: "Asset" | "Revenue" | "Expense";
  side: "debit" | "credit";
  amount: number;
  description: string;
  documentType: "Rental Agreement";
  documentId: string;
};

export type PurchaseOptionSettlementInput = {
  /** The line's lease schedule closing balance — the `closingNetInvestment`
   *  of its last `rentalLeaseScheduleLine`: the purchase option when it was
   *  reasonably certain, plus the guaranteed and unguaranteed residuals. */
  closingTarget: number;
  /** The option billed, in base currency — the Net Investment credit the
   *  purchase option line posts. */
  optionAmount: number;
  accounts: {
    netInvestmentInLeases: SalesPostingAccount;
    costOfGoodsSold?: SalesPostingAccount | null;
    leaseRevenue?: SalesPostingAccount | null;
  };
  rentalAgreementId: string;
};

const requireAccount = (
  account: SalesPostingAccount | null | undefined,
  accountClass: "Revenue" | "Expense",
  label: string
): SalesPostingAccount => {
  if (
    !account ||
    account.class !== accountClass ||
    !account.active ||
    account.isGroup
  ) {
    throw new Error(
      `Exercising a purchase option needs the ${label} account mapped in the accounting defaults as an active ${accountClass} leaf`
    );
  }
  return account;
};

/** An exercised purchase option derecognizes the whole net investment of the
 *  line, not only the option billed. Whatever the schedule's closing balance
 *  holds beyond the option is a unit let go below its carrying residual
 *  (Dr Cost of Goods Sold / Cr Net Investment); an option above it is a gain
 *  (Dr Net Investment / Cr Lease Revenue). Balanced by construction. */
export function purchaseOptionSettlement(
  input: PurchaseOptionSettlementInput
): LeaseSettlementLeg[] {
  const { closingTarget, optionAmount, accounts } = input;
  if (!Number.isFinite(closingTarget) || !Number.isFinite(optionAmount)) {
    throw new Error("A purchase option settlement needs finite amounts");
  }
  const remainder = round(closingTarget - optionAmount);
  if (Math.abs(remainder) <= EPSILON) return [];
  const document = {
    documentType: "Rental Agreement" as const,
    documentId: input.rentalAgreementId
  };
  const netInvestment = {
    account: accounts.netInvestmentInLeases,
    accountClass: "Asset" as const,
    description: "Net Investment in Leases",
    ...document
  };
  if (remainder > 0) {
    const amount = remainder;
    return [
      {
        account: requireAccount(
          accounts.costOfGoodsSold,
          "Expense",
          "Cost of Goods Sold"
        ),
        accountClass: "Expense",
        side: "debit",
        amount,
        description: "Cost of Goods Sold - Lease Residual",
        ...document
      },
      { ...netInvestment, side: "credit", amount }
    ];
  }
  const amount = -remainder;
  return [
    { ...netInvestment, side: "debit", amount },
    {
      account: requireAccount(
        accounts.leaseRevenue,
        "Revenue",
        "Lease Revenue"
      ),
      accountClass: "Revenue",
      side: "credit",
      amount,
      description: "Lease Revenue",
      ...document
    }
  ];
}

/** Settlement legs as journal lines, natural-balance signed, sharing the
 *  purchase option line's journal line reference so a VOID finds and
 *  reverses them with the line's other rental legs. */
export function leaseSettlementJournalLines(
  legs: LeaseSettlementLeg[],
  context: {
    companyId: string;
    quantity: number;
    journalLineReference: string;
    externalDocumentId?: string | null;
    documentLineReference?: string | null;
  }
): SalesPostingJournalLine[] {
  return legs.map((leg) => {
    const naturalClass = leg.accountClass.toLowerCase() as
      | "asset"
      | "revenue"
      | "expense";
    return {
      accountId: leg.account.id,
      description: leg.description,
      amount:
        leg.side === "debit"
          ? debit(naturalClass, leg.amount)
          : credit(naturalClass, leg.amount),
      quantity: round(context.quantity),
      documentType: leg.documentType,
      documentId: leg.documentId,
      externalDocumentId: context.externalDocumentId,
      documentLineReference: context.documentLineReference,
      journalLineReference: context.journalLineReference,
      companyId: context.companyId
    };
  });
}
const postSalesInvoiceLogger = getLogger(
  "server-functions",
  "post-sales-invoice"
);

export const postSalesInvoiceInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  invoiceId: z.string()
});

const RECOGNIZED_REVENUE_VOID_ERROR =
  "Invoice has recognized revenue; reverse the revenue recognition or lease run that posted it first";

export const postSalesInvoicePermission = {
  update: "invoicing"
} satisfies PermissionRule<z.output<typeof postSalesInvoiceInput>>;

/** Posts or voids a sales invoice: its ledger, cost and journal rows, atomically. */
export async function postSalesInvoice(
  ctx: ServiceContext,
  raw: z.input<typeof postSalesInvoiceInput>
) {
  const { type, invoiceId } = postSalesInvoiceInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  postSalesInvoiceLogger.info({ type, invoiceId, userId, companyId });
  if (type === "post")
    await assertPostable(db, "salesInvoice", invoiceId, companyId);
  try {
    const today = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();

    const companyRecord = await single(
      db,
      "company",
      { id: companyId },
      { columns: ["companyGroupId", "baseCurrencyCode"] }
    );
    if (companyRecord.error) throw new Error("Failed to fetch company");
    const companyGroupId = companyRecord.data.companyGroupId;

    // Every invoice posts a journal: Provisional before the company's
    // accounting cutover, Posted after it. Read here to decide whether to
    // resolve a period, and again inside each transaction, where FOR SHARE
    // holds the status until commit.
    const postingStatus = await journalPostingStatus(db, companyId);

    const [salesInvoice, salesInvoiceLines, salesInvoiceShipment] =
      await inOrder([
        // The client is service-role: authorization proved the caller may
        // act in companyId, not that invoiceId belongs to it.
        () => maybeSingle(db, "salesInvoice", { id: invoiceId, companyId }),
        () => many(db, "salesInvoiceLine", { invoiceId, companyId }),
        () =>
          single(
            db,
            "salesInvoiceShipment",
            { companyId, id: invoiceId },
            { columns: ["shippingCost", "shippingMethodId"] }
          )
      ]);

    if (salesInvoice.error) throw new Error("Failed to fetch salesInvoice");
    if (!salesInvoice.data) throw new NotFoundError("Sales invoice not found");
    const invoiceHeader = salesInvoice.data;
    if (salesInvoiceLines.error)
      throw new Error("Failed to fetch shipment lines");
    if (salesInvoiceShipment.error)
      throw new Error("Failed to fetch sales invoice shipment");

    const shippingCost = salesInvoiceShipment.data?.shippingCost ?? 0;

    // Fetch sales order lines (needed by both post and void cases)
    const salesOrderLineIds = salesInvoiceLines.data.reduce<string[]>(
      (acc, invoiceLine) => {
        if (
          invoiceLine.salesOrderLineId &&
          !acc.includes(invoiceLine.salesOrderLineId)
        ) {
          acc.push(invoiceLine.salesOrderLineId);
        }
        return acc;
      },
      []
    );

    const { data: salesOrderLines } = await many(db, "salesOrderLine", {
      id: salesOrderLineIds
    });

    if (!salesOrderLines) {
      throw new Error("Failed to fetch sales order lines");
    }

    switch (type) {
      case "post": {
        const headerShippingAllocations = allocateSalesHeaderShipping(
          salesInvoiceLines.data,
          shippingCost
        );

        const itemIds = salesInvoiceLines.data.reduce<string[]>(
          (acc, invoiceLine) => {
            if (invoiceLine.itemId && !acc.includes(invoiceLine.itemId)) {
              acc.push(invoiceLine.itemId);
            }
            return acc;
          },
          []
        );

        const [items, itemCosts, customer] = await inOrder([
          () =>
            many(
              db,
              "item",
              { id: itemIds, companyId },
              { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
            ),
          () =>
            many(
              db,
              "itemCost",
              { itemId: itemIds },
              { columns: ["itemId", "itemPostingGroupId", "costingMethod"] }
            ),
          () =>
            single(db, "customer", {
              id: invoiceHeader.customerId ?? "",
              companyId
            })
        ]);
        if (items.error) throw new Error("Failed to fetch items");
        if (itemCosts.error) throw new Error("Failed to fetch item costs");
        if (customer.error) throw new Error("Failed to fetch customer");

        // Detect intercompany transaction
        const isIntercompany = customer.data.intercompanyCompanyId != null;
        const intercompanyPartnerId = isIntercompany
          ? customer.data.intercompanyCompanyId
          : null;

        const salesOrders = await many(db, "salesOrder", {
          salesOrderId: salesOrderLines.reduce<string[]>(
            (acc, salesOrderLine) => {
              if (
                salesOrderLine.salesOrderId &&
                !acc.includes(salesOrderLine.salesOrderId)
              ) {
                acc.push(salesOrderLine.salesOrderId);
              }
              return acc;
            },
            []
          ),
          companyId
        });

        if (salesOrders.error) throw new Error("Failed to fetch sales orders");

        const shipmentLineInserts: Omit<
          Database["public"]["Tables"]["shipmentLine"]["Insert"],
          "shipmentId"
        >[] = [];

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];

        const salesInvoiceLinesBySalesOrderLine = salesInvoiceLines.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["salesInvoiceLine"]["Row"]
          >
        >((acc, invoiceLine) => {
          if (invoiceLine.salesOrderLineId) {
            acc[invoiceLine.salesOrderLineId] = invoiceLine;
          }
          return acc;
        }, {});

        const salesOrderLineUpdates = salesOrderLines.reduce<
          Record<
            string,
            Database["public"]["Tables"]["salesOrderLine"]["Update"]
          >
        >((acc, salesOrderLine) => {
          const invoiceLine =
            salesInvoiceLinesBySalesOrderLine[salesOrderLine.id];
          if (
            invoiceLine &&
            invoiceLine.quantity &&
            salesOrderLine.saleQuantity &&
            salesOrderLine.saleQuantity > 0
          ) {
            const newQuantityInvoiced =
              (salesOrderLine.quantityInvoiced ?? 0) + invoiceLine.quantity;

            const invoicedComplete =
              newQuantityInvoiced >=
              (salesOrderLine.quantityToInvoice ?? salesOrderLine.saleQuantity);

            return {
              ...acc,
              [salesOrderLine.id]: {
                quantityInvoiced: newQuantityInvoiced,
                invoicedComplete,
                salesOrderId: salesOrderLine.salesOrderId
              }
            };
          }

          return acc;
        }, {});

        // Get account defaults (once for all lines)
        const accountDefaults = await getDefaultPostingGroup(db, companyId);
        if (accountDefaults.error || !accountDefaults.data) {
          throw new Error("Error getting account defaults");
        }
        const defaults = accountDefaults.data;

        const dimensions = await many(
          db,
          "dimension",
          {
            companyGroupId: companyGroupId!,
            active: true,
            entityType: [
              "CustomerType",
              "ItemPostingGroup",
              "Location",
              "CostCenter",
              "FixedAssetClass",
              "Customer",
              "Item",
              "Project"
            ]
          },
          { columns: ["id", "entityType"] }
        );

        const dimensionMap = new Map<string, string>();
        if (dimensions?.data) {
          for (const dim of dimensions.data) {
            if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
          }
        }

        const invoiceCurrencyCode =
          invoiceHeader.currencyCode ?? companyRecord.data.baseCurrencyCode;
        const invoiceExchangeRate =
          invoiceHeader.exchangeRate ??
          (invoiceCurrencyCode === companyRecord.data.baseCurrencyCode
            ? 1
            : Number.NaN);
        if (!companyGroupId)
          throw new Error("Accounting requires a company group");
        assertExchangeRate(invoiceExchangeRate);
        if (
          invoiceCurrencyCode === companyRecord.data.baseCurrencyCode &&
          invoiceExchangeRate !== 1
        ) {
          throw new Error(
            "Base-currency invoices require an identity exchange rate"
          );
        }

        // Batch the asset/class and disposal facts once. No asset state changes
        // occur until the journal transaction commits.
        type InvoiceLineRecord =
          Database["public"]["Tables"]["salesInvoiceLine"]["Row"];
        const assetIds = [
          ...new Set(
            salesInvoiceLines.data
              .filter(
                (line: InvoiceLineRecord) =>
                  line.invoiceLineType === "Fixed Asset" && line.assetId
              )
              .map((line: InvoiceLineRecord) => line.assetId!)
          )
        ];
        type DisposalRecord = Pick<
          Database["public"]["Tables"]["fixedAssetDisposal"]["Row"],
          "id" | "fixedAssetId" | "netBookValueAtDisposal"
        >;
        const [assetRecords, disposalRecords, currencyConfig] = await inOrder([
          () =>
            assetIds.length > 0
              ? many<"fixedAsset", DisposableAsset>(
                  db,
                  "fixedAsset",
                  { id: assetIds, companyId },
                  {
                    columns: [
                      "id",
                      "status",
                      "acquisitionCost",
                      "accumulatedDepreciation",
                      "locationId",
                      "fixedAssetClassId"
                    ],
                    embed: {
                      fixedAssetClass: {
                        table: "fixedAssetClass",
                        via: "fixedAssetClassId",
                        columns: [
                          "id",
                          "assetAccountId",
                          "accumulatedDepreciationAccountId",
                          "writeOffAccountId",
                          "gainOnDisposalAccountId",
                          "lossOnDisposalAccountId"
                        ]
                      }
                    },
                    orderBy: ["id"]
                  }
                )
              : Promise.resolve({
                  data: [] as DisposableAsset[],
                  error: null
                }),
          () =>
            assetIds.length > 0
              ? many<"fixedAssetDisposal", DisposalRecord>(
                  db,
                  "fixedAssetDisposal",
                  { fixedAssetId: assetIds, companyId },
                  {
                    columns: ["id", "fixedAssetId", "netBookValueAtDisposal"],
                    orderBy: [{ desc: "createdAt" }, { desc: "id" }]
                  }
                )
              : Promise.resolve({
                  data: [] as DisposalRecord[],
                  error: null
                }),
          () =>
            single(
              db,
              "currency",
              {
                companyGroupId: companyGroupId!,
                code: invoiceCurrencyCode
              },
              { columns: ["decimalPlaces"] }
            )
        ]);
        if (assetRecords.error)
          throw new Error("Failed to fetch fixed assets for invoice posting");
        if (disposalRecords.error)
          throw new Error("Failed to fetch fixed-asset disposal records");
        if (currencyConfig.error || !currencyConfig.data) {
          throw new Error("Missing invoice currency precision configuration");
        }
        const invoiceCurrencyDecimals = currencyConfig.data.decimalPlaces;
        assertCurrencyDecimals(invoiceCurrencyDecimals);
        const assetsById = new Map<string, DisposableAsset>(
          (assetRecords.data ?? []).map((asset: DisposableAsset) => [
            asset.id,
            asset
          ])
        );
        const latestDisposalByAsset = new Map<string, DisposalRecord>();
        for (const disposal of disposalRecords.data ?? []) {
          if (!latestDisposalByAsset.has(disposal.fixedAssetId))
            latestDisposalByAsset.set(disposal.fixedAssetId, disposal);
        }

        // The accounts this invoice posts to (posting-lines.ts): stand-ins
        // for an empty optional default before the cutover, and a refusal
        // for a deferral, rental or contract default a line needs.
        const accountPlan = planSalesInvoiceAccounts(
          defaults,
          postingStatus,
          postingAccountNeeds(
            salesInvoiceLines.data,
            (assetRecords.data ?? []).map(
              (asset: DisposableAsset) => asset.fixedAssetClass
            )
          )
        );
        const postingAccounts = await many(
          db,
          "account",
          {
            id: accountPlan.accountIds,
            companyGroupId: companyGroupId!
          },
          {
            columns: ["id", "class", "active", "isGroup", "companyGroupId"]
          }
        );
        if (postingAccounts.error)
          throw new Error("Failed to validate invoice posting accounts");
        const accounts = resolveSalesInvoiceAccounts(
          accountPlan,
          postingAccounts.data ?? [],
          companyGroupId!
        );
        const receivablesAccountId =
          accounts.receivablesAccountId(isIntercompany);

        // Each involved contract line's position, read once; the journal
        // builder keeps it running. Re-read under the position lock inside
        // the posting transaction, which refuses if it moved meanwhile.
        const contractLineIds = salesInvoiceLines.data
          .filter(
            (line: InvoiceLineRecord) =>
              !!line.customerContractLineId &&
              line.invoiceLineType !== "Comment"
          )
          .map((line: InvoiceLineRecord) => line.customerContractLineId!);
        const contractPositionsRead =
          contractLineIds.length > 0
            ? await loadContractPositions(db, companyId, contractLineIds)
            : new Map<string, ContractPosition>();

        // Rental facts, read once for every Rental line: the agreement lines,
        // the billing periods the lines bill, and each agreement line's
        // unbilled Accrual rows (Planned or Posted) and Planned Deferral rows.
        type RentalBillingPeriodRecord = Pick<
          rows.Tables["rentalBillingPeriod"]["Row"],
          "id" | "periodStart" | "periodEnd"
        >;
        type RentalScheduleRecord = Pick<
          rows.Tables["revenueRecognitionSchedule"]["Row"],
          | "id"
          | "rentalAgreementLineId"
          | "periodStart"
          | "periodEnd"
          | "scheduledDate"
          | "amount"
        >;
        type RentalLeaseScheduleRecord = Pick<
          rows.Tables["rentalLeaseScheduleLine"]["Row"],
          "id" | "rentalAgreementLineId" | "periodDate" | "closingNetInvestment"
        >;
        const rentalInvoiceLines = salesInvoiceLines.data.filter(
          (line: InvoiceLineRecord) => line.invoiceLineType === "Rental"
        );
        const rentalAgreementLineIds = [
          ...new Set(
            rentalInvoiceLines
              .map((line: InvoiceLineRecord) => line.rentalAgreementLineId)
              .filter((id: string | null): id is string => !!id)
          )
        ];
        // Agreement lines whose purchase option this invoice exercises: their
        // lease schedule's closing balance is what the option settles.
        const purchaseOptionAgreementLineIds = [
          ...new Set(
            rentalInvoiceLines
              .filter(
                (line: InvoiceLineRecord) =>
                  line.rentalLineType === "Purchase Option"
              )
              .map((line: InvoiceLineRecord) => line.rentalAgreementLineId)
              .filter((id: string | null): id is string => !!id)
          )
        ];
        const rentalBillingPeriodIds = [
          ...new Set(
            rentalInvoiceLines
              .map((line: InvoiceLineRecord) => line.rentalBillingPeriodId)
              .filter((id: string | null): id is string => !!id)
          )
        ];
        const scheduleColumns = [
          "id",
          "rentalAgreementLineId",
          "periodStart",
          "periodEnd",
          "scheduledDate",
          "amount"
        ] as const;
        const noRows = <T>() =>
          Promise.resolve({ data: [] as T[], error: null as Error | null });
        const [
          rentalAgreementLines,
          rentalBillingPeriods,
          rentalAccruals,
          rentalDeferrals,
          rentalLeaseSchedules
        ] = await inOrder([
          () =>
            rentalAgreementLineIds.length > 0
              ? many(
                  db,
                  "rentalAgreementLine",
                  { id: rentalAgreementLineIds, companyId },
                  {
                    columns: [
                      "id",
                      "rentalAgreementId",
                      "itemId",
                      "lessorClassification"
                    ],
                    orderBy: ["id"]
                  }
                )
              : noRows<RentalAgreementLineFacts>(),
          () =>
            rentalBillingPeriodIds.length > 0
              ? many(
                  db,
                  "rentalBillingPeriod",
                  { id: rentalBillingPeriodIds, companyId },
                  {
                    columns: ["id", "periodStart", "periodEnd"],
                    orderBy: ["id"]
                  }
                )
              : noRows<RentalBillingPeriodRecord>(),
          () =>
            rentalAgreementLineIds.length > 0
              ? many(
                  db,
                  "revenueRecognitionSchedule",
                  {
                    companyId,
                    rentalAgreementLineId: rentalAgreementLineIds,
                    type: "Accrual",
                    billedBySalesInvoiceLineId: isNull
                  },
                  { columns: scheduleColumns, orderBy: ["id"] }
                )
              : noRows<RentalScheduleRecord>(),
          () =>
            rentalAgreementLineIds.length > 0
              ? many(
                  db,
                  "revenueRecognitionSchedule",
                  {
                    companyId,
                    rentalAgreementLineId: rentalAgreementLineIds,
                    type: "Deferral",
                    status: "Planned"
                  },
                  { columns: scheduleColumns, orderBy: ["id"] }
                )
              : noRows<RentalScheduleRecord>(),
          () =>
            purchaseOptionAgreementLineIds.length > 0
              ? many(
                  db,
                  "rentalLeaseScheduleLine",
                  {
                    companyId,
                    rentalAgreementLineId: purchaseOptionAgreementLineIds
                  },
                  {
                    columns: [
                      "id",
                      "rentalAgreementLineId",
                      "periodDate",
                      "closingNetInvestment"
                    ],
                    orderBy: ["id"]
                  }
                )
              : noRows<RentalLeaseScheduleRecord>()
        ]);
        if (rentalAgreementLines.error)
          throw new Error("Failed to fetch rental agreement lines");
        if (rentalBillingPeriods.error)
          throw new Error("Failed to fetch rental billing periods");
        if (rentalAccruals.error || rentalDeferrals.error)
          throw new Error("Failed to fetch rental revenue schedules");
        if (rentalLeaseSchedules.error)
          throw new Error("Failed to fetch rental lease schedules");
        // Each agreement line's lease schedule closing balance: the
        // closingNetInvestment of its last line by period date.
        const leaseClosingTargetByLine = new Map<
          string,
          { periodDate: string; closingNetInvestment: number }
        >();
        for (const row of rentalLeaseSchedules.data ?? []) {
          const latest = leaseClosingTargetByLine.get(
            row.rentalAgreementLineId
          );
          if (!latest || row.periodDate > latest.periodDate) {
            leaseClosingTargetByLine.set(row.rentalAgreementLineId, {
              periodDate: row.periodDate,
              closingNetInvestment: Number(row.closingNetInvestment)
            });
          }
        }
        const scheduleFactsByAgreementLine = (
          rows: RentalScheduleRecord[] | null
        ) => {
          const byLine = new Map<string, RentalScheduleFact[]>();
          for (const row of rows ?? []) {
            if (!row.rentalAgreementLineId) continue;
            const facts = byLine.get(row.rentalAgreementLineId) ?? [];
            facts.push({
              id: row.id,
              periodStart: row.periodStart,
              periodEnd: row.periodEnd,
              scheduledDate: row.scheduledDate,
              amount: Number(row.amount)
            });
            byLine.set(row.rentalAgreementLineId, facts);
          }
          return byLine;
        };

        const journal = buildSalesInvoiceJournal({
          companyId,
          companyGroupId: companyGroupId!,
          invoice: invoiceHeader,
          customerTypeId: customer.data.customerTypeId ?? null,
          intercompanyPartnerId,
          lines: salesInvoiceLines.data,
          headerShipping: headerShippingAllocations,
          items: new Map(items.data.map((item) => [item.id, item])),
          postingGroups: new Map(
            itemCosts.data.map((cost) => [cost.itemId, cost.itemPostingGroupId])
          ),
          salesOrderLines: new Map(
            salesOrderLines.map((line) => [line.id, line])
          ),
          assets: assetsById,
          rentalAgreementLines: new Map(
            (rentalAgreementLines.data ?? []).map(
              (line: RentalAgreementLineFacts) => [line.id, line]
            )
          ),
          accounts,
          revenue: postingLineRevenue,
          // Built at zero; the posting transaction relieves the cost and
          // fills the pair in (fillDirectCogs).
          directCost: () => 0,
          contract: {
            positions: contractPositionsRead,
            rate: invoiceExchangeRate
          },
          rental: {
            netInvestmentInLeases: netInvestmentInLeasesAccount(
              accounts,
              rentalAgreementLines.data ?? []
            ),
            billingPeriods: new Map(
              (rentalBillingPeriods.data ?? []).map(
                (period: RentalBillingPeriodRecord) => [period.id, period]
              )
            ),
            accruals: scheduleFactsByAgreementLine(rentalAccruals.data),
            deferrals: scheduleFactsByAgreementLine(rentalDeferrals.data),
            leaseClosing: leaseClosingTargetByLine
          },
          disposal: {
            assets: assetsById,
            latestDisposal: latestDisposalByAsset
          }
        });
        const journalLineInserts = journal.lines;

        // A direct item line ships on the invoice: a shipment (never for a
        // service) and, for a stocked item, the item ledger.
        for (const invoiceLine of salesInvoiceLines.data) {
          if (!isDirectItemLine(invoiceLine)) continue;
          if (invoiceLine.invoiceLineType !== "Service") {
            shipmentLineInserts.push({
              itemId: invoiceLine.itemId!,
              lineId: invoiceLine.id,
              orderQuantity: invoiceLine.quantity,
              outstandingQuantity: invoiceLine.quantity,
              shippedQuantity: invoiceLine.quantity,
              locationId: invoiceLine.locationId,
              storageUnitId: invoiceLine.storageUnitId,
              unitOfMeasure: invoiceLine.unitOfMeasureCode ?? "EA",
              // Net of the line discount: what the line sold for.
              unitPrice: invoiceLine.netUnitPrice ?? 0,
              createdBy: invoiceLine.createdBy,
              companyId
            });
          }
          const itemTrackingType =
            items.data.find((item) => item.id === invoiceLine.itemId)
              ?.itemTrackingType ?? "Inventory";
          if (itemTrackingType === "Inventory") {
            itemLedgerInserts.push({
              postingDate: today,
              itemId: invoiceLine.itemId!,
              quantity: round(-invoiceLine.quantity),
              locationId: invoiceLine.locationId,
              storageUnitId: invoiceLine.storageUnitId,
              entryType: "Negative Adjmt.",
              documentType: "Sales Shipment",
              documentId: invoiceHeader.id ?? undefined,
              externalDocumentId: invoiceHeader.customerReference ?? undefined,
              createdBy: userId,
              companyId
            });
          }
        }

        // An exercised purchase option sells the unit to the lessee. It is a
        // custody fact, so it applies whether or not accounting is on.
        const soldAgreementLineIds = [
          ...new Set<string>(
            salesInvoiceLines.data
              .filter(
                (line: InvoiceLineRecord) =>
                  line.invoiceLineType === "Rental" &&
                  line.rentalLineType === "Purchase Option"
              )
              .map((line: InvoiceLineRecord) => line.rentalAgreementLineId)
              .filter((id: string | null): id is string => !!id)
          )
        ];

        // A Provisional journal has no accounting period.
        const accountingPeriodId =
          postingStatus === "Posted"
            ? await getCurrentAccountingPeriod(companyId, db, today)
            : null;

        await db.transaction().execute(async (trx) => {
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          // The movements above were computed from positions read before
          // this transaction; refuse if another writer moved one since.
          if (contractPositionsRead.size > 0) {
            await lockContractPositions(trx, companyId);
            const current = await loadContractPositions(trx, companyId, [
              ...contractPositionsRead.keys()
            ]);
            for (const [lineId, read] of contractPositionsRead) {
              if (!samePosition(read, current.get(lineId) ?? EMPTY_POSITION)) {
                throw new Error(
                  "A contract line's revenue position changed while this invoice was posting; post it again"
                );
              }
            }
          }

          if (shipmentLineInserts.length > 0) {
            const shipmentLinesGroupedByLocationId = shipmentLineInserts.reduce<
              Record<string, typeof shipmentLineInserts>
            >((acc, line) => {
              if (line.locationId) {
                if (line.locationId in acc) {
                  acc[line.locationId]!.push(line);
                } else {
                  acc[line.locationId] = [line];
                }
              }

              return acc;
            }, {});

            for await (const [locationId, shipmentLines] of Object.entries(
              shipmentLinesGroupedByLocationId
            )) {
              const readableShipmentId = await getNextSequence(
                trx,
                "shipment",
                companyId
              );
              const shipment = await trx
                .insertInto("shipment")
                .values({
                  shipmentId: readableShipmentId ?? "x",
                  locationId,
                  sourceDocument: "Sales Invoice",
                  sourceDocumentId: invoiceHeader.id,
                  sourceDocumentReadableId: invoiceHeader.invoiceId,
                  shippingMethodId: salesInvoiceShipment.data?.shippingMethodId,
                  customerId: invoiceHeader.customerId,
                  externalDocumentId: invoiceHeader.customerReference,
                  status: "Posted",
                  postingDate: today,
                  postedBy: userId,
                  invoiced: true,
                  opportunityId: invoiceHeader.opportunityId,
                  companyId,
                  createdBy: invoiceHeader.createdBy
                })
                .returning(["id"])
                .execute();

              const shipmentId = shipment[0]!.id;
              if (!shipmentId) throw new Error("Failed to insert shipment");

              await trx
                .insertInto("shipmentLine")
                .values(
                  shipmentLines.map((r) => ({
                    ...r,
                    shipmentId: shipmentId
                  }))
                )
                .returning(["id"])
                .execute();
            }
          }

          for await (const [salesOrderLineId, update] of Object.entries(
            salesOrderLineUpdates
          )) {
            await trx
              .updateTable("salesOrderLine")
              .set(update)
              .where("id", "=", salesOrderLineId)
              .where("companyId", "=", companyId)
              .execute();
          }

          const salesOrdersUpdated = Object.values(
            salesOrderLineUpdates
          ).reduce<string[]>((acc, update) => {
            if (update.salesOrderId && !acc.includes(update.salesOrderId)) {
              acc.push(update.salesOrderId);
            }
            return acc;
          }, []);

          for await (const salesOrderId of salesOrdersUpdated) {
            const salesOrderLines = await trx
              .selectFrom("salesOrderLine")
              .selectAll()
              .where("salesOrderId", "=", salesOrderId)
              .execute();

            const areAllLinesInvoiced = salesOrderLines.every(
              (line) =>
                line.salesOrderLineType === "Comment" || line.invoicedComplete
            );

            const areAllLinesShipped = salesOrderLines.every(
              (line) =>
                line.salesOrderLineType === "Comment" ||
                line.salesOrderLineType === "Service" ||
                line.sentComplete
            );

            let status: Database["public"]["Tables"]["salesOrder"]["Row"]["status"] =
              "To Ship and Invoice";

            if (areAllLinesInvoiced && areAllLinesShipped) {
              status = "Completed";
            } else if (areAllLinesInvoiced) {
              status = "To Ship";
            } else if (areAllLinesShipped) {
              status = "To Invoice";
            }

            if (areAllLinesInvoiced) {
              await trx
                .updateTable("shipment")
                .set({
                  invoiced: true
                })
                .where("sourceDocumentId", "=", salesOrderId)
                .where("companyId", "=", companyId)
                .execute();
            }

            await trx
              .updateTable("salesOrder")
              .set({
                status
              })
              .where("id", "=", salesOrderId)
              .where("companyId", "=", companyId)
              .execute();
          }

          // Calculate COGS for direct invoice items (no sales order)
          const directInvoiceItems = salesInvoiceLines.data.filter(
            (line) =>
              line.salesOrderLineId === null &&
              line.itemId &&
              line.invoiceLineType !== "Rental"
          );

          for (const directLine of directInvoiceItems) {
            if (!directLine.itemId) continue;

            const itemTrackingType =
              items.data.find((item) => item.id === directLine.itemId)
                ?.itemTrackingType ?? "Inventory";

            if (itemTrackingType !== "Inventory") continue;

            const cogsResult = await calculateCOGS(trx, {
              itemId: directLine.itemId,
              quantity: directLine.quantity,
              companyId
            });

            // The pair the journal builder wrote at zero.
            if (
              fillDirectCogs(
                journalLineInserts,
                journal.directCogsReferences.get(directLine.id),
                cogsResult.totalCost
              )
            ) {
              await trx
                .insertInto("costLedger")
                .values({
                  itemLedgerType: "Sale",
                  costLedgerType: "Direct Cost",
                  adjustment: false,
                  documentType: "Sales Shipment",
                  documentId: invoiceHeader.id ?? "",
                  itemId: directLine.itemId,
                  quantity: round(-directLine.quantity),
                  cost: round(-cogsResult.totalCost),
                  remainingQuantity: 0,
                  companyId,
                  postingDate: today
                })
                .execute();
            }
          }

          let journalLineResults: { id: string }[] = [];
          // A zero-value invoice has no lines to post; an empty header would
          // still consume a journal entry number.
          if (journalLineInserts.length > 0) {
            const journalEntryId = await getNextSequence(
              trx,
              "journalEntry",
              companyId
            );

            const journalResult = await trx
              .insertInto("journal")
              .values({
                journalEntryId,
                accountingPeriodId,
                description: `Sales Invoice ${invoiceHeader.invoiceId}`,
                postingDate: today,
                companyId,
                sourceType: "Sales Invoice",
                status: postingStatus,
                postedAt: datetime.timestamp(),
                postedBy: userId,
                createdBy: userId
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            journalLineResults = await trx
              .insertInto("journalLine")
              .values(
                journalLineInserts.map((line) => ({
                  ...accounts.standIns.storedLine(line),
                  journalId: journalResult.id
                }))
              )
              .returning(["id"])
              .execute();

            const journalLineDimensionInserts = journalLineDimensionRows({
              journalLineIds: journalLineResults.map((line) => line.id),
              lines: journal.metadata.map((meta) => ({
                dimensions: salesLineDimensions(meta, invoiceHeader.customerId)
              })),
              dimensionIdByEntity: dimensionMap,
              companyId
            });
            if (journalLineDimensionInserts.length > 0) {
              await trx
                .insertInto("journalLineDimension")
                .values(journalLineDimensionInserts)
                .execute();
            }

            // Straight-line each deferred line into Planned schedule rows; a
            // recognition run later moves each row from Deferred Revenue to
            // Sales. The rows sum to the deferred leg exactly.
            if (journal.deferrals.length > 0) {
              await trx
                .insertInto("revenueRecognitionSchedule")
                .values(
                  journal.deferrals.flatMap((deferral) =>
                    spreadStraightLine({
                      amount: deferral.amountBase,
                      startDate: deferral.startDate,
                      endDate: deferral.endDate
                    }).map((row) => ({
                      type: "Deferral" as const,
                      status: "Planned" as const,
                      salesInvoiceLineId: deferral.salesInvoiceLineId,
                      periodStart: row.periodStart,
                      periodEnd: row.periodEnd,
                      scheduledDate: row.scheduledDate,
                      amount: row.amount,
                      debitAccountId: deferral.debitAccountId,
                      creditAccountId: deferral.creditAccountId,
                      companyId,
                      createdBy: userId
                    }))
                  )
                )
                .execute();
            }

            // One movement per contract invoice line, on this journal.
            if (journal.contractMovements.length > 0) {
              await trx
                .insertInto("customerContractLedgerEntry")
                .values(
                  journal.contractMovements.map(({ movement, ...entry }) => ({
                    ...entry,
                    entryType: "Invoice" as const,
                    postingDate: today,
                    deferredAmount: movement.deferredAmount,
                    deferredBase: movement.deferredBase,
                    assetAmount: movement.assetAmount,
                    assetBase: movement.assetBase,
                    companyId,
                    createdBy: userId,
                    journalId: journalResult.id
                  }))
                )
                .execute();
            }

            // Rental rent: the unearned part as Planned Deferral rows (an
            // early-return credit as negative rows shrinking its period).
            if (journal.rentalSchedules.length > 0) {
              await trx
                .insertInto("revenueRecognitionSchedule")
                .values(
                  journal.rentalSchedules.map((row) => ({
                    type: "Deferral" as const,
                    status: "Planned" as const,
                    ...row,
                    companyId,
                    createdBy: userId
                  }))
                )
                .execute();
            }

            // Accrued rent this invoice bills moved off the contract asset;
            // stamp each Accrual row with the line that billed it. A row still
            // Planned debits the contract asset when its run posts, cancelling
            // this credit, so the balance nets to zero whichever posts first.
            // The guard columns make a concurrent bill fail loudly instead of
            // crediting the contract asset twice.
            if (journal.billedAccruals.size > 0) {
              const billed = [...journal.billedAccruals];
              const stamped = await trx
                .updateTable("revenueRecognitionSchedule")
                .set({
                  billedBySalesInvoiceLineId: sql<string>`CASE "id" ${sql.join(
                    billed.map(
                      ([accrualId, invoiceLineId]) =>
                        sql`WHEN ${accrualId} THEN ${invoiceLineId}`
                    ),
                    sql` `
                  )} END`,
                  updatedBy: userId,
                  updatedAt: datetime.timestamp()
                })
                .where("companyId", "=", companyId)
                .where(
                  "id",
                  "in",
                  billed.map(([accrualId]) => accrualId)
                )
                .where("type", "=", "Accrual")
                .where("billedBySalesInvoiceLineId", "is", null)
                .executeTakeFirst();
              if (Number(stamped.numUpdatedRows) !== billed.length) {
                throw new Error(
                  "A rental accrual changed while this invoice was posting; post it again"
                );
              }
            }
          }

          // The unit is the lessee's now: the line is Sold, which lets the
          // agreement close. Only a sales-type unit still on rent can be sold;
          // a second purchase option on the same line finds it Sold and fails.
          if (soldAgreementLineIds.length > 0) {
            const sold = await trx
              .updateTable("rentalAgreementLine")
              .set({
                status: "Sold",
                updatedBy: userId,
                updatedAt: datetime.timestamp()
              })
              .where("companyId", "=", companyId)
              .where("id", "in", soldAgreementLineIds)
              .where("lessorClassification", "=", "Sale")
              .where("status", "=", "On Rent")
              .executeTakeFirst();
            if (Number(sold.numUpdatedRows) !== soldAgreementLineIds.length) {
              throw new Error(
                "A purchase option can only be billed on a unit treated as a sale that is on rent"
              );
            }
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .returning(["id"])
              .execute();
          }

          if (invoiceHeader.shipmentId) {
            await trx
              .updateTable("shipment")
              .set({
                invoiced: true
              })
              .where("id", "=", invoiceHeader.shipmentId)
              .where("companyId", "=", companyId)
              .execute();
          }

          // Create intercompany transaction record if IC
          if (isIntercompany && intercompanyPartnerId) {
            const cogsAccount = defaults.costOfGoodsSoldAccount;
            const classifiedLines = classifyIntercompanyPostingLines(
              journalLineInserts.map((line, index) => ({
                ...line,
                id: journalLineResults[index]?.id ?? ""
              })),
              journal.metadata,
              {
                controlAccountId: receivablesAccountId,
                revenueAccountIds: [
                  defaults.salesAccount,
                  accounts.shippingAccountId
                ].filter((id): id is string => !!id),
                cogsAccountId: cogsAccount
              }
            );
            // Keep the first control as the existing matching anchor, but capture
            // every emitted control line so multiline balances eliminate fully.
            const icJournalLineId = classifiedLines.find(
              (line) => line.role === "Control"
            )?.journalLineId;
            const intercompanyAmount = calculateSalesIntercompanyAmount(
              salesInvoiceLines.data,
              invoiceExchangeRate
            );

            if (icJournalLineId) {
              const icTxn = await trx
                .insertInto("intercompanyTransaction")
                .values({
                  companyGroupId: companyGroupId!,
                  sourceCompanyId: companyId,
                  targetCompanyId: intercompanyPartnerId,
                  sourceJournalLineId: icJournalLineId,
                  amount: intercompanyAmount,
                  currencyCode: invoiceCurrencyCode,
                  description: `Sales Invoice ${invoiceHeader.invoiceId}`,
                  documentType: "Invoice",
                  documentId: invoiceHeader.id,
                  status: "Unmatched"
                })
                .returning(["id"])
                .executeTakeFirstOrThrow();

              const eliminationLineInserts: Database["public"]["Tables"]["intercompanyEliminationLine"]["Insert"][] =
                classifiedLines.map((line) => ({
                  ...line,
                  accountId: accounts.standIns.storedAccountId(line.accountId),
                  companyId,
                  intercompanyTransactionId: icTxn.id,
                  createdBy: userId
                }));

              // Sales-order-based sales post COGS at SHIPMENT (a prior posting),
              // not on this invoice, so it is not in journalLineInserts. Capture
              // those shipment COGS lines via the deterministic invoice ->
              // salesInvoiceLine.salesOrderId -> shipment(sourceDocument = 'Sales
              // Order') link. Done once, here, and stored — never re-derived per
              // elimination run.
              const salesOrderIds = [
                ...new Set(
                  salesInvoiceLines.data
                    .map((line) => line.salesOrderId)
                    .filter((id): id is string => !!id)
                )
              ];
              if (cogsAccount && salesOrderIds.length > 0) {
                const shipmentCogsLines = await trx
                  .selectFrom("journalLine as jl")
                  .innerJoin("journal as j", (join) =>
                    join
                      .onRef("j.id", "=", "jl.journalId")
                      .onRef("j.companyId", "=", "jl.companyId")
                  )
                  .innerJoin("shipment as s", "s.id", "jl.documentId")
                  .select([
                    "jl.id as id",
                    "jl.accountId as accountId",
                    "jl.amount as amount",
                    "jl.quantity as quantity"
                  ])
                  .where("jl.companyId", "=", companyId)
                  .where("jl.accountId", "=", cogsAccount)
                  .where("s.companyId", "=", companyId)
                  .where("s.sourceDocument", "=", "Sales Order")
                  .where("s.sourceDocumentId", "in", salesOrderIds)
                  .where("j.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
                  .execute();
                for (const cogs of shipmentCogsLines) {
                  eliminationLineInserts.push({
                    companyId,
                    intercompanyTransactionId: icTxn.id,
                    role: "COGS",
                    journalLineId: cogs.id,
                    accountId: cogs.accountId!,
                    amount: cogs.amount ?? 0,
                    itemId: null,
                    quantity: cogs.quantity ?? null,
                    createdBy: userId
                  });
                }
              }

              if (eliminationLineInserts.length > 0) {
                await trx
                  .insertInto("intercompanyEliminationLine")
                  .values(eliminationLineInserts)
                  .execute();
              }
            }
          }

          // All disposal state changes share the journal transaction. Batch
          // monetary enrichment separately from direct-disposal lifecycle changes.
          const assetProceeds = new Map([
            ...journal.directDisposals.map(
              (entry) => [entry.assetId, entry.saleProceeds] as const
            ),
            ...journal.shippedDisposals.map(
              (entry) => [entry.assetId, entry.saleProceeds] as const
            )
          ]);
          if (assetProceeds.size > 0) {
            await trx
              .updateTable("fixedAsset")
              .set({
                saleProceeds: sql<number>`CASE "id" ${sql.join(
                  [...assetProceeds].map(
                    ([id, proceeds]) =>
                      sql`WHEN ${id} THEN ${proceeds}::numeric`
                  ),
                  sql` `
                )} ELSE "saleProceeds" END`,
                updatedBy: userId
              })
              .where("id", "in", [...assetProceeds.keys()])
              .where("companyId", "=", companyId)
              .execute();
          }
          if (journal.shippedDisposals.length > 0) {
            const updates = [
              ...new Map(
                journal.shippedDisposals.map((entry) => [
                  entry.disposalId,
                  entry
                ])
              ).values()
            ];
            await trx
              .updateTable("fixedAssetDisposal")
              .set({
                saleProceeds: sql<number>`CASE "id" ${sql.join(
                  updates.map(
                    (entry) =>
                      sql`WHEN ${entry.disposalId} THEN ${entry.saleProceeds}::numeric`
                  ),
                  sql` `
                )} ELSE "saleProceeds" END`,
                gainLoss: sql<number>`CASE "id" ${sql.join(
                  updates.map(
                    (entry) =>
                      sql`WHEN ${entry.disposalId} THEN ${entry.gainLoss}::numeric`
                  ),
                  sql` `
                )} ELSE "gainLoss" END`
              })
              .where(
                "id",
                "in",
                updates.map((entry) => entry.disposalId)
              )
              .where("companyId", "=", companyId)
              .execute();
          }
          if (journal.directDisposals.length > 0) {
            await trx
              .updateTable("fixedAsset")
              .set({
                status: "Disposed",
                disposalDate: today,
                disposalMethod: "Sale",
                updatedBy: userId
              })
              .where(
                "id",
                "in",
                journal.directDisposals.map((entry) => entry.assetId)
              )
              .where("companyId", "=", companyId)
              .execute();
            await trx
              .insertInto("fixedAssetDisposal")
              .values(
                journal.directDisposals.map((entry) => ({
                  fixedAssetId: entry.assetId,
                  disposalMethod: "Sale" as const,
                  disposalDate: today,
                  saleProceeds: entry.saleProceeds,
                  netBookValueAtDisposal: entry.netBookValue,
                  gainLoss: entry.gainLoss,
                  companyId,
                  createdBy: userId
                }))
              )
              .execute();
          }

          // Posting stamps dateIssued with today, so recompute dateDue from
          // the payment term to keep it consistent with the new issue date.
          // With no payment term the invoice still gets one, via Net 30.
          const paymentTerm = invoiceHeader.paymentTermId
            ? await trx
                .selectFrom("paymentTerm")
                .select(["daysDue", "calculationMethod"])
                .where("id", "=", invoiceHeader.paymentTermId)
                .where("companyId", "=", companyId)
                .executeTakeFirst()
            : undefined;
          const dateDue = calculateDueDate(today, paymentTerm);

          await trx
            .updateTable("salesInvoice")
            .set({
              dateIssued: today,
              ...(dateDue ? { dateDue } : {}),
              postingDate: today,
              status: "Submitted"
            })
            .where("id", "=", invoiceId)
            .where("companyId", "=", companyId)
            .execute();
        });
        break;
      }

      case "void": {
        // The enable superseded this invoice's journal and opened its
        // receivable in the opening journal.
        await refuseVoidBeforeCutover(
          db,
          companyId,
          invoiceHeader.postingDate,
          SALES_INVOICE_VOID_BEFORE_CUTOVER_ERROR
        );
        // Get journal entries to reverse
        const journalEntries = await documentJournalLines(db, companyId, {
          documentId: invoiceId,
          documentType: "Invoice"
        });

        // A Rental line's revenue legs reference the rental agreement, not the
        // invoice, so the query above misses them; a contract line's
        // revenue legs (and FX reclass) reference the contract. They share
        // the posting journal and the journal line reference of their
        // invoice line's AR leg, which is how they are found.
        const rentalLineIds = salesInvoiceLines.data
          .filter((line) => line.invoiceLineType === "Rental")
          .map((line) => line.id);
        const contractInvoiceLines = salesInvoiceLines.data.filter(
          (line) => !!line.customerContractLineId
        );
        type JournalLineRecord = rows.Tables["journalLine"]["Row"];
        let rentalJournalEntries: JournalLineRecord[] = [];
        if (
          (rentalLineIds.length > 0 || contractInvoiceLines.length > 0) &&
          journalEntries.length > 0
        ) {
          const journalIds = [
            ...new Set(
              journalEntries.map((entry: JournalLineRecord) => entry.journalId)
            )
          ];
          const references = [
            ...new Set(
              journalEntries
                .map((entry: JournalLineRecord) => entry.journalLineReference)
                .filter(
                  (reference: string | null): reference is string => !!reference
                )
            )
          ];
          rentalJournalEntries = await documentJournalLines(db, companyId, {
            documentType: ["Rental Agreement", "Contract"],
            journalId: journalIds,
            journalLineReference: references
          });
        }

        // Get shipments created from this invoice
        const { data: invoiceShipments } = await many(
          db,
          "shipment",
          { sourceDocument: "Sales Invoice", sourceDocumentId: invoiceId },
          { columns: ["id"] }
        );

        const salesOrderLinesBySalesOrderLineId = salesOrderLines.reduce<
          Record<string, Database["public"]["Tables"]["salesOrderLine"]["Row"]>
        >((acc, salesOrderLine) => {
          acc[salesOrderLine.id] = salesOrderLine;
          return acc;
        }, {});

        // Reverse sales order line updates
        const salesOrderLineUpdates = salesInvoiceLines.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["salesOrderLine"]["Update"]
          >
        >((acc, invoiceLine) => {
          const salesOrderLine =
            salesOrderLinesBySalesOrderLineId[
              invoiceLine.salesOrderLineId ?? ""
            ];
          if (
            invoiceLine.salesOrderLineId &&
            salesOrderLine &&
            invoiceLine.quantity &&
            salesOrderLine.saleQuantity &&
            salesOrderLine.saleQuantity > 0
          ) {
            const newQuantityInvoiced = Math.max(
              0,
              (salesOrderLine.quantityInvoiced ?? 0) - invoiceLine.quantity
            );

            const invoicedComplete =
              newQuantityInvoiced >= salesOrderLine.saleQuantity;

            const updates: Database["public"]["Tables"]["salesOrderLine"]["Update"] =
              {
                quantityInvoiced: newQuantityInvoiced,
                invoicedComplete,
                salesOrderId: salesOrderLine.salesOrderId
              };

            return {
              ...acc,
              [invoiceLine.salesOrderLineId]: updates
            };
          }

          return acc;
        }, {});

        // Deferred revenue already recognized cannot be voided by flipping the
        // invoice journal alone — the recognition journal must be reversed
        // first. Planned rows are dropped inside the void transaction below.
        // A contract line has no Deferral rows (it posts to its position),
        // so this never refuses one: its VOID reclasses instead.
        const invoiceLineIds = salesInvoiceLines.data.map((line) => line.id);
        if (invoiceLineIds.length > 0) {
          const recognized = await db
            .selectFrom("revenueRecognitionSchedule")
            .select(["status"])
            .where("companyId", "=", companyId)
            .where("salesInvoiceLineId", "in", invoiceLineIds)
            .where("status", "=", "Posted")
            .executeTakeFirst();
          if (recognized) {
            throw new InvalidInputError(RECOGNIZED_REVENUE_VOID_ERROR);
          }
        }

        // Create reversing journal entries
        const reversingJournalEntries: Omit<
          rows.Tables["journalLine"]["Insert"],
          "journalId"
        >[] = [...journalEntries, ...rentalJournalEntries].map((entry) => ({
          accountId: entry.accountId,
          // A reversed stand-in line names the same default, so the enable
          // re-points both sides together.
          accountDefaultRole: entry.accountDefaultRole,
          description: `VOID: ${entry.description}`,
          // A reversal is a sign flip of an already-posted value, which is
          // exact — no rounding to do.
          amount: -entry.amount,
          quantity: -entry.quantity,
          ...(entry.documentType === "Rental Agreement" ||
          entry.documentType === "Contract"
            ? {
                documentType: entry.documentType,
                documentId: entry.documentId
              }
            : {
                documentType: "Invoice" as const,
                documentId: invoiceHeader.id
              }),
          externalDocumentId: entry.externalDocumentId,
          documentLineReference: entry.documentLineReference,
          journalLineReference: entry.journalLineReference,
          companyId
        }));

        // Create reversing item ledger entries
        const reversingItemLedgerEntries: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];

        const { data: originalItemLedgerEntries } = await many(
          db,
          "itemLedger",
          { documentId: invoiceId, documentType: "Sales Shipment" }
        );

        if (originalItemLedgerEntries) {
          originalItemLedgerEntries.forEach((entry) => {
            reversingItemLedgerEntries.push({
              postingDate: today,
              itemId: entry.itemId,
              quantity: -entry.quantity,
              locationId: entry.locationId,
              storageUnitId: entry.storageUnitId,
              entryType:
                entry.entryType === "Negative Adjmt."
                  ? "Positive Adjmt."
                  : "Negative Adjmt.",
              documentType: "Sales Shipment",
              documentId: invoiceHeader.id ?? undefined,
              externalDocumentId: entry.externalDocumentId,
              createdBy: userId,
              companyId
            });
          });
        }

        // A Provisional journal has no accounting period.
        const accountingPeriodId =
          postingStatus === "Posted"
            ? await getCurrentAccountingPeriod(companyId, db, today)
            : null;

        await db.transaction().execute(async (trx) => {
          await assertPostingStatusUnchanged(trx, companyId, postingStatus);
          if (invoiceLineIds.length > 0) {
            // Re-checked under lock: a run may have posted since the check
            // above, and its rows must never be dropped. Every row left is
            // Planned; a Draft recognition run may hold some, and its lines
            // go with them (a Draft is a proposal, not a commitment).
            const rows = await trx
              .selectFrom("revenueRecognitionSchedule")
              .select(["id", "status", "runLineId"])
              .where("companyId", "=", companyId)
              .where("salesInvoiceLineId", "in", invoiceLineIds)
              .forUpdate()
              .execute();
            if (rows.some((row) => row.status === "Posted")) {
              throw new InvalidInputError(RECOGNIZED_REVENUE_VOID_ERROR);
            }
            await syncDraftRecognitionRuns(trx, {
              companyId,
              userId,
              deletedScheduleIds: rows
                .filter((row) => row.runLineId !== null)
                .map((row) => row.id)
            });
            await trx
              .deleteFrom("revenueRecognitionSchedule")
              .where("companyId", "=", companyId)
              .where("salesInvoiceLineId", "in", invoiceLineIds)
              .execute();
          }

          // Undo what posting a Rental line consumed: its accruals are unbilled
          // again (the reversed journal restores the contract asset), and the
          // billing periods and charges it billed are billable again — and
          // remember the voided invoice, so the automated re-bill is held for
          // review (spec 2026-10-02-rental-invoice-automation).
          if (rentalLineIds.length > 0) {
            const updatedAt = datetime.timestamp();
            await trx
              .updateTable("revenueRecognitionSchedule")
              .set({
                billedBySalesInvoiceLineId: null,
                updatedBy: userId,
                updatedAt
              })
              .where("companyId", "=", companyId)
              .where("billedBySalesInvoiceLineId", "in", rentalLineIds)
              .execute();
            await trx
              .updateTable("rentalBillingPeriod")
              .set({
                status: "Pending",
                salesInvoiceLineId: null,
                voidedSalesInvoiceId: invoiceId,
                updatedBy: userId,
                updatedAt
              })
              .where("companyId", "=", companyId)
              .where("salesInvoiceLineId", "in", rentalLineIds)
              .execute();
            await trx
              .updateTable("rentalAgreementCharge")
              .set({
                salesInvoiceLineId: null,
                voidedSalesInvoiceId: invoiceId,
                updatedBy: userId,
                updatedAt
              })
              .where("companyId", "=", companyId)
              .where("salesInvoiceLineId", "in", rentalLineIds)
              .execute();
            // A voided purchase option un-sells the unit: back on rent, but
            // only if nothing has moved the line on since it was sold.
            const soldAgreementLineIds = [
              ...new Set<string>(
                salesInvoiceLines.data
                  .filter(
                    (line) =>
                      line.invoiceLineType === "Rental" &&
                      line.rentalLineType === "Purchase Option"
                  )
                  .map((line) => line.rentalAgreementLineId)
                  .filter((id: string | null): id is string => !!id)
              )
            ];
            if (soldAgreementLineIds.length > 0) {
              await trx
                .updateTable("rentalAgreementLine")
                .set({ status: "On Rent", updatedBy: userId, updatedAt })
                .where("companyId", "=", companyId)
                .where("id", "in", soldAgreementLineIds)
                .where("status", "=", "Sold")
                .execute();
            }
          }

          // Undo what drafting a contract invoice stamped: its schedule rows
          // are billable again (remembering the voided invoice, so the
          // automated re-bill is held for review) and the planned invoice is
          // Planned again.
          if (invoiceLineIds.length > 0) {
            const updatedAt = datetime.timestamp();
            await trx
              .updateTable("customerContractInvoiceLine")
              .set({
                salesInvoiceLineId: null,
                voidedSalesInvoiceId: invoiceId,
                updatedBy: userId,
                updatedAt
              })
              .where("companyId", "=", companyId)
              .where("salesInvoiceLineId", "in", invoiceLineIds)
              .execute();
          }
          await trx
            .updateTable("customerContractInvoice")
            .set({
              status: "Planned",
              salesInvoiceId: null,
              updatedBy: userId,
              updatedAt: datetime.timestamp()
            })
            .where("companyId", "=", companyId)
            .where("salesInvoiceId", "=", invoiceId)
            .execute();

          // Update sales order lines to reverse invoiced quantities
          for await (const [salesOrderLineId, update] of Object.entries(
            salesOrderLineUpdates
          )) {
            await trx
              .updateTable("salesOrderLine")
              .set(update)
              .where("id", "=", salesOrderLineId)
              .where("companyId", "=", companyId)
              .execute();
          }

          // Update sales orders status - fetch fresh data after updates
          const salesOrdersUpdated = Object.values(
            salesOrderLineUpdates
          ).reduce<string[]>((acc, update) => {
            if (update.salesOrderId && !acc.includes(update.salesOrderId)) {
              acc.push(update.salesOrderId);
            }
            return acc;
          }, []);

          for await (const salesOrderId of salesOrdersUpdated) {
            // Fetch fresh data after the sales order line updates
            const salesOrderLines = await trx
              .selectFrom("salesOrderLine")
              .selectAll()
              .where("salesOrderId", "=", salesOrderId)
              .execute();

            const areAllLinesInvoiced = salesOrderLines.every(
              (line) =>
                line.salesOrderLineType === "Comment" || line.invoicedComplete
            );

            const areAllLinesShipped = salesOrderLines.every(
              (line) =>
                line.salesOrderLineType === "Comment" ||
                line.salesOrderLineType === "Service" ||
                line.sentComplete
            );

            let status: Database["public"]["Tables"]["salesOrder"]["Row"]["status"] =
              "To Ship and Invoice";

            if (areAllLinesInvoiced && areAllLinesShipped) {
              status = "Completed";
            } else if (areAllLinesInvoiced) {
              status = "To Ship";
            } else if (areAllLinesShipped) {
              status = "To Invoice";
            }

            // If no lines are invoiced anymore, remove invoiced flag from shipments
            if (!areAllLinesInvoiced) {
              await trx
                .updateTable("shipment")
                .set({
                  invoiced: false
                })
                .where("sourceDocumentId", "=", salesOrderId)
                .where("companyId", "=", companyId)
                .execute();
            }

            await trx
              .updateTable("salesOrder")
              .set({
                status
              })
              .where("id", "=", salesOrderId)
              .where("companyId", "=", companyId)
              .execute();
          }

          // A contract line's VOID is the negation of its Invoice entry —
          // the journal above reverses its legs exactly — then any pool the
          // negation drove below zero (the run already recognized part of
          // what this invoice deferred) is reclassed to the other pool, on
          // this VOID journal, so Deferred Revenue and Contract Assets stay
          // max(N, 0) / max(−N, 0) (plan D6).
          const contractVoidEntries: Omit<
            rows.Tables["customerContractLedgerEntry"]["Insert"],
            "journalId"
          >[] = [];
          if (contractInvoiceLines.length > 0) {
            await lockContractPositions(trx, companyId);
            const invoiceEntries = await trx
              .selectFrom("customerContractLedgerEntry")
              .select([
                "customerContractId",
                "customerContractLineId",
                "salesInvoiceLineId",
                "deferredAmount",
                "deferredBase",
                "assetAmount",
                "assetBase"
              ])
              .where("companyId", "=", companyId)
              .where("entryType", "=", "Invoice")
              .where(
                "salesInvoiceLineId",
                "in",
                contractInvoiceLines.map((line) => line.id)
              )
              .orderBy("createdAt")
              .orderBy("id")
              .execute();
            if (invoiceEntries.length > 0) {
              const positions = await loadContractPositions(
                trx,
                companyId,
                invoiceEntries.map((entry) => entry.customerContractLineId)
              );
              const defaults = await trx
                .selectFrom("accountDefault")
                .select(["deferredRevenueAccount", "contractAssetAccount"])
                .where("companyId", "=", companyId)
                .executeTakeFirst();
              for (const entry of invoiceEntries) {
                const negation = negatePosition({
                  deferredAmount: Number(entry.deferredAmount),
                  deferredBase: Number(entry.deferredBase),
                  assetAmount: Number(entry.assetAmount),
                  assetBase: Number(entry.assetBase)
                });
                const before = addMovement(
                  positions.get(entry.customerContractLineId) ?? EMPTY_POSITION,
                  negation
                );
                const reclass = normalizePosition(before);
                const movement = addMovement(negation, reclass);
                positions.set(
                  entry.customerContractLineId,
                  addMovement(before, reclass)
                );
                contractVoidEntries.push({
                  customerContractId: entry.customerContractId,
                  customerContractLineId: entry.customerContractLineId,
                  entryType: "Void",
                  postingDate: today,
                  salesInvoiceLineId: entry.salesInvoiceLineId,
                  ...movement,
                  companyId,
                  createdBy: userId
                });
                // Equal base on both pools: one Contract Assets / Deferred
                // Revenue pair.
                if (reclass.deferredBase !== 0) {
                  // The contract defaults never take a stand-in: the void
                  // refuses when either is empty, as the posting does.
                  const deferredRevenueAccount =
                    defaults?.deferredRevenueAccount;
                  const contractAssetAccount = defaults?.contractAssetAccount;
                  if (!deferredRevenueAccount || !contractAssetAccount) {
                    throw new InvalidInputError(
                      "Voiding a contract invoice needs the Deferred Revenue and Contract Assets accounts mapped in the accounting defaults"
                    );
                  }
                  const invoiceLine = contractInvoiceLines.find(
                    (line) => line.id === entry.salesInvoiceLineId
                  );
                  const reference = nanoid();
                  for (const [target, accountClass, description, value] of [
                    [
                      deferredRevenueAccount,
                      "Liability",
                      "VOID: Deferred Revenue reclass",
                      reclass.deferredBase
                    ],
                    [
                      contractAssetAccount,
                      "Asset",
                      "VOID: Contract Assets reclass",
                      -reclass.assetBase
                    ]
                  ] as const) {
                    reversingJournalEntries.push({
                      accountId: target,
                      description,
                      amount: signedCreditAmount(accountClass, value),
                      quantity: invoiceLine?.quantity ?? 0,
                      documentType: "Contract",
                      documentId: entry.customerContractId,
                      externalDocumentId: invoiceHeader.customerReference,
                      documentLineReference: null,
                      journalLineReference: reference,
                      companyId
                    });
                  }
                }
              }
            }
          }

          // Nothing to reverse for a zero-value invoice — no empty VOID header.
          if (reversingJournalEntries.length > 0) {
            const voidJournalEntryId = await getNextSequence(
              trx,
              "journalEntry",
              companyId
            );

            const voidJournalResult = await trx
              .insertInto("journal")
              .values({
                journalEntryId: voidJournalEntryId,
                accountingPeriodId,
                description: `VOID Sales Invoice ${invoiceHeader.invoiceId}`,
                postingDate: today,
                companyId,
                sourceType: "Sales Invoice",
                status: postingStatus,
                postedAt: datetime.timestamp(),
                postedBy: userId,
                createdBy: userId
              })
              .returning(["id"])
              .executeTakeFirstOrThrow();

            await trx
              .insertInto("journalLine")
              .values(
                reversingJournalEntries.map((line) => ({
                  ...line,
                  journalId: voidJournalResult.id
                }))
              )
              .returning(["id"])
              .execute();

            if (contractVoidEntries.length > 0) {
              await trx
                .insertInto("customerContractLedgerEntry")
                .values(
                  contractVoidEntries.map((entry) => ({
                    ...entry,
                    journalId: voidJournalResult.id
                  }))
                )
                .execute();
            }
          }

          // Insert reversing item ledger entries
          if (reversingItemLedgerEntries.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(reversingItemLedgerEntries)
              .returning(["id"])
              .execute();
          }

          // Delete invoice-created shipments
          if (invoiceShipments && invoiceShipments.length > 0) {
            for (const shipment of invoiceShipments) {
              await trx
                .updateTable("shipment")
                .set({
                  invoiced: false,
                  status: "Voided",
                  updatedAt: today,
                  updatedBy: userId
                })
                .where("id", "=", shipment.id)
                .where("companyId", "=", companyId)
                .execute();
            }
          }

          // Remove invoiced flag from related shipment if it exists
          if (invoiceHeader.shipmentId) {
            await trx
              .updateTable("shipment")
              .set({
                invoiced: false
              })
              .where("id", "=", invoiceHeader.shipmentId)
              .where("companyId", "=", companyId)
              .execute();
          }

          // Update invoice status to voided
          await trx
            .updateTable("salesInvoice")
            .set({
              status: "Voided",
              updatedAt: today,
              updatedBy: userId
            })
            .where("id", "=", invoiceId)
            .where("companyId", "=", companyId)
            .execute();
        });

        break;
      }
    }

    return { success: true };
  } catch (err) {
    // A failed VOID must not touch status: the invoice is still Posted and its
    // ledger/journal rows still stand, so forcing it to Draft would contradict
    // the books and let it be edited and posted a second time. Same guard
    // post-receipt, post-shipment and post-purchase-invoice carry.
    if (type !== "void") {
      await updateRows(
        db,
        "salesInvoice",
        { status: "Draft" },
        { id: invoiceId, companyId }
      );
    }
    throw err;
  }
}
export type MemoRow = Selectable<KyselyDatabase["memo"]>;

/** A memo journal line with the stand-in role the posting gives it. */
export type MemoJournalLineWithRole = MemoJournalLine & {
  accountDefaultRole: OptionalDefaultRole | null;
};

/** A credit memo that credits a contract or a rental agreement. */
export function isContractOrRentalCredit(memo: MemoRow): boolean {
  return (
    memo.direction === "Credit" &&
    Boolean(memo.customerContractId || memo.rentalAgreementId)
  );
}

/**
 * The reason account of a memo that credits no contract and no rental
 * agreement. A customer-RMA credit memo books to Sales Returns, which falls
 * back to Sales when empty (`resolveDefaultAccount`).
 */
export function plainMemoReasonAccount(
  memo: MemoRow,
  defaults: Selectable<KyselyDatabase["accountDefault"]>,
  isAR: boolean,
  postingStatus: AutomaticJournalStatus
): {
  accountId: string | null;
  accountDefaultRole: OptionalDefaultRole | null;
} {
  if (memo.salesReturnOrderId) {
    return resolveDefaultAccount(
      defaults,
      "salesReturnsAccount",
      postingStatus
    );
  }
  return {
    accountId: memo.purchaseReturnOrderId
      ? defaults.goodsReceivedNotInvoicedAccount
      : isAR
        ? defaults.salesDiscountAccount
        : defaults.supplierPaymentDiscountAccount,
    accountDefaultRole: null
  };
}

/**
 * The lines with their stand-in roles. Only the reason leg can be a
 * stand-in; it is the line on the reason account.
 */
export function withReasonRole(
  lines: MemoJournalLine[],
  reasonAccountId: string,
  reasonAccountDefaultRole: OptionalDefaultRole | null
): MemoJournalLineWithRole[] {
  return lines.map((line) => ({
    ...line,
    accountDefaultRole:
      line.accountId === reasonAccountId ? reasonAccountDefaultRole : null
  }));
}

/**
 * The carried cost a supplier-return memo's reason leg clears, in base
 * currency. Undefined for every other memo, and for a return with no cost
 * basis.
 */
export async function supplierReturnCarriedCost(
  trx: Transaction<KyselyDatabase>,
  memo: MemoRow
): Promise<number | undefined> {
  const costs = await supplierReturnCarriedCosts(trx, [memo], memo.companyId);
  return costs.get(memo.id);
}

/** `supplierReturnCarriedCost` for many memos, in a fixed number of reads. */
export async function supplierReturnCarriedCosts(
  trx: Transaction<KyselyDatabase>,
  memos: MemoRow[],
  companyId: string
): Promise<Map<string, number | undefined>> {
  // Supplier returns only: the reason leg (GRNI) must clear exactly what the
  // return SHIPMENT debited — the goods' carried cost, already in BASE
  // currency (do NOT scale by the memo's exchange rate) — while the control
  // leg (AP) moves by what the supplier agreed to credit. Recover the carried
  // cost here and let the builder book the difference as a purchase price
  // variance; without it GRNI keeps a residual for the life of the company.
  const result = new Map<string, number | undefined>();
  const returns = memos.filter((memo) => memo.purchaseReturnOrderId);
  if (returns.length === 0) return result;
  const returnOrderIds = [
    ...new Set(returns.map((memo) => memo.purchaseReturnOrderId!))
  ];
  // Posted shipments only: a voided shipment's journal was reversed but its
  // costLedger rows survive, so counting it would over-credit GRNI.
  const shipments = await trx
    .selectFrom("shipment")
    .select(["id", "sourceDocumentId"])
    .where("sourceDocument", "=", "Purchase Return Order")
    .where("sourceDocumentId", "in", returnOrderIds)
    .where("status", "=", "Posted")
    .where("companyId", "=", companyId)
    .execute();
  const shipmentIds = shipments.map((row) => row.id);
  if (shipmentIds.length === 0) return result;

  const [costRows, creditLines] = await Promise.all([
    trx
      .selectFrom("costLedger")
      .select(["documentId", "itemId", "quantity", "cost"])
      .where("documentType", "=", "Purchase Return Shipment")
      .where("documentId", "in", shipmentIds)
      // What the shipment relieved. A shipment that ships units an inspection
      // reject wrote off first puts them back (a positive row at the
      // write-off's cost), which is not carried cost the return took out.
      .where("quantity", "<", 0)
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("purchaseReturnOrderCreditLine")
      .select(["memoId", "purchaseReturnOrderLineId", "quantity"])
      .where(
        "memoId",
        "in",
        returns.map((memo) => memo.id)
      )
      .where("companyId", "=", companyId)
      .execute()
  ]);
  const lineIds = [
    ...new Set(
      creditLines.map((row) => row.purchaseReturnOrderLineId as string)
    )
  ];
  const returnLines = lineIds.length
    ? await trx
        .selectFrom("purchaseReturnOrderLine")
        .select(["id", "itemId"])
        .where("id", "in", lineIds)
        .where("companyId", "=", companyId)
        .execute()
    : [];
  const itemByLine = new Map(
    returnLines.map((row) => [row.id as string, row.itemId as string])
  );
  const returnOrderByShipment = new Map(
    shipments.map((row) => [row.id, row.sourceDocumentId])
  );

  // Per return order, per-item carried cost per unit, from what its
  // shipments relieved.
  const relievedByReturn = new Map<
    string,
    Map<string, { qty: number; cost: number }>
  >();
  for (const row of costRows) {
    const returnOrderId = returnOrderByShipment.get(row.documentId as string);
    if (!returnOrderId) continue;
    const relieved =
      relievedByReturn.get(returnOrderId) ??
      new Map<string, { qty: number; cost: number }>();
    relievedByReturn.set(returnOrderId, relieved);
    const key = row.itemId as string;
    const prev = relieved.get(key) ?? { qty: 0, cost: 0 };
    relieved.set(key, {
      qty: prev.qty + Math.abs(Number(row.quantity ?? 0)),
      cost: prev.cost + Math.abs(Number(row.cost ?? 0))
    });
  }

  for (const memo of returns) {
    const relieved = relievedByReturn.get(memo.purchaseReturnOrderId!);
    // Credited quantity x that item's per-unit carried cost.
    let carried = 0;
    for (const creditLine of creditLines) {
      if (creditLine.memoId !== memo.id) continue;
      const itemId = itemByLine.get(
        creditLine.purchaseReturnOrderLineId as string
      );
      const totals = itemId ? relieved?.get(itemId) : undefined;
      if (!totals || totals.qty === 0) continue;
      carried += (totals.cost / totals.qty) * Number(creditLine.quantity ?? 0);
    }
    // Only override when we actually recovered a cost basis. A zero-cost or
    // accounting-disabled-at-shipment return keeps the two-line shape.
    result.set(memo.id, carried > 0 ? carried : undefined);
  }
  return result;
}
export type PostMemoArgs = {
  type: "post" | "void";
  memoId: string;
  companyId: string;
  userId: string;
  today: string;
};

/** The endpoint's commit boundary. Headers, defaults and account classes come from this transaction. */
export function postMemoTransaction(
  db: Kysely<KyselyDatabase>,
  args: PostMemoArgs
): Promise<{ journalId: string | null }> {
  const { type, memoId, companyId, userId, today } = args;
  return db.transaction().execute(async (trx) => {
    const memo = await trx
      .selectFrom("memo")
      .selectAll()
      .where("id", "=", memoId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!memo) throw new NotFoundError("Memo not found");
    if (type === "post" && memo.status === "Posted") {
      return { journalId: memo.journalId };
    }
    if (type === "void" && memo.status === "Voided") {
      return { journalId: memo.journalId };
    }
    if (memo.status !== (type === "post" ? "Draft" : "Posted")) {
      throw new Error(`Cannot ${type} memo in status ${memo.status}`);
    }
    // Every memo posts a journal: Provisional before the company's accounting
    // cutover, Posted after it. FOR SHARE holds the cutover until commit. A
    // Provisional journal has no accounting period.
    const cutoverDate = await readAccountingCutoverDate(trx, companyId);
    const postingStatus = postingStatusFor(cutoverDate);
    const timestamp = datetime.timestamp();
    let accountingPeriodId: string | null = null;
    if (postingStatus === "Posted") {
      accountingPeriodId = await getCurrentAccountingPeriod(
        companyId,
        trx,
        today
      );
      const period = await trx
        .selectFrom("accountingPeriod")
        .select(["id", "closeStatus", "closedAt"])
        .where("id", "=", accountingPeriodId)
        .where("companyId", "=", companyId)
        .forShare()
        .executeTakeFirst();
      if (
        !period ||
        period.closeStatus === "Locked" ||
        period.closeStatus === "Closed" ||
        period.closedAt
      )
        throw new Error("Accounting period is closed or locked");
    }
    if (type === "void") {
      // Posting a consuming payment takes this same memo lock. A void cannot
      // erase its source while that payment still carries the application.
      const consumption = await trx
        .selectFrom("invoiceSettlement as s")
        .leftJoin("payment as applying", (join) =>
          join
            .onRef("applying.id", "=", "s.appliedViaPaymentId")
            .onRef("applying.companyId", "=", "s.companyId")
        )
        .leftJoin("payment as refund", (join) =>
          join
            .onRef("refund.id", "=", "s.paymentId")
            .onRef("refund.companyId", "=", "s.companyId")
        )
        .select("s.id")
        .where("s.companyId", "=", companyId)
        .where((eb) =>
          eb.or([
            eb.and([
              eb("s.memoId", "=", memoId),
              eb.or([
                eb("s.appliedViaPaymentId", "is", null),
                eb("applying.status", "=", "Posted")
              ])
            ]),
            eb.and([
              eb("s.targetMemoId", "=", memoId),
              eb("refund.status", "=", "Posted")
            ])
          ])
        )
        .limit(1)
        .executeTakeFirst();
      if (consumption) {
        throw new Error(
          "Cannot void a consumed memo; void its applying payment or remove its direct application first"
        );
      }
      let journalId: string | null = null;
      const insertVoidJournal = async () =>
        (
          await trx
            .insertInto("journal")
            .values({
              journalEntryId: await getNextSequence(
                trx,
                "journalEntry",
                companyId
              ),
              accountingPeriodId,
              description: `VOID Memo ${memo.memoId}`,
              postingDate: today,
              companyId,
              sourceType:
                memo.direction === "Credit" ? "Credit Memo" : "Debit Memo",
              status: postingStatus,
              postedAt: timestamp,
              postedBy: userId,
              createdBy: userId
            })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
      // Before the cutover the memo's own journal is Superseded, and the
      // opening journal carries the memo's open amount. The void builds the
      // memo's posting again and negates it, today, so it nets that line.
      if (memo.postingDate && isBeforeCutover(memo.postingDate, cutoverDate)) {
        const rebuilt = await rebuildMemoJournal(trx, memo, postingStatus);
        const reversedId = await insertVoidJournal();
        journalId = reversedId;
        const lines = await trx
          .insertInto("journalLine")
          .values(
            rebuilt.lines.map((line) => ({
              journalId: reversedId,
              accountId: line.accountId,
              amount: -line.amount,
              quantity: line.quantity,
              description: `VOID: ${line.description}`,
              documentType: "Memo" as const,
              documentId: memoId,
              journalLineReference: line.journalLineReference,
              accountDefaultRole: line.accountDefaultRole,
              companyId
            }))
          )
          .returning("id")
          .execute();
        const dimensionValues = rebuilt.dimensions.flatMap((dimension) =>
          lines.map((line) => ({
            journalLineId: line.id,
            ...dimension,
            companyId
          }))
        );
        if (dimensionValues.length) {
          await trx
            .insertInto("journalLineDimension")
            .values(dimensionValues)
            .execute();
        }
      } else if (memo.journalId) {
        const originalJournal = await trx
          .selectFrom("journal")
          .select(["id", "status", "sourceType"])
          .where("id", "=", memo.journalId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (
          !originalJournal ||
          !(OPEN_ITEM_JOURNAL_STATUSES as readonly string[]).includes(
            originalJournal.status
          ) ||
          originalJournal.sourceType !==
            (memo.direction === "Credit" ? "Credit Memo" : "Debit Memo")
        )
          throw new NotFoundError(
            "Original memo journal not found in this company"
          );
        const original = await trx
          .selectFrom("journalLine")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "journalLine.journalId")
              .onRef("journal.companyId", "=", "journalLine.companyId")
          )
          .selectAll("journalLine")
          .where("journalLine.journalId", "=", memo.journalId)
          .where("journalLine.companyId", "=", companyId)
          .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
          .orderBy("journalLine.id")
          .execute();
        if (!original.length) {
          throw new Error("Original memo journal has no lines to reverse");
        }
        const reversedId = await insertVoidJournal();
        journalId = reversedId;
        const lines = await trx
          .insertInto("journalLine")
          .values(
            original.map((line) => ({
              journalId: reversedId,
              accountId: line.accountId,
              amount: -Number(line.amount),
              quantity: line.quantity,
              description: `VOID: ${line.description ?? ""}`,
              documentType: "Memo" as const,
              documentId: memoId,
              documentLineReference: line.documentLineReference,
              journalLineReference: line.journalLineReference,
              accountDefaultRole: line.accountDefaultRole,
              companyId
            }))
          )
          .returning("id")
          .execute();
        const dimensions = await trx
          .selectFrom("journalLineDimension")
          .select(["journalLineId", "dimensionId", "valueId"])
          .where("companyId", "=", companyId)
          .where(
            "journalLineId",
            "in",
            original.map((line) => line.id)
          )
          .execute();
        const reverseByOriginal = new Map(
          original.map((line, index) => [line.id, lines[index]!.id])
        );
        if (dimensions.length) {
          await trx
            .insertInto("journalLineDimension")
            .values(
              dimensions.map((d) => ({
                ...d,
                journalLineId: reverseByOriginal.get(d.journalLineId)!,
                companyId
              }))
            )
            .execute();
        }
      }
      // A rental early-return credit gives its periods back: its Planned
      // Deferral rows go (index.ts refused the void if any had posted or a
      // Draft run held one) and the adjustments return to Pending, so the
      // next invoice run credits them on a new memo.
      if (memo.rentalAgreementId) {
        await trx
          .deleteFrom("revenueRecognitionSchedule")
          .where("companyId", "=", companyId)
          .where("memoId", "=", memoId)
          .where("status", "=", "Planned")
          .where("runLineId", "is", null)
          .execute();
        await trx
          .updateTable("rentalBillingPeriod")
          .set({
            status: "Pending",
            memoId: null,
            updatedBy: userId,
            updatedAt: timestamp
          })
          .where("companyId", "=", companyId)
          .where("memoId", "=", memoId)
          .execute();
      }
      await trx
        .updateTable("memo")
        .set({
          status: "Voided",
          voidedAt: timestamp,
          voidedBy: userId,
          updatedAt: timestamp,
          updatedBy: userId
        })
        .where("id", "=", memoId)
        .where("companyId", "=", companyId)
        .execute();
      return { journalId };
    }

    if (Boolean(memo.customerId) === Boolean(memo.supplierId)) {
      throw new Error("Memo must have exactly one customer or supplier");
    }
    const isAR = Boolean(memo.customerId);
    const partyId = (isAR ? memo.customerId : memo.supplierId)!;
    const company = await trx
      .selectFrom("company")
      .select(["companyGroupId", "baseCurrencyCode"])
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!company?.companyGroupId || !memo.currencyCode) {
      throw new Error("Memo currency configuration is missing");
    }
    const currency = await trx
      .selectFrom("currency")
      .select("decimalPlaces")
      .where("companyGroupId", "=", company.companyGroupId)
      .where("code", "=", memo.currencyCode)
      .executeTakeFirst();
    if (!currency || currency.decimalPlaces == null) {
      throw new Error("Memo currency decimal places are not configured");
    }
    const amount = Number(memo.amount);
    const exchangeRate = Number(memo.exchangeRate);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Memo amount must be positive and finite");
    }
    toBaseAmount(amount, exchangeRate);
    if (toDocumentAmount(amount, 1, currency.decimalPlaces) !== amount) {
      throw new Error("Memo amount exceeds document currency precision");
    }
    if (company.baseCurrencyCode === memo.currencyCode && exchangeRate !== 1) {
      throw new Error("Base-currency memo must use exchange rate 1");
    }
    const party = isAR
      ? await trx
          .selectFrom("customer")
          .select(["customerTypeId as typeId", "intercompanyCompanyId"])
          .where("id", "=", partyId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : await trx
          .selectFrom("supplier")
          .select(["supplierTypeId as typeId", "intercompanyCompanyId"])
          .where("id", "=", partyId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
    if (!party)
      throw new NotFoundError("Memo counterparty not found in this company");
    const defaults = await trx
      .selectFrom("accountDefault")
      .selectAll()
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!defaults) {
      throw new Error("Accounting defaults are required before posting");
    }
    const controlAccountId = isAR
      ? defaults.receivablesAccount
      : defaults.payablesAccount;
    // Return-order memos override the reason (offset) account. A customer-RMA
    // credit memo books to contra-revenue (salesReturnsAccount, fallback
    // salesAccount); a supplier-return DEBIT memo nets GRNI against payables —
    // its shipment already DEBITED GRNI at carried cost, so the memo's reason
    // leg credits GRNI back to zero while the control leg reduces AP. Every
    // other memo keeps the deterministic-by-party offset.
    //
    // A contract cancellation credit lowers each credited line's position
    // (plan D7): it debits Deferred Revenue up to the line's deferred pool
    // and Contract Assets for the rest, so the cancelled months are never
    // recognized afterwards and anything already recognized becomes an
    // asset the next run clears against the cancellation's catch-up rows.
    const contractCredit =
      memo.customerContractId && isAR && memo.direction === "Credit"
        ? await planContractCredit(trx, {
            memoId,
            companyId,
            customerContractId: memo.customerContractId,
            amount,
            exchangeRate
          })
        : null;
    // A rental early-return credit books what the negative Rent invoice line
    // did: the unearned part off Deferred Revenue (shrinking the period's
    // Planned rows), anything already recognized off Rental Income.
    const rentalCredit =
      memo.rentalAgreementId && isAR && memo.direction === "Credit"
        ? await loadRentalCredit(trx, {
            memoId,
            companyId,
            rentalAgreementId: memo.rentalAgreementId,
            amount,
            decimals: currency.decimalPlaces
          })
        : null;
    const rentalAccountIds = {
      deferredRevenue: defaults.deferredRevenueAccount,
      rentalIncome: defaults.rentalIncomeAccount
    };
    const contractAccountIds = contractCredit
      ? {
          deferredRevenue: defaults.deferredRevenueAccount,
          contractAsset: defaults.contractAssetAccount,
          sales: defaults.salesAccount,
          fxGain: defaults.realizedExchangeGainAccount,
          fxLoss: defaults.realizedExchangeLossAccount
        }
      : null;
    const plainReason =
      contractCredit || rentalCredit
        ? null
        : plainMemoReasonAccount(memo, defaults, isAR, postingStatus);
    const reasonAccountDefaultRole = plainReason?.accountDefaultRole ?? null;
    const reasonAccountId = plainReason
      ? plainReason.accountId
      : defaults.deferredRevenueAccount;
    if (!controlAccountId || !reasonAccountId) {
      throw new Error("Memo control and reason account defaults are required");
    }
    // The legs replacing the reason leg of a contract or rental credit,
    // each account required only when its leg posts.
    const contractLegs = contractCredit
      ? contractCreditLegs(contractCredit, contractAccountIds!)
      : rentalCredit
        ? rentalCredit.legs.map((leg) => ({
            ...leg,
            accountId: rentalAccountIds[leg.account]
          }))
        : [];
    for (const leg of contractLegs) {
      if (!leg.accountId) {
        throw new Error(
          `${rentalCredit ? "Rental" : "Contract"} credit memos need the ${leg.description} account mapped in the accounting defaults`
        );
      }
    }
    const accountIds = [
      ...new Set(
        [
          controlAccountId,
          reasonAccountId,
          ...contractLegs.map((leg) => leg.accountId)
        ].filter((id): id is string => !!id)
      )
    ];
    const accounts = await trx
      .selectFrom("account")
      .select(["id", "class"])
      .where("id", "in", accountIds)
      .where("companyGroupId", "=", company.companyGroupId)
      .where("active", "=", true)
      .where("isGroup", "=", false)
      .execute();
    const control = accounts.find((a) => a.id === controlAccountId);
    const reason = accounts.find((a) => a.id === reasonAccountId);
    if (
      accounts.length !== accountIds.length ||
      control?.class !== (isAR ? "Asset" : "Liability") ||
      !reason?.class ||
      contractLegs.some(
        (leg) =>
          accounts.find((a) => a.id === leg.accountId)?.class !==
          leg.accountClass
      )
    ) {
      throw new Error(
        "Memo accounts must be active posting accounts in this company group with the correct control class"
      );
    }
    const reasonAmountBase = await supplierReturnCarriedCost(trx, memo);

    const { lines } = buildMemoJournal({
      memoId,
      companyId,
      isAR,
      direction: memo.direction,
      amount,
      exchangeRate,
      journalLineReference: nanoid(),
      controlAccountId,
      reasonAccountId,
      reasonAccountClass: reason.class,
      reasonAmountBase,
      varianceAccountId: defaults.purchaseVarianceAccount,
      reasonDescription: memo.purchaseReturnOrderId
        ? "Goods Received Not Invoiced"
        : contractCredit || rentalCredit
          ? "Deferred Revenue"
          : undefined
    });
    if (contractCredit || rentalCredit) {
      // The builder books one reason leg (index 1, after the control leg).
      // Replace it with the contract legs; they add up to it exactly (the
      // FX leg is the remainder), so the entry still balances.
      const reasonLine = lines[1]!;
      lines.splice(
        1,
        1,
        ...contractLegs.map((leg) => ({
          ...reasonLine,
          accountId: leg.accountId!,
          description: leg.description,
          amount: signedCreditAmount(leg.accountClass, leg.credit)
        }))
      );
    }
    const journal = await trx
      .insertInto("journal")
      .values({
        journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
        accountingPeriodId,
        description: `${memo.direction} Memo ${memo.memoId}`,
        postingDate: today,
        companyId,
        sourceType: memo.direction === "Credit" ? "Credit Memo" : "Debit Memo",
        status: postingStatus,
        postedAt: timestamp,
        postedBy: userId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const journalId = journal.id;
    const inserted = await trx
      .insertInto("journalLine")
      .values(
        withReasonRole(lines, reasonAccountId, reasonAccountDefaultRole).map(
          (line) => ({ ...line, journalId: journal.id })
        )
      )
      .returning("id")
      .execute();
    if (rentalCredit && rentalCredit.scheduleRows.length > 0) {
      await trx
        .insertInto("revenueRecognitionSchedule")
        .values(
          rentalCredit.scheduleRows.map((row) => ({
            type: "Deferral" as const,
            status: "Planned" as const,
            memoId,
            rentalAgreementLineId: row.rentalAgreementLineId,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            scheduledDate: row.scheduledDate,
            amount: row.amount,
            debitAccountId: rentalAccountIds.deferredRevenue!,
            creditAccountId: rentalAccountIds.rentalIncome!,
            companyId,
            createdBy: userId
          }))
        )
        .execute();
    }
    if (contractCredit && contractCredit.lines.length > 0) {
      await trx
        .insertInto("customerContractLedgerEntry")
        .values(
          contractCredit.lines.map(({ lineId, movement }) => ({
            customerContractId: memo.customerContractId!,
            customerContractLineId: lineId,
            entryType: "Credit Memo" as const,
            postingDate: today,
            memoId,
            journalId: journal.id,
            deferredAmount: movement.deferredAmount,
            deferredBase: movement.deferredBase,
            assetAmount: movement.assetAmount,
            assetBase: movement.assetBase,
            companyId,
            createdBy: userId
          }))
        )
        .execute();
    }
    const dimensions = await partyDimensionValues(trx, {
      companyGroupId: company.companyGroupId,
      isAR,
      partyId,
      typeId: party.typeId
    });
    const dimensionValues = dimensions.flatMap((dimension) =>
      inserted.map((line) => ({
        journalLineId: line.id,
        ...dimension,
        companyId
      }))
    );
    if (dimensionValues.length) {
      await trx
        .insertInto("journalLineDimension")
        .values(dimensionValues)
        .execute();
    }
    await trx
      .updateTable("memo")
      .set({
        status: "Posted",
        postingDate: today,
        journalId,
        // A stand-in is not the memo's reason account; the enable re-points
        // the line, and the memo keeps none, as before the cutover.
        reasonAccount: reasonAccountDefaultRole ? null : reasonAccountId,
        postedAt: timestamp,
        postedBy: userId,
        updatedAt: timestamp,
        updatedBy: userId
      })
      .where("id", "=", memoId)
      .where("companyId", "=", companyId)
      .execute();
    return { journalId };
  });
}

type ContractCredit = {
  /** One movement per credited contract line. */
  lines: { lineId: string; movement: ContractMovement }[];
  /** The memo in base: what the AR leg credits. */
  memoBase: number;
  /** The part of the memo no credited line covers, in base (debits Sales). */
  uncoveredBase: number;
};

/**
 * What a contract cancellation credit does to each line it credits: the
 * memo-borne adjustment rows (`customerContractInvoiceLine.memoId`), summed
 * per line, applied to the line's position as a reducing movement at the
 * memo's rate against the receivable. Takes the position lock; the ledger
 * entries are written with the journal.
 */
async function planContractCredit(
  trx: Transaction<KyselyDatabase>,
  args: {
    memoId: string;
    companyId: string;
    customerContractId: string;
    amount: number;
    exchangeRate: number;
  }
): Promise<ContractCredit> {
  const { memoId, companyId, customerContractId, amount, exchangeRate } = args;
  await lockContractPositions(trx, companyId);
  const credited = await trx
    .selectFrom("customerContractInvoiceLine")
    .select(["customerContractLineId", "amount"])
    .where("companyId", "=", companyId)
    .where("customerContractId", "=", customerContractId)
    .where("memoId", "=", memoId)
    .orderBy("customerContractLineId")
    .orderBy("id")
    .execute();
  const byLine = new Map<string, number>();
  for (const row of credited) {
    byLine.set(
      row.customerContractLineId,
      (byLine.get(row.customerContractLineId) ?? 0) + Number(row.amount)
    );
  }
  const positions = await loadContractPositions(trx, companyId, [
    ...byLine.keys()
  ]);
  const lines: ContractCredit["lines"] = [];
  let covered = 0;
  for (const [lineId, sum] of byLine) {
    const lineAmount = round(sum);
    if (lineAmount === 0) continue;
    covered = round(covered - lineAmount);
    lines.push({
      lineId,
      movement: applyContractMovement({
        position: positions.get(lineId) ?? EMPTY_POSITION,
        amount: lineAmount,
        rate: exchangeRate,
        counterpart: "receivable"
      })
    });
  }
  const uncovered = round(amount - covered);
  if (uncovered < -EPSILON) {
    throw new Error(
      "The contract lines this memo credits add up to more than the memo amount"
    );
  }
  return {
    lines,
    memoBase: toBaseAmount(amount, exchangeRate),
    uncoveredBase:
      uncovered > EPSILON ? toBaseAmount(uncovered, exchangeRate) : 0
  };
}

/** The journal legs replacing a contract credit memo's reason leg, as signed
 *  credits (negative = debit): Deferred Revenue and Contract Assets by the
 *  pools' base deltas, Sales for any part no line covers, and the realized
 *  FX that makes them sum to the AR credit. Zero legs are dropped. */
function contractCreditLegs(
  credit: ContractCredit,
  accounts: {
    deferredRevenue: string | null;
    contractAsset: string | null;
    sales: string | null;
    fxGain: string | null;
    fxLoss: string | null;
  }
): {
  accountId: string | null;
  accountClass: "Liability" | "Asset" | "Revenue" | "Expense";
  description: string;
  credit: number;
}[] {
  const deferred = round(
    credit.lines.reduce((sum, { movement }) => sum + movement.deferredBase, 0)
  );
  const asset = round(
    -credit.lines.reduce((sum, { movement }) => sum + movement.assetBase, 0)
  );
  const sales = -credit.uncoveredBase;
  // The revenue side must debit exactly what AR credits.
  const fx = round(-credit.memoBase - deferred - asset - sales);
  return [
    {
      accountId: accounts.deferredRevenue,
      accountClass: "Liability" as const,
      description: "Deferred Revenue",
      credit: deferred
    },
    {
      accountId: accounts.contractAsset,
      accountClass: "Asset" as const,
      description: "Contract Assets",
      credit: asset
    },
    {
      accountId: accounts.sales,
      accountClass: "Revenue" as const,
      description: "Sales",
      credit: sales
    },
    fx > 0
      ? {
          accountId: accounts.fxGain,
          accountClass: "Revenue" as const,
          description: "Realized FX gain",
          credit: fx
        }
      : {
          accountId: accounts.fxLoss,
          accountClass: "Expense" as const,
          description: "Realized FX loss",
          credit: fx
        }
  ].filter((leg) => leg.credit !== 0);
}

/**
 * Loads what a rental early-return credit memo credits — its adjustment
 * periods (`rentalBillingPeriod.memoId`) and the Planned Deferral rows of
 * their agreement lines — and plans the posting (`planRentalCredit`). The
 * periods are locked: a concurrent void or delete of the same memo waits.
 */
async function loadRentalCredit(
  trx: Transaction<KyselyDatabase>,
  args: {
    memoId: string;
    companyId: string;
    rentalAgreementId: string;
    amount: number;
    decimals: number;
  }
): Promise<RentalCreditPlan> {
  const { memoId, companyId, rentalAgreementId } = args;
  const periods = await trx
    .selectFrom("rentalBillingPeriod as p")
    .innerJoin("rentalAgreementLine as l", (join) =>
      join
        .onRef("l.id", "=", "p.rentalAgreementLineId")
        .onRef("l.companyId", "=", "p.companyId")
    )
    .select([
      "p.id",
      "p.rentalAgreementLineId",
      sql<string>`p."periodStart"::text`.as("periodStart"),
      sql<string>`p."periodEnd"::text`.as("periodEnd"),
      "p.amount",
      "l.lessorClassification",
      "l.rentalAgreementId"
    ])
    .where("p.companyId", "=", companyId)
    .where("p.memoId", "=", memoId)
    .orderBy("p.periodStart")
    .orderBy("p.id")
    .forUpdate("p")
    .execute();
  if (
    periods.some((period) => period.rentalAgreementId !== rentalAgreementId)
  ) {
    throw new Error(
      "This credit memo credits periods of another rental agreement"
    );
  }
  const lineIds = [...new Set(periods.map((p) => p.rentalAgreementLineId))];
  const deferralRows =
    lineIds.length === 0
      ? []
      : await trx
          .selectFrom("revenueRecognitionSchedule")
          .select([
            "id",
            "rentalAgreementLineId",
            sql<string>`"periodStart"::text`.as("periodStart"),
            sql<string>`"periodEnd"::text`.as("periodEnd"),
            sql<string>`"scheduledDate"::text`.as("scheduledDate"),
            "amount"
          ])
          .where("companyId", "=", companyId)
          .where("rentalAgreementLineId", "in", lineIds)
          .where("type", "=", "Deferral")
          .where("status", "=", "Planned")
          .orderBy("id")
          .execute();
  const plannedDeferrals = new Map<string, RentalScheduleFact[]>();
  for (const row of deferralRows) {
    if (!row.rentalAgreementLineId) continue;
    const facts = plannedDeferrals.get(row.rentalAgreementLineId) ?? [];
    facts.push({
      id: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      scheduledDate: row.scheduledDate,
      amount: Number(row.amount)
    });
    plannedDeferrals.set(row.rentalAgreementLineId, facts);
  }
  return planRentalCredit({
    memoAmount: args.amount,
    decimals: args.decimals,
    periods: periods.map((period) => ({
      id: period.id,
      rentalAgreementLineId: period.rentalAgreementLineId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      amount: Number(period.amount),
      classification: period.lessorClassification
    })),
    plannedDeferrals,
    rentalAgreementId
  });
}
export const MEMO_CREDIT_VOID_BEFORE_CUTOVER_ERROR =
  "This credit memo is from before your accounting cutover and credits a contract or a rental agreement. Invoice the customer for the amount instead.";

/** A memo's journal built again: its lines, each with the stand-in role its
 *  posting gives it, and the party dimensions every line carries. */
export type RebuiltMemoJournal = {
  lines: MemoJournalLineWithRole[];
  dimensions: { dimensionId: string; valueId: string }[];
};

/**
 * The journals of many memos of one company, built again with
 * `buildMemoJournal` in a fixed number of reads: the control leg on today's
 * receivables or payables default, which is where the opening journal opened
 * the memo, and the reason leg on the memo's own reason account.
 *
 * `postingStatus` is the status the journal posts with, and it decides what
 * a customer credit memo that credits a contract or a rental agreement does:
 * - `Posted` (the void of a memo dated before the cutover) refuses it with
 *   `MEMO_CREDIT_VOID_BEFORE_CUTOVER_ERROR`: its legs came from contract
 *   positions and deferral rows that the enable has moved on.
 * - `Provisional` (the enable's legacy memos) books it as a plain memo on
 *   the sales account.
 */
export async function rebuildMemoJournals(
  trx: Transaction<KyselyDatabase>,
  memos: MemoRow[],
  companyId: string,
  options: { postingStatus: AutomaticJournalStatus }
): Promise<RebuiltMemoJournal[]> {
  if (memos.length === 0) return [];
  const { postingStatus } = options;
  for (const memo of memos) {
    if (Boolean(memo.customerId) === Boolean(memo.supplierId)) {
      throw new Error("Memo must have exactly one customer or supplier");
    }
    if (
      postingStatus === "Posted" &&
      memo.customerId &&
      isContractOrRentalCredit(memo)
    ) {
      throw new InvalidInputError(MEMO_CREDIT_VOID_BEFORE_CUTOVER_ERROR);
    }
  }
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company?.companyGroupId) {
    throw new Error("Memo currency configuration is missing");
  }
  const companyGroupId = company.companyGroupId;
  const customerIds = [
    ...new Set(memos.flatMap((memo) => memo.customerId ?? []))
  ];
  const supplierIds = [
    ...new Set(memos.flatMap((memo) => memo.supplierId ?? []))
  ];
  const customers = customerIds.length
    ? await trx
        .selectFrom("customer")
        .select(["id", "customerTypeId as typeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", customerIds)
        .execute()
    : [];
  const suppliers = supplierIds.length
    ? await trx
        .selectFrom("supplier")
        .select(["id", "supplierTypeId as typeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", supplierIds)
        .execute()
    : [];
  const typeByParty = new Map(
    [...customers, ...suppliers].map((row) => [row.id, row.typeId])
  );
  const defaults = await trx
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) {
    throw new Error("Accounting defaults are required before posting");
  }

  const plans = memos.map((memo) => {
    const isAR = Boolean(memo.customerId);
    const partyId = (isAR ? memo.customerId : memo.supplierId)!;
    if (!typeByParty.has(partyId)) {
      throw new NotFoundError("Memo counterparty not found in this company");
    }
    const controlAccountId = isAR
      ? defaults.receivablesAccount
      : defaults.payablesAccount;
    // A contract or rental credit books a plain memo on the sales account.
    // Otherwise the memo keeps the reason account it posted to, unless that
    // was a stand-in; then the default it stood in for.
    const reason =
      isAR && isContractOrRentalCredit(memo)
        ? { accountId: defaults.salesAccount, accountDefaultRole: null }
        : memo.reasonAccount
          ? { accountId: memo.reasonAccount, accountDefaultRole: null }
          : plainMemoReasonAccount(memo, defaults, isAR, postingStatus);
    if (!controlAccountId || !reason.accountId) {
      throw new Error("Memo control and reason account defaults are required");
    }
    return {
      memo,
      isAR,
      partyId,
      controlAccountId,
      reasonAccountId: reason.accountId,
      reasonAccountDefaultRole: reason.accountDefaultRole
    };
  });
  const reasonAccounts = await trx
    .selectFrom("account")
    .select(["id", "class"])
    .where("id", "in", [...new Set(plans.map((plan) => plan.reasonAccountId))])
    .where("companyGroupId", "=", companyGroupId)
    .execute();
  const classByAccount = new Map(
    reasonAccounts.map((row) => [row.id, row.class])
  );
  const carriedCosts = await supplierReturnCarriedCosts(trx, memos, companyId);
  const dimensions = await loadPartyDimensions(trx, companyGroupId);

  return plans.map((plan) => {
    const { memo, isAR, partyId } = plan;
    const reasonClass = classByAccount.get(plan.reasonAccountId);
    if (!reasonClass) {
      throw new Error(
        "Memo accounts must be active posting accounts in this company group with the correct control class"
      );
    }
    const { lines } = buildMemoJournal({
      memoId: memo.id,
      companyId,
      isAR,
      direction: memo.direction,
      amount: Number(memo.amount),
      exchangeRate: Number(memo.exchangeRate),
      journalLineReference: nanoid(),
      controlAccountId: plan.controlAccountId,
      reasonAccountId: plan.reasonAccountId,
      reasonAccountClass: reasonClass,
      reasonAmountBase: carriedCosts.get(memo.id),
      varianceAccountId: defaults.purchaseVarianceAccount,
      reasonDescription: memo.purchaseReturnOrderId
        ? "Goods Received Not Invoiced"
        : undefined
    });
    assertNoMigrationClearing(lines, defaults.migrationClearingAccount);
    return {
      lines: withReasonRole(
        lines,
        plan.reasonAccountId,
        plan.reasonAccountDefaultRole
      ),
      dimensions: partyDimensionValuesFrom(dimensions, {
        isAR,
        partyId,
        typeId: typeByParty.get(partyId) ?? null
      })
    };
  });
}

/** The journal of a memo dated before the cutover, built again for its void. */
export async function rebuildMemoJournal(
  trx: Transaction<KyselyDatabase>,
  memo: MemoRow,
  postingStatus: AutomaticJournalStatus
): Promise<RebuiltMemoJournal> {
  const [rebuilt] = await rebuildMemoJournals(trx, [memo], memo.companyId, {
    postingStatus
  });
  return rebuilt!;
}
/** One early-return adjustment the memo bills (`rentalBillingPeriod.memoId`). */
export type RentalCreditPeriod = {
  id: string;
  rentalAgreementLineId: string;
  periodStart: string;
  periodEnd: string;
  /** The adjustment row's amount: negative. */
  amount: number;
  classification: RentalClassification | null;
};

export type RentalCreditScheduleRow = {
  rentalAgreementLineId: string;
  periodStart: string;
  periodEnd: string;
  scheduledDate: string;
  /** Negative: it shrinks the period's Planned rows. */
  amount: number;
};

export type RentalCreditPlan = {
  /** Signed credits (negative = debit) replacing the memo's reason leg. */
  legs: {
    account: "deferredRevenue" | "rentalIncome";
    accountClass: "Liability" | "Revenue";
    description: string;
    credit: number;
  }[];
  scheduleRows: RentalCreditScheduleRow[];
};

// planRentalLine returns its legs with the accounts it was given; only the
// amounts are read here, the accounts come from the account defaults.
const PLACEHOLDER_ACCOUNT: SalesPostingAccount = {
  id: "",
  class: null,
  active: true,
  isGroup: false,
  companyGroupId: ""
};

export function planRentalCredit(args: {
  /** The memo amount, in the agreement (base) currency. */
  memoAmount: number;
  /** The currency's `decimalPlaces`. */
  decimals: number;
  periods: RentalCreditPeriod[];
  /** Planned Deferral rows per agreement line. */
  plannedDeferrals: Map<string, RentalScheduleFact[]>;
  rentalAgreementId: string;
}): RentalCreditPlan {
  const { memoAmount, decimals, periods, rentalAgreementId } = args;
  if (periods.length === 0) {
    throw new Error(
      "This rental credit memo bills no early-return periods; delete it and invoice the agreement again"
    );
  }
  const credits = periods.map((period) => -period.amount);
  const total = round(
    credits.reduce((sum, value) => sum + value, 0),
    decimals
  );
  if (total !== memoAmount) {
    throw new Error(
      `This credit memo is for ${memoAmount}, but the early returns it credits come to ${total}; delete it and invoice the agreement again`
    );
  }
  // Each period's share at settlement precision, summing to the memo exactly
  // (a period cut before billing rounded to the currency kept sub-unit digits).
  const shares = distributeRoundingResidual(credits, memoAmount, decimals);

  // A copy per line, grown by every row this memo writes, so two credits on
  // one line never shrink the same Planned row twice.
  const deferrals = new Map(
    [...args.plannedDeferrals].map(([lineId, rows]) => [lineId, [...rows]])
  );
  let deferred = 0;
  let income = 0;
  const scheduleRows: RentalCreditScheduleRow[] = [];
  periods.forEach((period, index) => {
    const revenueBase = -shares[index]!;
    if (revenueBase === 0) return;
    const facts = deferrals.get(period.rentalAgreementLineId) ?? [];
    const plan = planRentalLine({
      lineType: "Rent",
      classification: period.classification,
      revenueBase,
      period: { periodStart: period.periodStart, periodEnd: period.periodEnd },
      unbilledAccruals: [],
      plannedDeferrals: facts,
      accounts: {
        deferredRevenue: PLACEHOLDER_ACCOUNT,
        contractAsset: PLACEHOLDER_ACCOUNT,
        rentalIncome: PLACEHOLDER_ACCOUNT
      },
      rentalAgreementId
    });
    // A credit's first leg is Rental Income with its amount; the deferred leg
    // takes the rest.
    const incomeAmount = plan.revenueLegs[0]?.amount ?? 0;
    const deferredAmount = round(revenueBase - incomeAmount);
    income = round(income + incomeAmount);
    deferred = round(deferred + deferredAmount);
    for (const row of rentalScheduleRows(plan.schedule, deferredAmount)) {
      const scheduleRow = {
        rentalAgreementLineId: period.rentalAgreementLineId,
        ...row
      };
      scheduleRows.push(scheduleRow);
      facts.push({ id: `${period.id}:${scheduleRows.length}`, ...row });
    }
    deferrals.set(period.rentalAgreementLineId, facts);
  });

  return {
    legs: [
      {
        account: "deferredRevenue" as const,
        accountClass: "Liability" as const,
        description: "Deferred Revenue",
        credit: deferred
      },
      {
        account: "rentalIncome" as const,
        accountClass: "Revenue" as const,
        description: "Rental Income",
        credit: income
      }
    ].filter((leg) => leg.credit !== 0),
    scheduleRows
  };
}
export const postMemoInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  memoId: z.string()
});

export const postMemoPermission = {
  update: "invoicing"
} satisfies PermissionRule<z.output<typeof postMemoInput>>;

/** Posts or voids a credit/debit memo and its journal, atomically. */
export async function postMemo(
  ctx: ServiceContext,
  raw: z.input<typeof postMemoInput>
) {
  const { type, memoId } = postMemoInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();

  // A contract cancellation credit is irreversible once its memo has
  // posted: reversing its journal would not restore the contract.
  if (type === "void") {
    const memo = await db
      .selectFrom("memo")
      .select(["customerContractId", "rentalAgreementId"])
      .where("id", "=", memoId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (memo?.customerContractId) {
      throw new ServerFnError(
        "A contract cancellation credit cannot be voided",
        400
      );
    }
    // A rental early-return credit can be voided while its Deferral rows are
    // all still Planned and unclaimed: the void deletes them and returns the
    // periods to Pending. Once a run has recognized one, reversing the memo
    // journal would leave that recognition standing.
    if (memo?.rentalAgreementId) {
      const recognized = await db
        .selectFrom("revenueRecognitionSchedule")
        .select("id")
        .where("companyId", "=", companyId)
        .where("memoId", "=", memoId)
        .where((eb) =>
          eb.or([eb("status", "=", "Posted"), eb("runLineId", "is not", null)])
        )
        .limit(1)
        .executeTakeFirst();
      if (recognized) {
        throw new ServerFnError(
          "This rental credit is already part of a lease run; reverse or delete the run before voiding it",
          400
        );
      }
    }
  }

  const result = await postMemoTransaction(db, {
    type,
    memoId,
    userId,
    companyId,
    today
  });
  return { success: true, ...result };
}
type Trx = Transaction<KyselyDatabase>;

export type PaymentRow = Selectable<KyselyDatabase["payment"]>;

type journalInputAccountDefaults = Selectable<KyselyDatabase["accountDefault"]>;

/** A journal line with the stand-in role the posting gives it. */
export type PaymentJournalLineWithRole = PaymentJournalLine & {
  accountDefaultRole: OptionalDefaultRole | null;
};

/** What decides the shape of a payment's journal, from the stored row. */
export function paymentKind(
  payment: Pick<
    PaymentRow,
    | "customerId"
    | "supplierId"
    | "employeeId"
    | "paymentType"
    | "rentalAgreementId"
    | "salesOrderId"
  >
) {
  // An employee payee is a reimbursement payout: always cash OUT against the
  // employee-payable control account, so it is neither AR nor a refund, has
  // no trade-party row, and has no on-account credit history to draw on.
  const isReimbursement = payment.employeeId !== null;
  const isAR = payment.customerId !== null;
  const partyId = isReimbursement
    ? payment.employeeId
    : isAR
      ? payment.customerId
      : payment.supplierId;
  if (
    !partyId ||
    [payment.customerId, payment.supplierId, payment.employeeId].filter(Boolean)
      .length !== 1
  ) {
    throw new Error(
      "A payment requires exactly one party (customer, supplier, or employee)"
    );
  }
  const cashIn = payment.paymentType === "Receipt";
  const isRefund = !isReimbursement && cashIn !== isAR;
  return {
    isReimbursement,
    isAR,
    cashIn,
    isRefund,
    // A payment that references a sales order or rental agreement is a
    // customer deposit: its unapplied cash is a liability on the prepayment
    // account rather than on-account receivable credit. The builder ignores
    // the flag for supplier payments.
    isDeposit: Boolean(payment.rentalAgreementId ?? payment.salesOrderId),
    partyId,
    targetColumn: isReimbursement
      ? ("targetReimbursementId" as const)
      : isRefund
        ? ("targetMemoId" as const)
        : isAR
          ? ("targetSalesInvoiceId" as const)
          : ("targetPurchaseInvoiceId" as const),
    // A target's control line: its document type, descriptions and source
    // types. A target open at the accounting cutover carries its control line
    // in the opening journal, with the same document keys.
    targetDocumentType: isReimbursement
      ? ("Reimbursement" as const)
      : isRefund
        ? ("Memo" as const)
        : ("Invoice" as const),
    targetDescriptions: (isReimbursement
      ? [REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION]
      : isAR
        ? RECEIVABLE_POSTING_DESCRIPTIONS
        : PAYABLE_POSTING_DESCRIPTIONS) as readonly string[],
    targetSourceTypes: [
      isReimbursement
        ? "Reimbursement"
        : isRefund
          ? isAR
            ? "Credit Memo"
            : "Debit Memo"
          : isAR
            ? "Sales Invoice"
            : "Purchase Invoice",
      "Opening Balance"
    ] as readonly string[],
    // A source's unapplied cash was booked EITHER as on-account credit or,
    // for a customer deposit, on the prepayment account; the description
    // says which.
    sourceDescriptions: (isAR
      ? [onAccountCreditDescription(true), CUSTOMER_DEPOSIT_DESCRIPTION]
      : [onAccountCreditDescription(false)]) as readonly string[]
  };
}

export type PaymentKind = ReturnType<typeof paymentKind>;

const TARGET_DESCRIPTIONS = [
  ...new Set<string>([
    REIMBURSEMENT_PAYABLE_POSTING_DESCRIPTION,
    ...RECEIVABLE_POSTING_DESCRIPTIONS,
    ...PAYABLE_POSTING_DESCRIPTIONS
  ])
];

/** The control lines of the targets, for every payment kind; filter them
 *  per payment with `foldTargetControls`. */
export function readTargetControlLines(
  trx: Trx,
  companyId: string,
  targetIds: string[]
) {
  if (targetIds.length === 0) return Promise.resolve([]);
  return trx
    .selectFrom("journalLine as line")
    .innerJoin("journal as journal", (join) =>
      join
        .onRef("journal.id", "=", "line.journalId")
        .onRef("journal.companyId", "=", "line.companyId")
    )
    .select([
      "line.documentId",
      "line.documentType",
      "line.description",
      "line.amount",
      "line.accountId",
      "line.accountDefaultRole",
      "journal.sourceType"
    ])
    .where("line.companyId", "=", companyId)
    .where("line.documentType", "in", ["Invoice", "Memo", "Reimbursement"])
    .where(sql<boolean>`"line"."documentId" = any(${targetIds}::text[])`)
    .where("line.description", "in", TARGET_DESCRIPTIONS)
    .where("journal.sourceType", "in", [
      "Reimbursement",
      "Credit Memo",
      "Debit Memo",
      "Sales Invoice",
      "Purchase Invoice",
      "Opening Balance"
    ])
    .where("journal.status", "in", [...OPEN_ITEM_JOURNAL_STATUSES])
    .execute();
}

export type TargetControlLine = Awaited<
  ReturnType<typeof readTargetControlLines>
>[number];

/** Each target's original control account, carrying value and stand-in role. */
export type TargetControls = {
  controlById: Map<string, string>;
  carryingById: Map<string, number>;
  /** Before the cutover a control line may be a stand-in: booked on
   *  retained earnings, naming the default it wanted. */
  roleById: Map<string, OptionalDefaultRole | null>;
};

/** The control lines of `kind`'s targets, folded per target. */
export function foldTargetControls(
  kind: PaymentKind,
  lines: TargetControlLine[]
): TargetControls {
  const controls: TargetControls = {
    controlById: new Map(),
    carryingById: new Map(),
    roleById: new Map()
  };
  for (const line of lines) {
    if (
      !line.documentId ||
      line.documentType !== kind.targetDocumentType ||
      !kind.targetDescriptions.includes(line.description ?? "") ||
      !kind.targetSourceTypes.includes(line.sourceType ?? "")
    ) {
      continue;
    }
    if (!line.accountId) {
      throw new Error("Invoice is missing its original control account");
    }
    const originalAccount = controls.controlById.get(line.documentId);
    if (originalAccount && originalAccount !== line.accountId) {
      throw new Error("Invoice has conflicting original control accounts");
    }
    controls.controlById.set(line.documentId, line.accountId);
    controls.carryingById.set(
      line.documentId,
      round(
        (controls.carryingById.get(line.documentId) ?? 0) + Number(line.amount)
      )
    );
    if (line.accountDefaultRole || !controls.roleById.has(line.documentId)) {
      controls.roleById.set(
        line.documentId,
        (line.accountDefaultRole as OptionalDefaultRole | null) ?? null
      );
    }
  }
  return controls;
}

/** The on-account and deposit lines of the funding sources, for every
 *  payment kind; filter them per payment with `foldSourceControls`. */
export function readSourceControlLines(
  trx: Trx,
  companyId: string,
  sourceIds: string[]
) {
  if (sourceIds.length === 0) return Promise.resolve([]);
  return trx
    .selectFrom("journalLine as line")
    .innerJoin("journal as journal", (join) =>
      join
        .onRef("journal.id", "=", "line.journalId")
        .onRef("journal.companyId", "=", "line.companyId")
    )
    .select([
      "line.documentId",
      "line.accountId",
      "line.description",
      "line.accountDefaultRole"
    ])
    .where("line.companyId", "=", companyId)
    .where("line.documentType", "=", "Payment")
    .where(sql<boolean>`"line"."documentId" = any(${sourceIds}::text[])`)
    .where("line.description", "in", [
      onAccountCreditDescription(true),
      onAccountCreditDescription(false),
      CUSTOMER_DEPOSIT_DESCRIPTION
    ])
    .where("journal.sourceType", "in", ["Payment", "Opening Balance"])
    .where("journal.status", "in", [...OPEN_ITEM_JOURNAL_STATUSES])
    .execute();
}

export type SourceControlLine = {
  documentId: string | null;
  accountId: string | null;
  description: string | null;
  accountDefaultRole: string | null;
};

/** Each funding source's original control account, whether it is a
 *  deposit, and its stand-in role. */
export type SourceControls = {
  accountById: Map<string, string>;
  /** Sources whose credit is a deposit (booked on the prepayment account):
   *  released as a liability under the deposit description. */
  depositIds: Set<string>;
  roleById: Map<string, OptionalDefaultRole | null>;
};

/** The control lines of `kind`'s funding sources, folded per source. */
export function foldSourceControls(
  kind: PaymentKind,
  lines: SourceControlLine[]
): SourceControls {
  const controls: SourceControls = {
    accountById: new Map(),
    depositIds: new Set(),
    roleById: new Map()
  };
  for (const line of lines) {
    if (
      !line.documentId ||
      !kind.sourceDescriptions.includes(line.description ?? "")
    ) {
      continue;
    }
    if (!line.accountId) {
      throw new Error("Funding source is missing its original control account");
    }
    const lineIsDeposit = line.description === CUSTOMER_DEPOSIT_DESCRIPTION;
    const originalAccount = controls.accountById.get(line.documentId);
    if (
      originalAccount &&
      (originalAccount !== line.accountId ||
        controls.depositIds.has(line.documentId) !== lineIsDeposit)
    ) {
      throw new Error(
        "Funding source has conflicting original control accounts"
      );
    }
    controls.accountById.set(line.documentId, line.accountId);
    if (lineIsDeposit) controls.depositIds.add(line.documentId);
    if (line.accountDefaultRole || !controls.roleById.has(line.documentId)) {
      controls.roleById.set(
        line.documentId,
        (line.accountDefaultRole as OptionalDefaultRole | null) ?? null
      );
    }
  }
  return controls;
}

/** A payment's counterparty: its type, for the party dimension, and its
 *  intercompany link. */
export type PaymentParty = {
  typeId: string | null;
  intercompanyCompanyId: string | null;
};

/**
 * The counterparties of the payments, in one read per party table. An
 * employee is neither a customer nor a supplier, so it has no trade party
 * type to tag journal lines with. The lookup throws for a party that is not
 * in the company.
 */
export async function readPaymentParties(
  trx: Trx,
  companyId: string,
  kinds: PaymentKind[]
): Promise<(kind: PaymentKind) => PaymentParty> {
  const ids = (predicate: (kind: PaymentKind) => boolean) => [
    ...new Set(kinds.filter(predicate).map((kind) => kind.partyId))
  ];
  const customerIds = ids((kind) => !kind.isReimbursement && kind.isAR);
  const supplierIds = ids((kind) => !kind.isReimbursement && !kind.isAR);
  const employeeIds = ids((kind) => kind.isReimbursement);
  type PartyRow = PaymentParty & { id: string };
  const none = Promise.resolve([] as PartyRow[]);
  const [customers, suppliers, employees] = await Promise.all([
    customerIds.length
      ? trx
          .selectFrom("customer")
          .select(["id", "customerTypeId as typeId", "intercompanyCompanyId"])
          .where("companyId", "=", companyId)
          .where("id", "in", customerIds)
          .execute()
      : none,
    supplierIds.length
      ? trx
          .selectFrom("supplier")
          .select(["id", "supplierTypeId as typeId", "intercompanyCompanyId"])
          .where("companyId", "=", companyId)
          .where("id", "in", supplierIds)
          .execute()
      : none,
    employeeIds.length
      ? trx
          .selectFrom("employee")
          .select("id")
          .where("companyId", "=", companyId)
          .where("id", "in", employeeIds)
          .execute()
      : Promise.resolve([] as { id: string }[])
  ]);
  const customerById = new Map(customers.map((row) => [row.id, row]));
  const supplierById = new Map(suppliers.map((row) => [row.id, row]));
  const employeeIdSet = new Set(employees.map((row) => row.id));
  return (kind) => {
    const party = kind.isReimbursement
      ? employeeIdSet.has(kind.partyId)
        ? { typeId: null, intercompanyCompanyId: null }
        : undefined
      : (kind.isAR ? customerById : supplierById).get(kind.partyId);
    if (!party) throw new NotFoundError("Payment counterparty not found");
    return {
      typeId: party.typeId,
      intercompanyCompanyId: party.intercompanyCompanyId
    };
  };
}

/** The classes of the payment discount accounts, for the discount line's
 *  natural-balance sign. */
export async function readDiscountAccountClasses(
  trx: Trx,
  companyGroupId: string,
  defaults: journalInputAccountDefaults
): Promise<Map<string, string | null>> {
  const ids = [
    ...new Set(
      [
        defaults.customerPaymentDiscountAccount,
        defaults.supplierPaymentDiscountAccount
      ].filter((id): id is string => !!id)
    )
  ];
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom("account")
    .select(["id", "class"])
    .where("id", "in", ids)
    .where("companyGroupId", "=", companyGroupId)
    .execute();
  return new Map(rows.map((row) => [row.id, row.class]));
}

/**
 * The control account a payment books its new on-account credit to, and a
 * target with no control line. A reimbursement books to the employee
 * payable default and an intercompany party to its intercompany default;
 * each falls back to payables or receivables when empty.
 */
export function paymentControlAccount(
  kind: PaymentKind,
  party: PaymentParty,
  defaults: journalInputAccountDefaults,
  postingStatus: AutomaticJournalStatus
): { accountId: string; accountDefaultRole: OptionalDefaultRole | null } {
  if (kind.isReimbursement) {
    return resolveDefaultAccount(
      defaults,
      "employeeReimbursementsPayableAccount",
      postingStatus
    );
  }
  if (party.intercompanyCompanyId) {
    return resolveDefaultAccount(
      defaults,
      kind.isAR
        ? "intercompanyReceivablesAccount"
        : "intercompanyPayablesAccount",
      postingStatus
    );
  }
  return {
    accountId: kind.isAR
      ? defaults.receivablesAccount
      : defaults.payablesAccount,
    accountDefaultRole: null
  };
}

/** One settlement of the payment, as the posting stores it. */
export type PaymentApplication = {
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
  targetMemoId: string | null;
  targetReimbursementId: string | null;
  sourcePaymentId: string | null;
  sourceAmount: number;
  sourceExchangeRate: number;
  targetExchangeRate: number;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number;
};

/**
 * Builds the payment's journal from what the posting resolves: the lines,
 * each with its stand-in role, and the applications and accounts the
 * builder took (the posting checks their classes).
 *
 * A line takes a stand-in role from what it books, not from its account, so
 * two empty defaults on one payment keep their own roles even when both
 * stand in on retained earnings:
 * - a target's control line takes the role of the target's control line,
 *   else (a target with no control line) the control account's;
 * - the new on-account credit takes the control account's role;
 * - a released prior credit takes its source's role, else the control
 *   account's.
 */
export function assemblePaymentJournal(args: {
  payment: PaymentRow;
  kind: PaymentKind;
  companyId: string;
  defaults: journalInputAccountDefaults;
  control: {
    accountId: string;
    accountDefaultRole: OptionalDefaultRole | null;
  };
  discountClasses: Map<string, string | null>;
  targets: TargetControls;
  sources: SourceControls;
  applications: PaymentApplication[];
  /** The current cash the funding allocation left unapplied, in base. */
  newOnAccountBase: number;
  fee?: PaymentJournalFeeInput;
  journalLineReference: string;
}): {
  lines: PaymentJournalLineWithRole[];
  input: BuildPaymentJournalInput;
} {
  const {
    payment,
    kind,
    companyId,
    defaults,
    control,
    discountClasses,
    targets,
    sources
  } = args;
  const discountAccountId = kind.isAR
    ? defaults.customerPaymentDiscountAccount
    : defaults.supplierPaymentDiscountAccount;
  // The discount account's class signs the discount line by its natural
  // balance (customer discount -> Revenue/contra-revenue; supplier discount
  // -> Expense/contra-COGS).
  if (discountAccountId && !discountClasses.has(discountAccountId)) {
    throw new Error("Failed to fetch the payment discount account class");
  }
  const discountAccountClass = discountAccountId
    ? (discountClasses.get(discountAccountId) ?? null)
    : null;
  const applications = args.applications.map((application) => {
    const target = application[kind.targetColumn];
    const sourceId = application.sourcePaymentId;
    return {
      ...application,
      // Before the cutover a target posted with no journal has no control
      // line: the default control account stands in for it.
      targetControlAccountId:
        (target ? targets.controlById.get(target) : undefined) ??
        control.accountId,
      sourceControlAccountId: sourceId
        ? sources.accountById.get(sourceId)
        : undefined,
      sourceIsDeposit: sourceId ? sources.depositIds.has(sourceId) : undefined
    };
  });
  const input: BuildPaymentJournalInput = {
    paymentId: payment.id,
    companyId,
    isAR: kind.isAR,
    isReimbursement: kind.isReimbursement,
    cashIn: kind.cashIn,
    totalAmount: Number(payment.totalAmount),
    exchangeRate: Number(payment.exchangeRate),
    bankAccount: payment.bankAccount,
    journalLineReference: args.journalLineReference,
    applications,
    newOnAccountBase: args.newOnAccountBase,
    fee: args.fee,
    accounts: {
      // For a reimbursement this drives ONLY the new on-account remainder:
      // every application carries the payable line of the reimbursement's
      // own journal as its `targetControlAccountId`.
      controlAccountId: control.accountId,
      discountAccountId,
      discountAccountClass,
      writeOffAccountId: kind.isAR
        ? defaults.customerWriteOffAccount
        : defaults.supplierWriteOffAccount,
      fxGainAccountId: defaults.realizedExchangeGainAccount,
      fxLossAccountId: defaults.realizedExchangeLossAccount
    },
    isDeposit: kind.isDeposit,
    depositAccountId: defaults.prepaymentAccount
  };

  const controlDescription = kind.isReimbursement
    ? "Employee Reimbursements Payable"
    : kind.isAR
      ? "Accounts Receivable"
      : "Accounts Payable";
  const creditAppliedDescriptions = [
    `${kind.isAR ? "Accounts Receivable" : "Accounts Payable"} (credit applied)`,
    CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION
  ];
  // The builder releases prior credit one line per account.
  const sourceRoleByAccount = new Map<string, OptionalDefaultRole | null>();
  for (const application of applications) {
    const sourceId = application.sourcePaymentId;
    if (!sourceId) continue;
    const accountId = application.sourceControlAccountId ?? control.accountId;
    const role = sources.accountById.has(sourceId)
      ? (sources.roleById.get(sourceId) ?? null)
      : control.accountDefaultRole;
    if (role || !sourceRoleByAccount.has(accountId)) {
      sourceRoleByAccount.set(accountId, role);
    }
  }
  const roleOf = (line: PaymentJournalLine): OptionalDefaultRole | null => {
    if (line.documentLineReference && line.description === controlDescription) {
      const target = line.documentLineReference;
      return targets.controlById.has(target)
        ? (targets.roleById.get(target) ?? null)
        : control.accountDefaultRole;
    }
    if (line.description === onAccountCreditDescription(kind.isAR)) {
      return control.accountDefaultRole;
    }
    if (creditAppliedDescriptions.includes(line.description)) {
      return sourceRoleByAccount.get(line.accountId) ?? null;
    }
    return null;
  };
  return {
    input,
    lines: buildPaymentJournal(input).lines.map((line) => ({
      ...line,
      accountDefaultRole: roleOf(line)
    }))
  };
}

/**
 * The party dimensions every line of the payment's journal carries. A
 * reimbursement payout has no trade party to tag, and the reimbursement's
 * own journal writes no party dimension either.
 */
export function paymentDimensions(
  dimensions: { id: string; entityType: string }[],
  kind: PaymentKind,
  party: PaymentParty
): { dimensionId: string; valueId: string }[] {
  if (kind.isReimbursement) return [];
  return partyDimensionValuesFrom(dimensions, {
    isAR: kind.isAR,
    partyId: kind.partyId,
    typeId: party.typeId
  });
}
export type PostPaymentArgs = {
  type: "post" | "void";
  paymentId: string;
  companyId: string;
  userId: string;
  today: string;
  fee?: PaymentJournalFeeInput;
};

function settlementQuery(trx: Transaction<KyselyDatabase>, companyId: string) {
  return trx
    .selectFrom("invoiceSettlement as s")
    .leftJoin("payment as p", (join) =>
      join
        .onRef("p.id", "=", "s.paymentId")
        .onRef("p.companyId", "=", "s.companyId")
    )
    .leftJoin("memo as m", (join) =>
      join
        .onRef("m.id", "=", "s.memoId")
        .onRef("m.companyId", "=", "s.companyId")
    )
    .leftJoin("payment as vp", (join) =>
      join
        .onRef("vp.id", "=", "s.appliedViaPaymentId")
        .onRef("vp.companyId", "=", "s.companyId")
    )
    .selectAll("s")
    .select([
      "p.status as paymentStatus",
      "m.status as memoStatus",
      "vp.status as viaStatus"
    ])
    .where("s.companyId", "=", companyId);
}

function principal(value: number | null, label: string): number {
  if (value === null || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`Missing or invalid source principal for ${label}`);
  }
  return Number(value);
}

/** The endpoint's single commit boundary; every monetary snapshot is read under locks. */
export function postPaymentTransaction(
  db: Kysely<KyselyDatabase>,
  args: PostPaymentArgs
): Promise<{ journalId: string | null }> {
  const { companyId, paymentId, userId, today, fee, type } = args;
  return db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom("payment")
      .selectAll()
      .where("id", "=", paymentId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!payment) throw new NotFoundError("Payment not found");
    if (type === "post" && payment.status === "Posted") {
      return { journalId: payment.journalId };
    }
    if (type === "void" && payment.status === "Voided") {
      return { journalId: payment.journalId };
    }
    if (payment.status !== (type === "post" ? "Draft" : "Posted")) {
      throw new Error(`Cannot ${type} payment in status ${payment.status}`);
    }

    // Every payment posts a journal: Provisional before the company's
    // accounting cutover, Posted after it. FOR SHARE holds the cutover until
    // commit. A Provisional journal has no accounting period.
    const cutoverDate = await readAccountingCutoverDate(trx, companyId);
    const postingStatus = postingStatusFor(cutoverDate);
    const timestamp = datetime.timestamp();
    let accountingPeriodId: string | null = null;
    if (postingStatus === "Posted") {
      accountingPeriodId = await getCurrentAccountingPeriod(
        companyId,
        trx,
        today
      );
      // The reader also checks period status, but the row lock protects the
      // posting against a concurrent close/lock after that read.
      const period = await trx
        .selectFrom("accountingPeriod")
        .select(["id", "closeStatus"])
        .where("id", "=", accountingPeriodId)
        .where("companyId", "=", companyId)
        .forShare()
        .executeTakeFirst();
      if (
        !period ||
        period.closeStatus === "Closed" ||
        period.closeStatus === "Locked"
      )
        throw new Error("Accounting period is closed or locked");
    }

    if (type === "void") {
      const consumers = await settlementQuery(trx, companyId)
        .where("s.sourcePaymentId", "=", paymentId)
        .execute();
      if (
        consumers.some(
          (row) =>
            isEffectiveSettlement(row) &&
            principal(row.sourceAmount, row.id) > 0
        )
      ) {
        throw new Error(
          "Cannot void a funding source while posted payments consume its credit"
        );
      }
      let reversalId: string | null = null;
      const insertVoidJournal = async () =>
        (
          await trx
            .insertInto("journal")
            .values({
              journalEntryId: await getNextSequence(
                trx,
                "journalEntry",
                companyId
              ),
              accountingPeriodId,
              description: `VOID Payment ${payment.paymentId}`,
              postingDate: today,
              companyId,
              sourceType: "Payment",
              status: postingStatus,
              postedAt: timestamp,
              postedBy: userId,
              createdBy: userId
            })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
      // Before the cutover the payment's own journal is Superseded, and the
      // opening journal carries what the payment left open. The void builds
      // the payment's posting again and negates it, today, so it nets those
      // opening lines.
      if (
        payment.postingDate &&
        isBeforeCutover(payment.postingDate, cutoverDate)
      ) {
        const rebuilt = await rebuildPaymentJournal(
          trx,
          payment,
          companyId,
          postingStatus
        );
        if (rebuilt.lines.length) {
          reversalId = await insertVoidJournal();
          const lines = await trx
            .insertInto("journalLine")
            .values(
              rebuilt.lines.map((line) => ({
                journalId: reversalId!,
                accountId: line.accountId,
                amount: -line.amount,
                quantity: line.quantity,
                description: `VOID: ${line.description}`,
                documentType: "Payment" as const,
                documentId: paymentId,
                documentLineReference: line.documentLineReference ?? null,
                journalLineReference: line.journalLineReference,
                accountDefaultRole: line.accountDefaultRole,
                companyId
              }))
            )
            .returning("id")
            .execute();
          const values = rebuilt.dimensions.flatMap((dimension) =>
            lines.map((line) => ({
              journalLineId: line.id,
              ...dimension,
              companyId
            }))
          );
          if (values.length) {
            await trx
              .insertInto("journalLineDimension")
              .values(values)
              .execute();
          }
        }
      } else if (payment.journalId) {
        const original = await trx
          .selectFrom("journalLine")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "journalLine.journalId")
              .onRef("journal.companyId", "=", "journalLine.companyId")
          )
          .selectAll("journalLine")
          .where("journalLine.journalId", "=", payment.journalId)
          .where("journalLine.companyId", "=", companyId)
          .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
          .orderBy("journalLine.id")
          .execute();
        if (original.length) {
          const reversedId = await insertVoidJournal();
          reversalId = reversedId;
          const lines = await trx
            .insertInto("journalLine")
            .values(
              original.map((line) => ({
                journalId: reversedId,
                accountId: line.accountId,
                amount: -Number(line.amount),
                quantity: line.quantity,
                description: `VOID: ${line.description ?? ""}`,
                documentType: "Payment" as const,
                documentId: paymentId,
                documentLineReference: line.documentLineReference,
                journalLineReference: line.journalLineReference,
                accountDefaultRole: line.accountDefaultRole,
                companyId
              }))
            )
            .returning("id")
            .execute();
          const dimensions = await trx
            .selectFrom("journalLineDimension")
            .select(["journalLineId", "dimensionId", "valueId"])
            .where("companyId", "=", companyId)
            .where(
              "journalLineId",
              "in",
              original.map((line) => line.id)
            )
            .execute();
          const reverseIdByOriginal = new Map(
            original.map((line, index) => [line.id, lines[index]!.id])
          );
          if (dimensions.length) {
            await trx
              .insertInto("journalLineDimension")
              .values(
                dimensions.map((dimension) => ({
                  ...dimension,
                  journalLineId: reverseIdByOriginal.get(
                    dimension.journalLineId
                  )!,
                  companyId
                }))
              )
              .execute();
          }
        }
      }
      await trx
        .updateTable("payment")
        .set({
          status: "Voided",
          voidedAt: timestamp,
          voidedBy: userId,
          updatedAt: timestamp,
          updatedBy: userId
        })
        .where("id", "=", paymentId)
        .where("companyId", "=", companyId)
        .execute();
      return { journalId: reversalId };
    }

    const kind = paymentKind(payment);
    const { isAR, isReimbursement, cashIn, isRefund, isDeposit, partyId } =
      kind;
    if (isReimbursement && cashIn) {
      throw new Error("An employee payment must be a disbursement");
    }
    assertExchangeRate(Number(payment.exchangeRate));
    const company = await trx
      .selectFrom("company")
      .select(["companyGroupId", "baseCurrencyCode"])
      .where("id", "=", companyId)
      .executeTakeFirstOrThrow();
    if (!company.companyGroupId || !payment.currencyCode) {
      throw new Error("Payment currency configuration is missing");
    }
    const currency = await trx
      .selectFrom("currency")
      .select("decimalPlaces")
      .where("code", "=", payment.currencyCode)
      .where("companyGroupId", "=", company.companyGroupId)
      .executeTakeFirst();
    if (!currency || currency.decimalPlaces === null) {
      throw new Error("Payment currency decimal places are not configured");
    }
    const decimals = currency.decimalPlaces;
    assertCurrencyDecimals(decimals);
    if (
      company.baseCurrencyCode === payment.currencyCode &&
      Number(payment.exchangeRate) !== 1
    )
      throw new Error("Base-currency payment must use exchange rate 1");

    const drafts = await trx
      .selectFrom("invoiceSettlement")
      .selectAll()
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("paymentId", "=", paymentId),
          eb("appliedViaPaymentId", "=", paymentId)
        ])
      )
      .orderBy("id")
      .execute();
    const targetColumn = kind.targetColumn;
    for (const draft of drafts) {
      if (
        !draft[targetColumn] ||
        (isReimbursement
          ? // A reimbursement payout carries no other target, no memo/prior-
            // credit funding source (an employee has neither), and no trade
            // discount or write-off.
            draft.targetSalesInvoiceId ||
            draft.targetPurchaseInvoiceId ||
            draft.targetMemoId ||
            draft.memoId ||
            draft.sourcePaymentId ||
            Number(draft.discountAmount) !== 0 ||
            Number(draft.writeOffAmount) !== 0
          : isRefund
            ? draft.targetSalesInvoiceId ||
              draft.targetPurchaseInvoiceId ||
              draft.targetReimbursementId ||
              draft.memoId ||
              draft.sourcePaymentId ||
              Number(draft.discountAmount) !== 0 ||
              Number(draft.writeOffAmount) !== 0
            : draft.targetMemoId ||
              draft.targetReimbursementId ||
              (isAR
                ? draft.targetPurchaseInvoiceId
                : draft.targetSalesInvoiceId))
      )
        throw new Error("Unsupported payment settlement target");
    }
    const targetIds = [
      ...new Set(drafts.map((draft) => draft[targetColumn]!))
    ].sort();
    const memoIds = [
      ...new Set(
        drafts.flatMap((draft) => (draft.memoId ? [draft.memoId] : []))
      )
    ].sort();
    const refundMemos =
      isRefund && targetIds.length
        ? await trx
            .selectFrom("memo")
            .selectAll()
            .where("companyId", "=", companyId)
            .where("id", "in", targetIds)
            .orderBy("id")
            .forUpdate()
            .execute()
        : [];
    // `payableAccountId` is stamped onto the row when the reimbursement posts,
    // so the payout debits the account the liability was actually booked to —
    // never today's `accountDefault`, which may have changed since.
    const reimbursements =
      isReimbursement && targetIds.length
        ? await trx
            .selectFrom("reimbursement")
            .select([
              "id",
              "employeeId as partyId",
              "status",
              "currencyCode",
              "exchangeRate",
              "amount",
              "payableAccountId"
            ])
            .where("companyId", "=", companyId)
            .where("id", "in", targetIds)
            .orderBy("id")
            .forUpdate()
            .execute()
        : [];
    const invoices = isReimbursement
      ? reimbursements
      : isRefund
        ? refundMemos.map((memo) => ({
            ...memo,
            partyId: isAR ? memo.customerId : memo.supplierId
          }))
        : targetIds.length
          ? await (isAR
              ? trx
                  .selectFrom("salesInvoice")
                  .select([
                    "id",
                    "customerId as partyId",
                    "status",
                    "currencyCode",
                    "exchangeRate"
                  ])
                  .where("companyId", "=", companyId)
                  .where("id", "in", targetIds)
                  .orderBy("id")
                  .forUpdate()
                  .execute()
              : trx
                  .selectFrom("purchaseInvoice")
                  .select([
                    "id",
                    "supplierId as partyId",
                    "status",
                    "currencyCode",
                    "exchangeRate"
                  ])
                  .where("companyId", "=", companyId)
                  .where("id", "in", targetIds)
                  .orderBy("id")
                  .forUpdate()
                  .execute())
          : [];
    const totals = isReimbursement
      ? reimbursements.map((reimbursement) => ({
          id: reimbursement.id,
          totalAmount: toBaseAmount(
            Number(reimbursement.amount),
            Number(reimbursement.exchangeRate)
          )
        }))
      : isRefund
        ? refundMemos.map((memo) => ({
            id: memo.id,
            totalAmount: toBaseAmount(
              Number(memo.amount),
              Number(memo.exchangeRate)
            )
          }))
        : targetIds.length
          ? await (isAR
              ? trx
                  .selectFrom("salesInvoices")
                  .select(["id", "totalAmount"])
                  .where("companyId", "=", companyId)
                  .where("id", "in", targetIds)
                  .execute()
              : trx
                  .selectFrom("purchaseInvoices")
                  .select(["id", "totalAmount"])
                  .where("companyId", "=", companyId)
                  .where("id", "in", targetIds)
                  .execute())
          : [];
    if (
      invoices.length !== targetIds.length ||
      totals.length !== targetIds.length
    )
      throw new NotFoundError(
        "Payment target invoice not found in this company"
      );
    const totalById = new Map(
      totals.map((row) => [row.id, Number(row.totalAmount)])
    );
    const priorTargetRows = targetIds.length
      ? (
          await settlementQuery(trx, companyId)
            .where((eb) =>
              isRefund
                ? eb.or([
                    eb("s.targetMemoId", "in", targetIds),
                    eb("s.memoId", "in", targetIds)
                  ])
                : eb(`s.${targetColumn}`, "in", targetIds)
            )
            .execute()
        ).filter(isEffectiveSettlement)
      : [];
    const targetControls = foldTargetControls(
      kind,
      await readTargetControlLines(trx, companyId, targetIds)
    );
    const { carryingById, controlById: targetControlById } = targetControls;
    // The reimbursement row's `payableAccountId` is checked AGAINST the booked
    // journal, never used in place of it. The map is seeded by the journal read
    // above and by nothing else — exactly as the AR/AP arms are — so the
    // missing-control guard in the targets loop below can still bite: seeding
    // it from the ROW made that guard unreachable for a reimbursement, and a
    // reimbursement POSTED with accounting disabled (no journal, so its
    // employee payable was never credited) then had its payout DEBIT that
    // liability once accounting was turned on.
    //
    // The row is still what stops the payout re-resolving the account from
    // today's `accountDefault`: a value that disagrees with the ledger means the
    // two have diverged, which must not post silently.
    for (const reimbursement of reimbursements) {
      // A Draft reimbursement has no stored payable yet — it is refused by the
      // status check in the targets loop below, which says so far more usefully
      // than "missing control account" would.
      if (reimbursement.status !== "Posted") continue;
      if (!reimbursement.payableAccountId) {
        throw new Error(
          "Reimbursement is missing its employee-payable control account"
        );
      }
      const booked = targetControlById.get(reimbursement.id);
      if (booked && booked !== reimbursement.payableAccountId) {
        throw new Error(
          "Reimbursement control account disagrees with its posted journal"
        );
      }
    }
    const targets = new Map<
      string,
      { rate: number; remainingDocument: number; remainingBase: number }
    >();
    for (const invoice of invoices) {
      if (
        invoice.partyId !== partyId ||
        invoice.currencyCode !== payment.currencyCode
      )
        throw new Error("Invoice party/currency does not match payment");
      if (
        invoice.status !==
        (isReimbursement
          ? "Posted"
          : isRefund
            ? "Posted"
            : isAR
              ? "Submitted"
              : "Open")
      ) {
        throw new Error(
          `Cannot settle invoice ${invoice.id} in status ${invoice.status}`
        );
      }
      const rate = Number(invoice.exchangeRate);
      const total = totalById.get(invoice.id)!;
      const refundMemo = refundMemos.find((memo) => memo.id === invoice.id);
      if (refundMemo && refundMemo.direction !== (isAR ? "Credit" : "Debit")) {
        throw new Error("Refund target must be a balance-reducing memo");
      }
      const used = priorTargetRows.filter(
        (row) => row.memoId === invoice.id || row.targetMemoId === invoice.id
      );
      const { remainingDocument, remainingBase } = isRefund
        ? {
            remainingDocument: toDocumentAmount(
              Number(refundMemo!.amount) -
                used.reduce(
                  (sum, row) => sum + principal(row.sourceAmount, row.id),
                  0
                ),
              1,
              decimals
            ),
            remainingBase: round(
              -(carryingById.get(invoice.id) ?? -total) -
                used.reduce((sum, row) => sum + Number(row.appliedAmount), 0)
            )
          }
        : invoiceRemainingAmounts(
            { ...invoice, totalAmount: total },
            priorTargetRows,
            carryingById,
            decimals,
            isAR,
            isReimbursement
          );
      if (remainingDocument < 0 || remainingBase < 0) {
        throw new Error("Target memo is over-applied");
      }
      // Before the cutover an invoice posted with no journal has no control
      // line; the payment then books the default control account.
      if (postingStatus === "Posted" && !targetControlById.has(invoice.id)) {
        throw new Error("Target is missing its original control account");
      }
      targets.set(invoice.id, { rate, remainingDocument, remainingBase });
    }

    const memos = memoIds.length
      ? await trx
          .selectFrom("memo")
          .selectAll()
          .where("companyId", "=", companyId)
          .where("id", "in", memoIds)
          .orderBy("id")
          .forUpdate()
          .execute()
      : [];
    if (memos.length !== memoIds.length) {
      throw new NotFoundError("Staged memo not found in this company");
    }
    const memoConsumption = memoIds.length
      ? (
          await settlementQuery(trx, companyId)
            .where((eb) =>
              eb.or([
                eb("s.memoId", "in", memoIds),
                eb("s.targetMemoId", "in", memoIds)
              ])
            )
            .execute()
        ).filter(isEffectiveSettlement)
      : [];
    const memoRemaining = new Map(
      memos.map((memo) => {
        if (
          memo.status !== "Posted" ||
          memo.currencyCode !== payment.currencyCode ||
          (isAR ? memo.customerId : memo.supplierId) !== partyId ||
          memo.direction !== (isAR ? "Credit" : "Debit")
        ) {
          throw new Error(
            "Staged memo must be posted with matching party, currency and direction"
          );
        }
        assertExchangeRate(Number(memo.exchangeRate));
        return [
          memo.id,
          {
            memo,
            document: toDocumentAmount(
              Number(memo.amount) -
                memoConsumption
                  .filter(
                    (row) =>
                      row.memoId === memo.id || row.targetMemoId === memo.id
                  )
                  .reduce(
                    (sum, row) => sum + principal(row.sourceAmount, row.id),
                    0
                  ),
              1,
              decimals
            )
          }
        ] as [string, { memo: typeof memo; document: number }];
      })
    );
    const normalizedMemos: Array<{
      id: string;
      appliedAmount: number;
      sourceAmount: number;
      sourceExchangeRate: number;
      targetExchangeRate: number;
    }> = [];
    for (const draft of drafts.filter((row) => row.memoId !== null)) {
      if (
        draft.paymentId ||
        draft.sourcePaymentId ||
        Number(draft.discountAmount) !== 0 ||
        Number(draft.writeOffAmount) !== 0
      ) {
        throw new Error(
          "Memo applications cannot carry payment funding, discounts or write-offs"
        );
      }
      const target = targets.get(draft[targetColumn]!)!;
      const source = memoRemaining.get(draft.memoId!)!;
      if (Number(source.memo.exchangeRate) !== target.rate) {
        throw new Error("Memo and invoice exchange-rate snapshots must match");
      }
      const sourceAmount =
        draft.sourceAmount === null
          ? toDocumentAmount(Number(draft.appliedAmount), target.rate, decimals)
          : principal(draft.sourceAmount, draft.id);
      if (
        toDocumentAmount(sourceAmount, 1, decimals) !== sourceAmount ||
        sourceAmount > source.document ||
        sourceAmount > target.remainingDocument
      )
        throw new Error("Staged memo principal exceeds remaining balance");
      const appliedAmount =
        sourceAmount === target.remainingDocument
          ? target.remainingBase
          : toBaseAmount(sourceAmount, target.rate);
      if (appliedAmount > target.remainingBase) {
        throw new Error("Staged memo exceeds target carrying balance");
      }
      source.document = toDocumentAmount(
        source.document - sourceAmount,
        1,
        decimals
      );
      target.remainingDocument = toDocumentAmount(
        target.remainingDocument - sourceAmount,
        1,
        decimals
      );
      target.remainingBase = round(target.remainingBase - appliedAmount);
      normalizedMemos.push({
        id: draft.id,
        appliedAmount,
        sourceAmount,
        sourceExchangeRate: target.rate,
        targetExchangeRate: target.rate
      });
    }

    // An employee holds no on-account credit: a reimbursement payout is always
    // funded by the current disbursement, never by a prior overpayment.
    const sources =
      isRefund || isReimbursement
        ? []
        : await trx
            .selectFrom("payment")
            .selectAll()
            .where("companyId", "=", companyId)
            .where("status", "=", "Posted")
            .where("paymentType", "=", isAR ? "Receipt" : "Disbursement")
            .where(isAR ? "customerId" : "supplierId", "=", partyId)
            .where("currencyCode", "=", payment.currencyCode)
            .where("id", "!=", paymentId)
            .orderBy("id")
            .forUpdate()
            .execute();
    const sourceIds = sources.map((source) => source.id);
    const sourceControls = foldSourceControls(
      kind,
      await readSourceControlLines(trx, companyId, sourceIds)
    );
    const consumed = sourceIds.length
      ? (
          await settlementQuery(trx, companyId)
            .where((eb) =>
              eb.or([
                eb("s.sourcePaymentId", "in", sourceIds),
                eb.and([
                  eb("s.sourcePaymentId", "is", null),
                  eb("s.paymentId", "in", sourceIds)
                ])
              ])
            )
            .execute()
        ).filter(isEffectiveSettlement)
      : [];
    // A customer deposit funds only invoices of its own rental agreement or
    // sales order, and a deposit payment applies to nothing else — re-derived
    // here so a crafted Draft cannot spend one document's deposit on another.
    const priorSources = remainingFundingSources(
      sources.map((source) => ({
        ...source,
        scope: isAR ? fundingScopeOf(source) : null
      })),
      consumed,
      new Map([[payment.currencyCode, decimals]]),
      isAR
    );
    const currentScope =
      isAR && !isRefund && !isReimbursement
        ? await loadDepositScope(trx, companyId, payment)
        : null;
    const invoiceDocuments =
      isAR &&
      !isRefund &&
      !isReimbursement &&
      (currentScope || priorSources.some((source) => source.scope))
        ? await loadSalesInvoiceDocumentIds(trx, companyId, targetIds)
        : new Map<string, InvoiceDocumentIds>();
    const requestByTarget = new Map<string, FundingRequest>();
    for (const draft of drafts.filter((row) => row.paymentId === paymentId)) {
      const targetId = draft[targetColumn]!;
      const target = targets.get(targetId)!;
      const requested =
        draft.sourceAmount === null
          ? Number(draft.appliedAmount) === target.remainingBase &&
            Number(draft.discountAmount) === 0 &&
            Number(draft.writeOffAmount) === 0
            ? target.remainingDocument
            : toDocumentAmount(
                Number(draft.appliedAmount),
                target.rate,
                decimals
              )
          : principal(draft.sourceAmount, draft.id);
      if (toDocumentAmount(requested, 1, decimals) !== requested) {
        throw new Error(
          "Requested principal exceeds document currency precision"
        );
      }
      const request = requestByTarget.get(targetId) ?? {
        targetId,
        targetExchangeRate: target.rate,
        remainingDocument: target.remainingDocument,
        remainingBase: target.remainingBase,
        requestedDocumentPrincipal: 0,
        discountAmount: 0,
        writeOffAmount: 0,
        ...invoiceDocuments.get(targetId)
      };
      request.requestedDocumentPrincipal = toDocumentAmount(
        request.requestedDocumentPrincipal + requested,
        1,
        decimals
      );
      request.discountAmount = round(
        request.discountAmount + Number(draft.discountAmount)
      );
      request.writeOffAmount = round(
        request.writeOffAmount + Number(draft.writeOffAmount)
      );
      requestByTarget.set(targetId, request);
    }
    const allocation = allocatePaymentFunding({
      currentPayment: {
        paymentId,
        postingDate: today,
        exchangeRate: Number(payment.exchangeRate),
        remainingDocument: Number(payment.totalAmount),
        remainingBase: toBaseAmount(
          Number(payment.totalAmount),
          Number(payment.exchangeRate)
        ),
        scope: currentScope
      },
      priorSources,
      requests: [...requestByTarget.values()].sort((a, b) =>
        a.targetId.localeCompare(b.targetId)
      ),
      currencyDecimals: decimals,
      isAR: cashIn
    });

    const defaults = await trx
      .selectFrom("accountDefault")
      .selectAll()
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!defaults) {
      throw new Error("Accounting defaults are required before posting");
    }
    const party = (await readPaymentParties(trx, companyId, [kind]))(kind);
    const normalized = allocation.applications.map((application) => ({
      ...application,
      targetSalesInvoiceId:
        !isRefund && !isReimbursement && isAR ? application.targetId : null,
      targetPurchaseInvoiceId:
        !isRefund && !isReimbursement && !isAR ? application.targetId : null,
      targetMemoId: isRefund && !isReimbursement ? application.targetId : null,
      targetReimbursementId: isReimbursement ? application.targetId : null
    }));
    const assembled = assemblePaymentJournal({
      payment,
      kind,
      companyId,
      defaults,
      control: paymentControlAccount(kind, party, defaults, postingStatus),
      discountClasses: await readDiscountAccountClasses(
        trx,
        company.companyGroupId,
        defaults
      ),
      targets: targetControls,
      sources: sourceControls,
      applications: normalized,
      newOnAccountBase: allocation.sourceRemainders[0]!.remainingBase,
      fee,
      journalLineReference: nanoid()
    });
    const { accounts } = assembled.input;
    const journalLines = assembled.lines;
    const expectedAccountClasses: Array<[string | null | undefined, string]> = [
      [payment.bankAccount, "Asset"],
      [accounts.controlAccountId, isAR ? "Asset" : "Liability"],
      [accounts.discountAccountId, isAR ? "Revenue" : "Expense"],
      [accounts.writeOffAccountId, isAR ? "Expense" : "Revenue"],
      [accounts.fxGainAccountId, "Revenue"],
      [accounts.fxLossAccountId, "Expense"],
      [fee?.accountId, "Expense"]
    ];
    if (isDeposit && isAR) {
      expectedAccountClasses.push([defaults.prepaymentAccount, "Liability"]);
    }
    for (const application of assembled.input.applications) {
      expectedAccountClasses.push(
        [application.targetControlAccountId, isAR ? "Asset" : "Liability"],
        [
          application.sourceControlAccountId,
          application.sourceIsDeposit
            ? "Liability"
            : isAR
              ? "Asset"
              : "Liability"
        ]
      );
    }
    const accountIds = [
      ...new Set([
        payment.bankAccount,
        ...journalLines.map((line) => line.accountId)
      ])
    ];
    const postingAccounts = await trx
      .selectFrom("account")
      .select(["id", "class"])
      .where("id", "in", accountIds)
      .where("companyGroupId", "=", company.companyGroupId)
      .where("active", "=", true)
      .where("isGroup", "=", false)
      .execute();
    if (
      postingAccounts.length !== accountIds.length ||
      postingAccounts.find((account) => account.id === payment.bankAccount)
        ?.class !== "Asset"
    ) {
      throw new Error(
        "Payment accounts must be active posting accounts in this company group, with an Asset bank account"
      );
    }
    const classById = new Map(
      postingAccounts.map((account) => [account.id, account.class])
    );
    // A stand-in account is not the account its role wants, so its class is
    // not checked; the enable re-points it to the default.
    const standInAccounts = new Set(
      journalLines.flatMap((line) =>
        line.accountDefaultRole ? [line.accountId] : []
      )
    );
    if (
      expectedAccountClasses.some(
        ([id, expected]) =>
          id &&
          !standInAccounts.has(id) &&
          classById.has(id) &&
          classById.get(id) !== expected
      )
    ) {
      throw new Error("Payment account class does not match its posting role");
    }
    // Replace current-cash/prior-credit splits only after all authoritative
    // validation. The entire replacement, journal and status share this transaction.
    await trx
      .deleteFrom("invoiceSettlement")
      .where("paymentId", "=", paymentId)
      .where("companyId", "=", companyId)
      .execute();
    if (normalized.length) {
      await trx
        .insertInto("invoiceSettlement")
        .values(
          normalized.map(({ targetId: _, ...application }) => ({
            ...application,
            paymentId,
            companyId,
            appliedDate: today,
            createdBy: userId
          }))
        )
        .execute();
    }
    // One set-based UPDATE preserves memo row identities and avoids query-per-row writes.
    if (normalizedMemos.length) {
      await sql`UPDATE "invoiceSettlement" s SET "appliedAmount"=v."appliedAmount", "sourceAmount"=v."sourceAmount",
        "sourceExchangeRate"=v."sourceExchangeRate", "targetExchangeRate"=v."targetExchangeRate", "fxGainLossAmount"=0, "appliedDate"=${today}::date, "updatedBy"=${userId}
        FROM jsonb_to_recordset(${JSON.stringify(
          normalizedMemos
        )}::jsonb) AS v(id text,"appliedAmount" numeric,"sourceAmount" numeric,"sourceExchangeRate" numeric,"targetExchangeRate" numeric)
        WHERE s.id=v.id AND s."companyId"=${companyId} AND s."appliedViaPaymentId"=${paymentId}`.execute(
        trx
      );
    }
    const journal = await trx
      .insertInto("journal")
      .values({
        journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
        accountingPeriodId,
        description: `Payment ${payment.paymentId}`,
        postingDate: today,
        companyId,
        sourceType: "Payment",
        status: postingStatus,
        postedAt: timestamp,
        postedBy: userId,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const journalId = journal.id;
    if (journalLines.length) {
      const lines = await trx
        .insertInto("journalLine")
        .values(
          journalLines.map((line) => ({
            ...line,
            journalId: journal.id
          }))
        )
        .returning("id")
        .execute();
      // A reimbursement payout has no trade party to tag, and the document's
      // own journal (post-reimbursement) writes no party dimension either —
      // so the two stay symmetric rather than the payout carrying a
      // dimension the liability it clears never had.
      const dimensions = isReimbursement
        ? []
        : paymentDimensions(
            await loadPartyDimensions(trx, company.companyGroupId),
            kind,
            party
          );
      const values = dimensions.flatMap((dimension) =>
        lines.map((line) => ({
          journalLineId: line.id,
          ...dimension,
          companyId
        }))
      );
      if (values.length) {
        await trx.insertInto("journalLineDimension").values(values).execute();
      }
    }
    await trx
      .updateTable("payment")
      .set({
        status: "Posted",
        postingDate: today,
        journalId,
        postedAt: timestamp,
        postedBy: userId,
        updatedAt: timestamp,
        updatedBy: userId
      })
      .where("id", "=", paymentId)
      .where("companyId", "=", companyId)
      .execute();
    return { journalId };
  });
}
/** A payment's journal built again: its lines, each with the stand-in role
 *  its posting gives it, and the party dimensions every line carries. */
export type RebuiltPaymentJournal = {
  lines: PaymentJournalLineWithRole[];
  dimensions: { dimensionId: string; valueId: string }[];
};

/**
 * What the funding allocation left of the current cash, from the stored
 * settlements. `allocatePaymentFunding` starts the current payment at its
 * gross base and draws down, per application it funds, the carrying value
 * the application released (`sourceBaseAmount`), rounding at each step. The
 * settlement stores that value as its applied amount and realized FX:
 * `calculateSettlementFx` is `sourceBase − applied` for cash in and
 * `applied − sourceBase` for cash out. So this is the number the posting
 * passed as `newOnAccountBase`.
 */
export function storedOnAccountRemainder(
  payment: Pick<PaymentRow, "totalAmount" | "exchangeRate">,
  applications: PaymentApplication[],
  cashIn: boolean
): number {
  let remaining = toBaseAmount(
    Number(payment.totalAmount),
    Number(payment.exchangeRate)
  );
  for (const application of applications) {
    if (application.sourcePaymentId) continue;
    const released = round(
      application.appliedAmount +
        (cashIn ? application.fxGainLossAmount : -application.fxGainLossAmount)
    );
    remaining = round(remaining - released);
  }
  return remaining;
}

/**
 * The journals of many payments of one company, built again in a fixed
 * number of reads.
 *
 * - `postingStatus` is the status the journal posts with. It decides the
 *   control account as the posting does (`paymentControlAccount`).
 * - `feeByPaymentId` is the processor fee each payment withheld
 *   (`readPaymentProcessorFees`).
 * - A target or funding source books to the control account of its line in
 *   a Provisional or Posted journal (the opening journal for a document open
 *   at the cutover), else to the control account, as the posting does.
 * - Payments are built in the order given. A payment that an earlier one in
 *   the list funds from on-account credit books that credit to the control
 *   account the earlier one was just built with, as its posting read it from
 *   the earlier payment's journal.
 */
export async function rebuildPaymentJournals(
  trx: Trx,
  payments: PaymentRow[],
  companyId: string,
  options: {
    postingStatus: AutomaticJournalStatus;
    feeByPaymentId: Map<string, PaymentJournalFeeInput>;
  }
): Promise<RebuiltPaymentJournal[]> {
  if (payments.length === 0) return [];
  const { postingStatus, feeByPaymentId } = options;
  const kinds = payments.map(paymentKind);
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  if (!company.companyGroupId) {
    throw new Error("Payment currency configuration is missing");
  }
  const companyGroupId = company.companyGroupId;
  const defaults = await trx
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) {
    throw new Error("Accounting defaults are required before posting");
  }
  const partyOf = await readPaymentParties(trx, companyId, kinds);
  const discountClasses = await readDiscountAccountClasses(
    trx,
    companyGroupId,
    defaults
  );

  const settlements = await trx
    .selectFrom("invoiceSettlement")
    .selectAll()
    .where("companyId", "=", companyId)
    .where(
      "paymentId",
      "in",
      payments.map((payment) => payment.id)
    )
    .orderBy("id")
    .execute();
  const settlementsByPayment = new Map<string, typeof settlements>();
  for (const row of settlements) {
    const list = settlementsByPayment.get(row.paymentId!) ?? [];
    list.push(row);
    settlementsByPayment.set(row.paymentId!, list);
  }

  const targetIds = [
    ...new Set(
      payments.flatMap((payment, index) =>
        (settlementsByPayment.get(payment.id) ?? []).flatMap((row) => {
          const target = row[kinds[index]!.targetColumn];
          return target ? [target] : [];
        })
      )
    )
  ];
  const sourceIds = [
    ...new Set(
      settlements.flatMap((row) =>
        row.sourcePaymentId ? [row.sourcePaymentId] : []
      )
    )
  ];
  const [targetLines, sourceLines] = await Promise.all([
    readTargetControlLines(trx, companyId, targetIds),
    readSourceControlLines(trx, companyId, sourceIds)
  ]);
  // The on-account and deposit lines of the payments built here, for the
  // later payments they fund.
  const builtSourceLines: SourceControlLine[] = [];

  const dimensions = kinds.some((kind) => !kind.isReimbursement)
    ? await loadPartyDimensions(trx, companyGroupId)
    : [];

  return payments.map((payment, index) => {
    const kind = kinds[index]!;
    const party = partyOf(kind);
    const rows = settlementsByPayment.get(payment.id) ?? [];
    const ownTargets = new Set(rows.map((row) => row[kind.targetColumn]));
    const ownSources = new Set(rows.map((row) => row.sourcePaymentId));
    const applications: PaymentApplication[] = rows.map((row) => ({
      targetSalesInvoiceId: row.targetSalesInvoiceId,
      targetPurchaseInvoiceId: row.targetPurchaseInvoiceId,
      targetMemoId: row.targetMemoId,
      targetReimbursementId: row.targetReimbursementId,
      sourcePaymentId: row.sourcePaymentId,
      sourceAmount: principal(row.sourceAmount, row.id),
      sourceExchangeRate: Number(row.sourceExchangeRate),
      targetExchangeRate: Number(row.targetExchangeRate),
      appliedAmount: Number(row.appliedAmount),
      discountAmount: Number(row.discountAmount),
      writeOffAmount: Number(row.writeOffAmount),
      fxGainLossAmount: Number(row.fxGainLossAmount)
    }));

    const { lines } = assemblePaymentJournal({
      payment,
      kind,
      companyId,
      defaults,
      control: paymentControlAccount(kind, party, defaults, postingStatus),
      discountClasses,
      targets: foldTargetControls(
        kind,
        targetLines.filter((line) => ownTargets.has(line.documentId))
      ),
      sources: foldSourceControls(
        kind,
        [...sourceLines, ...builtSourceLines].filter((line) =>
          ownSources.has(line.documentId)
        )
      ),
      applications,
      newOnAccountBase: storedOnAccountRemainder(
        payment,
        applications,
        kind.cashIn
      ),
      fee: feeByPaymentId.get(payment.id),
      journalLineReference: nanoid()
    });
    assertNoMigrationClearing(lines, defaults.migrationClearingAccount);

    for (const line of lines) {
      if (kind.sourceDescriptions.includes(line.description)) {
        builtSourceLines.push({
          documentId: payment.id,
          accountId: line.accountId,
          description: line.description,
          accountDefaultRole: line.accountDefaultRole
        });
      }
    }

    return {
      lines,
      dimensions: paymentDimensions(dimensions, kind, party)
    };
  });
}

/**
 * The journal of a payment dated before the cutover, built again for its
 * void. The processor fee comes from the payment's integration mapping
 * (`readPaymentProcessorFees`); a payment with no mapping row has its fee
 * read off its own journal (`postedProcessorFee`).
 */
export async function rebuildPaymentJournal(
  trx: Trx,
  payment: PaymentRow,
  companyId: string,
  postingStatus: AutomaticJournalStatus
): Promise<RebuiltPaymentJournal> {
  const { fees, mapped } = await readPaymentProcessorFees(trx, companyId, [
    payment
  ]);
  const fee =
    fees.get(payment.id) ??
    (mapped.has(payment.id)
      ? undefined
      : await postedProcessorFee(trx, payment, companyId));
  const [rebuilt] = await rebuildPaymentJournals(trx, [payment], companyId, {
    postingStatus,
    feeByPaymentId: new Map(fee ? [[payment.id, fee]] : [])
  });
  return rebuilt!;
}

/** Every description `buildPaymentJournal` writes, except the processor fee's. */
const PAYMENT_BUILDER_DESCRIPTIONS = new Set([
  "Bank / Cash",
  "Accounts Receivable",
  "Accounts Payable",
  "Employee Reimbursements Payable",
  "Customer Payment Discount",
  "Supplier Payment Discount",
  "Bad Debt Expense",
  "Vendor Write-Off Income",
  "Accounts Receivable (credit applied)",
  "Accounts Payable (credit applied)",
  "Realized FX Gain",
  "Realized FX Loss",
  onAccountCreditDescription(true),
  onAccountCreditDescription(false),
  CUSTOMER_DEPOSIT_DESCRIPTION,
  CUSTOMER_DEPOSIT_APPLIED_DESCRIPTION
]);

/**
 * The processor fee of a payment with no integration mapping, read off the
 * payment's own journal: the bank line is short of the gross cash by the
 * fee, and the fee line is the one line the builder does not describe. A
 * payment with no journal has no fee here.
 */
async function postedProcessorFee(
  trx: Trx,
  payment: PaymentRow,
  companyId: string
): Promise<PaymentJournalFeeInput | undefined> {
  if (!payment.journalId) return undefined;
  const grossBase = toBaseAmount(
    Number(payment.totalAmount),
    Number(payment.exchangeRate)
  );
  const lines = await trx
    .selectFrom("journalLine")
    .select(["accountId", "amount", "description"])
    .where("companyId", "=", companyId)
    .where("journalId", "=", payment.journalId)
    .where("documentType", "=", "Payment")
    .where("documentId", "=", payment.id)
    .execute();
  const bank = lines.find((line) => line.description === "Bank / Cash");
  if (!bank) return undefined;
  const feeBase = round(grossBase - Math.abs(Number(bank.amount)));
  if (Math.abs(feeBase) <= EPSILON) return undefined;
  const fees = lines.filter(
    (line) => !PAYMENT_BUILDER_DESCRIPTIONS.has(line.description ?? "")
  );
  if (
    fees.length !== 1 ||
    !fees[0]!.accountId ||
    !equals(Math.abs(Number(fees[0]!.amount)), feeBase)
  ) {
    throw new Error(
      "The payment's processor fee cannot be read from its journal"
    );
  }
  return {
    // The builder converts the fee at the payment's rate; this is its inverse.
    amount: round(feeBase * Number(payment.exchangeRate)),
    accountId: fees[0]!.accountId,
    description: fees[0]!.description ?? undefined
  };
}
export const postPaymentInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  paymentId: z.string(),
  // A fee withheld by a payment processor before the cash reached the bank
  // (e.g. Stripe Connect's per-charge commission). The caller resolves the
  // account (an integration override or the company's service-charge
  // default) — this operation stays payment-processor-agnostic.
  fee: z
    .object({
      amount: z.number().positive(),
      accountId: z.string(),
      description: z.string().optional()
    })
    .optional()
});

export const postPaymentPermission = {
  update: "invoicing"
} satisfies PermissionRule<z.output<typeof postPaymentInput>>;

/** Posts or voids a payment: settlements, funding and its journal, atomically. */
export async function postPayment(
  ctx: ServiceContext,
  raw: z.input<typeof postPaymentInput>
) {
  const { type, paymentId, fee } = postPaymentInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();

  const result = await postPaymentTransaction(db, {
    type,
    paymentId,
    companyId,
    userId,
    today,
    fee
  });
  return { success: true, ...result };
}
type Enums = Database["public"]["Enums"];

export type LeaseStatus = Enums["leaseStatus"];

export type LeaseAccount = { id: string; name: string; class: AccountClass };

type LeaseAccountRole = "liability" | "operating" | "variable";

/** A payment row, with what posting reads of its asset (`leaseLine`). */
export type LeasePostingPayment = {
  leaseId: string;
  amount: number;
  /** The invoice line that bills the row; null while it is Pending. */
  purchaseInvoiceLineId: string | null;
  /** The asset's description. */
  description: string;
  /** Null until the lease is activated. */
  lesseeClassification: Enums["lesseeClassification"] | null;
};

export type LeasePostingFacts = {
  leases: Map<string, { status: LeaseStatus }>;
  payments: Map<string, LeasePostingPayment>;
  accounts: Map<LeaseAccountRole, LeaseAccount>;
};

export type LeaseAccountDefaults = Pick<
  Tables["accountDefault"]["Row"],
  | "leaseLiabilityAccount"
  | "operatingLeaseExpenseAccount"
  | "variableLeaseExpenseAccount"
>;

export type LeaseInvoiceLine = Pick<
  Tables["purchaseInvoiceLine"]["Row"],
  "id" | "leaseId" | "leasePaymentId" | "projectId"
>;

/** Kept under Postgres' bind-parameter limit for a long legacy backfill. */
const IDS_PER_STATEMENT = 1000;

function unique(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** Reads the leases, payment rows and lease accounts the lines name. */
export async function loadLeasePostingFacts(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    companyGroupId: string;
    defaults: LeaseAccountDefaults;
    lines: Pick<LeaseInvoiceLine, "leaseId" | "leasePaymentId">[];
  }
): Promise<LeasePostingFacts> {
  const { companyId, companyGroupId, defaults, lines } = args;
  const facts: LeasePostingFacts = {
    leases: new Map(),
    payments: new Map(),
    accounts: new Map()
  };
  if (lines.length === 0) return facts;

  for (const ids of chunkArray(
    unique(lines.map((line) => line.leaseId)),
    IDS_PER_STATEMENT
  )) {
    const leases = await db
      .selectFrom("lease")
      .select(["id", "status"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute();
    for (const lease of leases) {
      facts.leases.set(lease.id, { status: lease.status });
    }
  }

  for (const ids of chunkArray(
    unique(lines.map((line) => line.leasePaymentId)),
    IDS_PER_STATEMENT
  )) {
    const payments = await db
      .selectFrom("leasePayment as p")
      .innerJoin("leaseLine as l", (join) =>
        join
          .onRef("l.id", "=", "p.leaseLineId")
          .onRef("l.companyId", "=", "p.companyId")
      )
      .select([
        "p.id",
        "p.leaseId",
        "p.amount",
        "p.purchaseInvoiceLineId",
        "l.description",
        "l.lesseeClassification"
      ])
      .where("p.companyId", "=", companyId)
      .where("p.id", "in", ids)
      .execute();
    for (const { id, ...payment } of payments) {
      facts.payments.set(id, { ...payment, amount: Number(payment.amount) });
    }
  }

  const roles: [LeaseAccountRole, string | null][] = [
    ["liability", defaults.leaseLiabilityAccount],
    ["operating", defaults.operatingLeaseExpenseAccount],
    ["variable", defaults.variableLeaseExpenseAccount]
  ];
  const accountIds = unique(roles.map(([, id]) => id));
  const accounts =
    accountIds.length > 0
      ? await db
          .selectFrom("account")
          .select(["id", "name", "class"])
          .where("companyGroupId", "=", companyGroupId)
          .where("id", "in", accountIds)
          .execute()
      : [];
  for (const [role, id] of roles) {
    const account = accounts.find((row) => row.id === id);
    if (account?.class) {
      facts.accounts.set(role, {
        id: account.id,
        name: account.name,
        class: account.class
      });
    }
  }
  return facts;
}

const MISSING_ACCOUNTS =
  "Set the lease (lessee) accounts in Accounting → Default Accounts";

/**
 * The accounts a Lease line debits, or an `InvalidInputError` when it cannot
 * be posted: no lease, a Draft or Cancelled lease, a project, a payment row of
 * another lease or billed by another invoice line, a lease not yet activated,
 * a capitalized payment whose amount differs from its row's, or a lease
 * account left unset.
 *
 * `account` takes the nominal amount; `extrasAccount`, set for a capitalized
 * payment only, takes the rest of the line's total (tax, shipping, freight).
 */
export function resolveLeasePostingLine(
  line: LeaseInvoiceLine,
  amounts: Pick<PurchasePostingAmounts, "nominalBaseCost" | "totalBaseCost">,
  facts: LeasePostingFacts
): {
  leaseId: string;
  account: LeaseAccount;
  extrasAccount: LeaseAccount | null;
} {
  const lease = line.leaseId ? facts.leases.get(line.leaseId) : undefined;
  if (!line.leaseId || !lease) {
    throw new InvalidInputError(
      `Lease invoice line ${line.id} has no lease selected`
    );
  }
  if (lease.status === "Draft") {
    throw new InvalidInputError("Activate the lease before invoicing it");
  }
  if (!isBillableLeaseStatus(lease.status)) {
    throw new InvalidInputError(
      "The lease is cancelled; remove its line from this invoice"
    );
  }
  if (line.projectId) {
    throw new InvalidInputError("A lease line cannot be charged to a project");
  }

  const payment = line.leasePaymentId
    ? facts.payments.get(line.leasePaymentId)
    : undefined;
  if (line.leasePaymentId && (!payment || payment.leaseId !== line.leaseId)) {
    throw new InvalidInputError(
      `Lease invoice line ${line.id} names a payment of another lease`
    );
  }
  // The row is billed by the line its drafting stamped on it. Another line
  // naming it would settle the same payment twice.
  if (payment && payment.purchaseInvoiceLineId !== line.id) {
    throw new InvalidInputError(
      `The ${payment.description} payment is billed by another invoice line; remove this line from the invoice`
    );
  }
  if (payment && !payment.lesseeClassification) {
    throw new InvalidInputError("Activate the lease before invoicing it");
  }

  const role: LeaseAccountRole = !payment
    ? "variable"
    : payment.lesseeClassification === "Short-Term"
      ? "operating"
      : "liability";
  // A capitalized payment settles exactly what the schedule took out of the
  // liability; another amount would leave the liability off. A different
  // price is a Modify of the lease. Compared in base, as the liability is.
  if (
    payment &&
    role === "liability" &&
    !equals(amounts.nominalBaseCost, payment.amount)
  ) {
    throw new InvalidInputError(
      `The ${payment.description} line must be ${payment.amount}, its payment's amount; modify the lease to change a payment`
    );
  }

  const account = facts.accounts.get(role);
  if (!account) throw new InvalidInputError(MISSING_ACCOUNTS);
  if (role !== "liability") {
    return { leaseId: line.leaseId, account, extrasAccount: null };
  }
  const extrasAccount = facts.accounts.get("operating") ?? null;
  if (
    !extrasAccount &&
    !equals(amounts.totalBaseCost, amounts.nominalBaseCost)
  ) {
    throw new InvalidInputError(MISSING_ACCOUNTS);
  }
  return { leaseId: line.leaseId, account, extrasAccount };
}
type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];

/** The posting's threshold for a variance worth a line. */
const VARIANCE_THRESHOLD = 0.005;

/** One line before it has a journal, and its dimension values by entity
 *  type, in the order the posting writes them. A null value writes none. */
export type PurchaseInvoiceJournalLine = Omit<
  JournalLineInsert,
  "journalId" | "companyId" | "createdBy"
> & {
  dimensions: JournalLineDimensionValues;
};

export type PurchaseInvoiceAccountDefaults = Pick<
  Database["public"]["Tables"]["accountDefault"]["Row"],
  | "goodsReceivedNotInvoicedAccount"
  | "purchaseVarianceAccount"
  | "indirectCostAccount"
  | "workInProgressAccount"
  | "rawMaterialsAccount"
  | "finishedGoodsAccount"
>;

/** What the journal reads of a line's item. */
export type PurchaseInvoiceItem = {
  itemId: string | null;
  /** Null when the item has no row: the line posts as Inventory. */
  itemTrackingType: Enums["itemTrackingType"] | null;
  replenishmentSystem: Enums["itemReplenishmentSystem"] | null;
  itemPostingGroupId: string | null;
  /** Null when the item has no cost record. The journal refuses it only
   *  when it must know whether the variance writes up receipt layers. */
  costingMethod: Enums["itemCostingMethod"] | null;
};

/**
 * How the variance of the received units splits between inventory and
 * purchase variance.
 * - `receiptLayers`: the receipt cost layers of the PO line's item, in FIFO
 *   order. Their unconsumed units take their share into inventory. With no
 *   layer (goods received before receipts wrote layers), the item's on-hand
 *   quantity measures the units still in stock.
 * - `storedWriteUp`: the write-up of the item's layers the posting stored for
 *   this invoice, shared across the invoice's lines of the item in
 *   proportion to their variance.
 */
export type VarianceCoverage =
  | { receiptLayers: ReceiptLayerLike[]; onHandQuantity: number }
  | { storedWriteUp: number };

/** A PO line, as it stood before this invoice. Quantities in inventory
 *  units. */
export type InvoicedPurchaseOrderLine = {
  purchaseOrderLineId: string;
  quantityReceived: number;
  /** What the invoices before this one invoiced. */
  quantityInvoiced: number;
  /** The receipts, in the order they were posted. */
  receiptGroups: { quantity: number; cost: number }[];
  /** A PO line for a job operation (outside processing). */
  isOutsideProcessing: boolean;
  processId: string | null;
  coverage: VarianceCoverage;
};

type LineBase = {
  id: string;
  invoiceLineType: Enums["payableLineType"];
  locationId: string | null;
  amounts: Pick<
    PurchasePostingAmounts,
    | "inventoryQuantity"
    | "nominalBaseCost"
    | "totalBaseCost"
    | "inventoryUnitCost"
  >;
};

export type PurchaseInvoicePostingLine = LineBase &
  (
    | {
        /** An item line with no PO: the invoice receives the goods. */
        kind: "direct";
        item: PurchaseInvoiceItem;
        /** The invoice posts the receipt (an item ledger row) with it. */
        receivedWithInvoice: boolean;
      }
    | {
        kind: "ordered";
        item: PurchaseInvoiceItem;
        purchaseOrderLine: InvoicedPurchaseOrderLine;
      }
    | {
        kind: "fixedAsset";
        purchaseOrderLineId: string | null;
        purchaseOrderLineLocationId: string | null;
        assetLocationId: string | null;
        fixedAssetClassId: string | null;
        /** The receipt cost when a receipt brought the asset in, else the
         *  account of the asset's class, which the invoice debits. */
        acquisition: { receiptCost: number } | { assetAccountId: string };
      }
    | {
        kind: "glAccount";
        purchaseOrderLineId: string | null;
        account: { id: string; name: string };
        costCenterId: string | null;
        projectId: string | null;
      }
    | {
        /** A lessee lease's line, its accounts from `resolveLeasePostingLine`.
         *  Never a project or cost center cost. */
        kind: "lease";
        leaseId: string;
        /** Takes the nominal amount, and the whole total when there is no
         *  `extrasAccount`. */
        account: LeaseAccount;
        /** A capitalized payment's: takes the total less the nominal amount
         *  (tax, line shipping, the share of header freight), so the lease
         *  liability is debited by exactly what the schedule took out of it. */
        extrasAccount: LeaseAccount | null;
      }
  );

export type BuildPurchaseInvoicePostingLinesInput = {
  invoice: {
    id: string;
    supplierId: string | null;
    supplierReference: string | null;
  };
  supplierTypeId: string | null;
  accounts: PurchaseInvoiceAccountDefaults;
  /** Payables, or Intercompany Payables for a sister company's invoice. */
  payables: {
    accountId: string;
    accountDefaultRole: OptionalDefaultRole | null;
  };
  /** The invoice's lines in order, comments left out. */
  lines: PurchaseInvoicePostingLine[];
};

/** The units a line cleared from GR/IR and what their variance did. */
export type ReceivedVariance = {
  quantity: number;
  receiptCost: number;
  /** Invoice cost less receipt cost. */
  variance: number;
  /** The split of the variance, with the adjustment of each receipt layer. */
  allocation: VarianceAllocation;
  /** The units still on hand that get a new layer, when the PO line has no
   *  receipt layer. 0 otherwise. */
  selfHealQuantity: number;
};

export type PurchaseInvoicePosting = {
  lines: PurchaseInvoiceJournalLine[];
  /** By invoice line id: each PO item line that cleared received units, and
   *  each fixed asset line a receipt brought in. */
  receivedVariances: Map<string, ReceivedVariance>;
};

/** A line of an item: `direct` with no PO, else `ordered`. */
export function isItemLineType(type: Enums["payableLineType"]): boolean {
  return ITEM_LINE_TYPES.has(type);
}

/** Does the variance of the line's received units write up receipt layers?
 *  Standard cost, outside processing and Non-Inventory lines have none. */
export function usesReceiptLayers(
  item: PurchaseInvoiceItem,
  isOutsideProcessing: boolean
): boolean {
  return (
    !isOutsideProcessing &&
    (item.itemTrackingType ?? "Inventory") !== "Non-Inventory" &&
    item.itemId !== null &&
    costingMethodOf(item) !== "Standard"
  );
}

function costingMethodOf(item: PurchaseInvoiceItem) {
  if (!item.costingMethod) {
    throw new InvalidInputError(
      `Item ${item.itemId} on a purchase invoice has no cost record, so its invoice cannot be journaled.`
    );
  }
  return item.costingMethod;
}

type Clearing = {
  quantity: number;
  receiptCost: number;
  invoiceCost: number;
  variance: number;
  usesLayers: boolean;
};

/** The received units no earlier invoice cleared, costed at their receipts:
 *  skip the units invoiced before, cost the next ones. */
function clearReceipts(
  line: Extract<PurchaseInvoicePostingLine, { kind: "ordered" }>
): Clearing | null {
  const { amounts, purchaseOrderLine } = line;
  const { quantityReceived, quantityInvoiced } = purchaseOrderLine;
  const quantity = Math.max(
    0,
    Math.min(amounts.inventoryQuantity, quantityReceived - quantityInvoiced)
  );
  if (quantity <= 0) return null;

  const alreadyCleared =
    quantityReceived > quantityInvoiced ? quantityInvoiced : 0;
  let receiptCost = 0;
  let counted = 0;
  let cleared = 0;
  for (const group of purchaseOrderLine.receiptGroups) {
    if (!group.quantity) continue;
    const unitCost = group.cost / group.quantity;
    const available =
      alreadyCleared > counted
        ? group.quantity + counted - alreadyCleared
        : group.quantity;
    const taken = Math.max(0, Math.min(available, quantity - cleared));
    receiptCost += taken * unitCost;
    counted += group.quantity;
    cleared += taken;
  }
  const invoiceCost = quantity * amounts.inventoryUnitCost;
  return {
    quantity,
    receiptCost,
    invoiceCost,
    variance: invoiceCost - receiptCost,
    usesLayers: usesReceiptLayers(
      line.item,
      purchaseOrderLine.isOutsideProcessing
    )
  };
}

function allocate(
  clearing: Clearing,
  coverage: VarianceCoverage,
  itemVariance: number
): { allocation: VarianceAllocation; selfHealQuantity: number } {
  const { quantity, variance } = clearing;
  const significant = Math.abs(variance) > VARIANCE_THRESHOLD;
  if (!clearing.usesLayers || !significant) {
    return {
      allocation: {
        inventoryShare: 0,
        ppvShare: significant ? variance : 0,
        perLayer: []
      },
      selfHealQuantity: 0
    };
  }
  if ("storedWriteUp" in coverage) {
    const inventoryShare =
      coverage.storedWriteUp && Math.abs(itemVariance) > EPSILON
        ? coverage.storedWriteUp * (variance / itemVariance)
        : 0;
    return {
      allocation: {
        inventoryShare,
        ppvShare: variance - inventoryShare,
        perLayer: []
      },
      selfHealQuantity: 0
    };
  }
  if (coverage.receiptLayers.length > 0) {
    return {
      allocation: allocateVarianceAcrossLayers(
        coverage.receiptLayers,
        quantity,
        variance
      ),
      selfHealQuantity: 0
    };
  }
  // Goods received before receipts wrote layers: the units still on hand
  // take their share into a new layer, the write-up baked into it.
  const covered = Math.min(Math.max(0, coverage.onHandQuantity), quantity);
  const allocation = allocateVarianceAcrossLayers(
    [{ id: "legacy-self-heal", quantity, remainingQuantity: covered }],
    quantity,
    variance
  );
  return {
    allocation: { ...allocation, perLayer: [] },
    selfHealQuantity: covered
  };
}

export function buildPurchaseInvoicePostingLines(
  input: BuildPurchaseInvoicePostingLinesInput
): PurchaseInvoicePosting {
  const { invoice, accounts, payables, supplierTypeId } = input;

  const clearings = new Map<string, Clearing>();
  // The variance of the lines that share a stored write-up, per item.
  const writeUpVarianceByItem = new Map<string, number>();
  for (const line of input.lines) {
    if (line.kind !== "ordered") continue;
    const clearing = clearReceipts(line);
    if (!clearing) continue;
    clearings.set(line.id, clearing);
    const itemId = line.item.itemId;
    if (
      itemId &&
      clearing.usesLayers &&
      Math.abs(clearing.variance) > VARIANCE_THRESHOLD &&
      "storedWriteUp" in line.purchaseOrderLine.coverage
    ) {
      writeUpVarianceByItem.set(
        itemId,
        (writeUpVarianceByItem.get(itemId) ?? 0) + clearing.variance
      );
    }
  }

  const lines: PurchaseInvoiceJournalLine[] = [];
  const receivedVariances = new Map<string, ReceivedVariance>();

  type Dimensions = {
    supplierTypeId: string | null;
    itemPostingGroupId: string | null;
    itemId: string | null;
    locationId: string | null;
    costCenterId: string | null;
    projectId: string | null;
    processId: string | null;
    fixedAssetClassId: string | null;
  };
  type Line = Omit<
    PurchaseInvoiceJournalLine,
    "dimensions" | "documentType" | "documentId" | "externalDocumentId"
  >;
  const push = (line: Line, meta: Dimensions) =>
    lines.push({
      ...line,
      documentType: "Invoice",
      documentId: invoice.id,
      externalDocumentId: invoice.supplierReference,
      dimensions: {
        SupplierType: meta.supplierTypeId,
        ItemPostingGroup: meta.itemPostingGroupId,
        Item: meta.itemId,
        Supplier: invoice.supplierId,
        Location: meta.locationId,
        CostCenter: meta.costCenterId,
        Project: meta.projectId,
        Process: meta.processId,
        FixedAssetClass: meta.fixedAssetClassId
      }
    });
  const payable = (
    amount: number,
    quantity: number,
    keys: {
      journalLineReference: string;
      documentLineReference?: string | null;
      accrual?: boolean;
    }
  ): Line => ({
    accountId: payables.accountId,
    accountDefaultRole: payables.accountDefaultRole,
    description: "Accounts Payable",
    amount: round(credit("liability", amount)),
    quantity: round(quantity),
    ...keys
  });

  for (const line of input.lines) {
    const { inventoryQuantity: quantity, totalBaseCost: total } = line.amounts;

    switch (line.kind) {
      case "direct": {
        const { item } = line;
        const trackingType = item.itemTrackingType ?? "Inventory";
        let debitAccount: string;
        let debitDescription: string;
        if (trackingType === "Inventory" && line.receivedWithInvoice) {
          const inventory = resolveInventoryAccount(
            item.replenishmentSystem,
            accounts
          );
          debitAccount = inventory.account;
          debitDescription = inventory.description;
        } else if (trackingType === "Non-Inventory") {
          debitAccount = accounts.indirectCostAccount;
          debitDescription = "Indirect Cost Account";
        } else {
          debitAccount = accounts.workInProgressAccount;
          debitDescription = "WIP Account";
        }
        const journalLineReference = nanoid();
        const meta: Dimensions = {
          supplierTypeId,
          itemPostingGroupId: item.itemPostingGroupId,
          itemId: item.itemId,
          locationId: line.locationId,
          costCenterId: null,
          projectId: null,
          processId: null,
          fixedAssetClassId: null
        };
        push(
          {
            accountId: debitAccount,
            description: debitDescription,
            amount: round(debit("asset", total)),
            quantity: round(quantity),
            journalLineReference
          },
          meta
        );
        push(payable(total, quantity, { journalLineReference }), meta);
        break;
      }

      case "ordered": {
        const { item, purchaseOrderLine } = line;
        const documentLineReference = journalReference.to.purchaseInvoice(
          purchaseOrderLine.purchaseOrderLineId
        );
        const meta: Dimensions = {
          supplierTypeId,
          itemPostingGroupId: item.itemPostingGroupId,
          itemId: item.itemId,
          locationId: line.locationId,
          costCenterId: null,
          projectId: null,
          processId: purchaseOrderLine.processId,
          fixedAssetClassId: null
        };

        // Received units clear GR/IR at their receipt cost.
        const clearing = clearings.get(line.id);
        if (clearing) {
          const { allocation, selfHealQuantity } = allocate(
            clearing,
            purchaseOrderLine.coverage,
            item.itemId ? (writeUpVarianceByItem.get(item.itemId) ?? 0) : 0
          );
          receivedVariances.set(line.id, {
            quantity: clearing.quantity,
            receiptCost: clearing.receiptCost,
            variance: clearing.variance,
            allocation,
            selfHealQuantity
          });
          const keys = {
            quantity: round(clearing.quantity),
            documentLineReference,
            journalLineReference: nanoid()
          };
          push(
            {
              accountId: accounts.goodsReceivedNotInvoicedAccount,
              description: "GR/IR Clearing",
              amount: round(debit("liability", clearing.receiptCost)),
              ...keys
            },
            meta
          );
          // The on-hand share writes up inventory; the consumed share is
          // purchase variance.
          if (Math.abs(allocation.inventoryShare) > VARIANCE_THRESHOLD) {
            const inventory = resolveInventoryAccount(
              item.replenishmentSystem,
              accounts
            );
            push(
              {
                accountId: inventory.account,
                description: inventory.description,
                amount: round(debit("asset", allocation.inventoryShare)),
                ...keys
              },
              meta
            );
          }
          if (Math.abs(allocation.ppvShare) > VARIANCE_THRESHOLD) {
            push(
              {
                accountId: accounts.purchaseVarianceAccount,
                description: "Purchase Price Variance",
                amount: round(debit("expense", allocation.ppvShare)),
                ...keys
              },
              meta
            );
          }
          push(payable(clearing.invoiceCost, clearing.quantity, keys), meta);
        }

        // Units not yet received accrue GR/IR. A service is never received,
        // so it expenses them to indirect cost.
        const quantityCleared = clearing?.quantity ?? 0;
        if (quantity > quantityCleared) {
          const quantityToAccrue = quantity - quantityCleared;
          const accrualCost = quantityToAccrue * line.amounts.inventoryUnitCost;
          const isService = line.invoiceLineType === "Service";
          const keys = {
            quantity: round(quantityToAccrue),
            documentLineReference,
            journalLineReference: nanoid()
          };
          push(
            isService
              ? {
                  accountId: accounts.indirectCostAccount,
                  description: "Indirect Cost Account",
                  amount: round(debit("asset", accrualCost)),
                  ...keys
                }
              : {
                  accountId: accounts.goodsReceivedNotInvoicedAccount,
                  description: "GR/IR Clearing",
                  accrual: true,
                  amount: round(debit("liability", accrualCost)),
                  ...keys
                },
            meta
          );
          push(
            payable(accrualCost, quantityToAccrue, {
              ...keys,
              ...(isService ? {} : { accrual: true })
            }),
            meta
          );
        }
        break;
      }

      case "fixedAsset": {
        const meta: Dimensions = {
          supplierTypeId,
          itemPostingGroupId: null,
          itemId: null,
          locationId:
            line.locationId ??
            line.purchaseOrderLineLocationId ??
            line.assetLocationId,
          costCenterId: null,
          projectId: null,
          processId: null,
          fixedAssetClassId: line.fixedAssetClassId
        };
        const keys = {
          quantity: round(quantity),
          documentLineReference: line.purchaseOrderLineId
            ? journalReference.to.purchaseInvoice(line.purchaseOrderLineId)
            : null,
          journalLineReference: nanoid()
        };
        if ("receiptCost" in line.acquisition) {
          // Received: clear GR/IR at the receipt cost.
          const { receiptCost } = line.acquisition;
          const variance = total - receiptCost;
          const significant = Math.abs(variance) > VARIANCE_THRESHOLD;
          receivedVariances.set(line.id, {
            quantity,
            receiptCost,
            variance,
            allocation: {
              inventoryShare: 0,
              ppvShare: significant ? variance : 0,
              perLayer: []
            },
            selfHealQuantity: 0
          });
          push(
            {
              accountId: accounts.goodsReceivedNotInvoicedAccount,
              description: "GR/IR Clearing",
              amount: round(debit("liability", receiptCost)),
              ...keys
            },
            meta
          );
          if (significant) {
            push(
              {
                accountId: accounts.purchaseVarianceAccount,
                description: "Purchase Price Variance",
                amount: round(debit("expense", variance)),
                ...keys
              },
              meta
            );
          }
        } else {
          push(
            {
              accountId: line.acquisition.assetAccountId,
              description: "Fixed Asset Acquisition",
              amount: round(debit("asset", total)),
              ...keys
            },
            meta
          );
        }
        push(payable(total, quantity, keys), meta);
        break;
      }

      case "glAccount": {
        const meta: Dimensions = {
          supplierTypeId: null,
          itemPostingGroupId: null,
          itemId: null,
          locationId: line.locationId,
          costCenterId: line.costCenterId,
          projectId: line.projectId,
          processId: null,
          fixedAssetClassId: null
        };
        const keys = {
          quantity: round(quantity),
          documentLineReference: line.purchaseOrderLineId
            ? journalReference.to.purchaseInvoice(line.purchaseOrderLineId)
            : null,
          journalLineReference: nanoid()
        };
        push(
          {
            accountId: line.account.id,
            description: line.account.name,
            amount: round(debit("asset", total)),
            ...keys
          },
          meta
        );
        push(payable(total, quantity, keys), meta);
        break;
      }

      case "lease": {
        const meta: Dimensions = {
          supplierTypeId: null,
          itemPostingGroupId: null,
          itemId: null,
          locationId: line.locationId,
          costCenterId: null,
          projectId: null,
          processId: null,
          fixedAssetClassId: null
        };
        const keys = {
          quantity: round(quantity),
          documentLineReference: null,
          journalLineReference: nanoid()
        };
        const extras = line.extrasAccount
          ? total - line.amounts.nominalBaseCost
          : 0;
        // Signed by the account's class: a debit to the Liability-class lease
        // liability stores a negative amount, to an expense a positive one.
        push(
          {
            accountId: line.account.id,
            description: line.account.name,
            amount: round(
              debit(accountTypeFromClass(line.account.class), total - extras)
            ),
            ...keys
          },
          meta
        );
        if (line.extrasAccount && !equals(extras, 0)) {
          push(
            {
              accountId: line.extrasAccount.id,
              description: line.extrasAccount.name,
              amount: round(
                debit(accountTypeFromClass(line.extrasAccount.class), extras)
              ),
              ...keys
            },
            meta
          );
        }
        push(payable(total, quantity, keys), meta);
        break;
      }
    }
  }

  return { lines, receivedVariances };
}
export type PurchasePostingLine = {
  id: string;
  invoiceLineType: string;
  quantity: number;
  conversionFactor: number | null;
  /** Generated company-base amount per purchase unit. */
  unitPrice: number | null;
  /** Generated company-base line freight and nonrecoverable tax. */
  shippingCost: number | null;
  taxAmount: number | null;
  /** Supplier-currency fields used only for the existing pretax IC matching basis. */
  supplierUnitPrice?: number | null;
  supplierShippingCost?: number | null;
};

export type PurchasePostingAmounts = {
  id: string;
  inventoryQuantity: number;
  nominalBaseCost: number;
  headerShippingBase: number;
  totalBaseCost: number;
  inventoryUnitCost: number;
  intercompanyDocumentAmount: number;
};

/** Both the PO counter and invoice quantity are in purchase units. */
export function getInvoicedPurchaseQuantityAfterVoid(
  quantityInvoiced: number | null,
  invoicePurchaseQuantity: number
): number {
  return Math.max(0, (quantityInvoiced ?? 0) - invoicePurchaseQuantity);
}

export function calculatePurchasePostingAmounts(input: {
  lines: PurchasePostingLine[];
  exchangeRate: number;
  supplierShippingCost: number;
}): PurchasePostingAmounts[] {
  const lines = input.lines.filter(
    (line) => line.invoiceLineType !== "Comment"
  );
  const headerBase = toBaseAmount(
    input.supplierShippingCost,
    input.exchangeRate
  );
  const costs = lines.map((line) => {
    const factor = line.conversionFactor ?? 1;
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(
        `Purchase line ${line.id} conversion factor must be positive and finite`
      );
    }
    const nominal = line.quantity * (line.unitPrice ?? 0);
    const cost = nominal + (line.shippingCost ?? 0) + (line.taxAmount ?? 0);
    const inventoryQuantity = line.quantity * factor;
    const intercompanyDocumentAmount =
      line.quantity * (line.supplierUnitPrice ?? 0) +
      (line.supplierShippingCost ?? 0);
    if (
      ![nominal, cost, inventoryQuantity, intercompanyDocumentAmount].every(
        Number.isFinite
      )
    ) {
      throw new Error(`Purchase line ${line.id} amounts must be finite`);
    }
    return { nominal, cost, inventoryQuantity, intercompanyDocumentAmount };
  });
  const totalLinesCost = costs.reduce((sum, row) => sum + row.cost, 0);
  let allocatedHeader = 0;
  return lines.map((line, index) => {
    const { nominal, cost, inventoryQuantity, intercompanyDocumentAmount } =
      costs[index]!;
    const weight =
      totalLinesCost === 0 ? 1 / lines.length : cost / totalLinesCost;
    // Reconcile the final share to the converted header, so all posted shares
    // retain the total even when an equal allocation crosses internal precision.
    const headerShippingBase = round(
      index === lines.length - 1
        ? headerBase - allocatedHeader
        : headerBase * weight
    );
    allocatedHeader += headerShippingBase;
    // Generated line fields are already base; only supplier header freight is
    // converted. These same amounts fund AP, inventory/expense and acquisition.
    const totalBaseCost = round(cost + headerShippingBase);
    return {
      id: line.id,
      inventoryQuantity,
      nominalBaseCost: round(nominal),
      headerShippingBase,
      totalBaseCost,
      inventoryUnitCost:
        inventoryQuantity === 0 ? 0 : totalBaseCost / inventoryQuantity,
      intercompanyDocumentAmount
    };
  });
}
const postPurchaseInvoiceLogger = getLogger(
  "server-functions",
  "post-purchase-invoice"
);

type JournalLineRow = Database["public"]["Tables"]["journalLine"]["Row"];

/** A PO line's receipts as its receipt journals record them: consecutive
 *  lines of one journal and accrual flag are one receipt, costed by its first
 *  line. */
function receiptGroups(
  receiptLines: JournalLineRow[]
): { quantity: number; cost: number }[] {
  const groups: { quantity: number; cost: number }[] = [];
  let previous: JournalLineRow | undefined;
  for (const line of receiptLines) {
    if (
      !previous ||
      line.journalId !== previous.journalId ||
      line.accrual !== previous.accrual
    ) {
      groups.push({
        quantity: line.quantity,
        cost: Math.abs(line.amount ?? 0)
      });
    }
    previous = line;
  }
  return groups;
}

/** What the receipts of a fixed asset's PO line booked: its acquisition
 *  debits, else its GR/IR credits. */
function fixedAssetReceiptCost(receiptLines: JournalLineRow[]): number {
  let receiptCost = 0;
  for (const entry of receiptLines) {
    if (
      (entry.amount ?? 0) > 0 &&
      entry.description === "Fixed Asset Acquisition"
    ) {
      receiptCost += Math.abs(entry.amount ?? 0);
    }
  }
  if (receiptCost === 0) {
    for (const entry of receiptLines) {
      if (
        (entry.amount ?? 0) < 0 &&
        entry.description === "Goods Received Not Invoiced"
      ) {
        receiptCost += Math.abs(entry.amount ?? 0);
      }
    }
  }
  return receiptCost;
}

export const postPurchaseInvoiceInput = z.object({
  type: z.enum(["post", "void"]).default("post"),
  invoiceId: z.string(),
  skipReceiptPost: z.boolean().optional()
});

export const postPurchaseInvoicePermission = {
  update: "invoicing"
} satisfies PermissionRule<z.output<typeof postPurchaseInvoiceInput>>;

/** Posts or voids a purchase invoice: receipts, cost, ledger and journal rows. */
export async function postPurchaseInvoice(
  ctx: ServiceContext,
  raw: z.input<typeof postPurchaseInvoiceInput>
) {
  const { type, invoiceId, skipReceiptPost } =
    postPurchaseInvoiceInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  postPurchaseInvoiceLogger.info({ type, invoiceId, userId, skipReceiptPost });
  const fixedAssetWrites = new FixedAssetWrites();
  if (type === "post")
    await assertPostable(db, "purchaseInvoice", invoiceId, companyId);
  try {
    const today = datetime
      .today(await getCompanyTimeZone(db, companyId))
      .toString();

    // Every invoice posts a journal: Provisional before the company's
    // accounting cutover, Posted after it. Read here to decide whether to
    // resolve a period, and again inside each transaction, where FOR SHARE
    // holds the status until commit.
    const postingStatus = await journalPostingStatus(db, companyId);

    if (type === "void") {
      // The client is service-role: authorization proved the caller may
      // act in companyId, not that invoiceId belongs to it.
      const invoice = await maybeSingle(db, "purchaseInvoice", {
        id: invoiceId,
        companyId
      });
      if (invoice.error) throw new Error("Failed to fetch purchaseInvoice");
      if (!invoice.data) throw new NotFoundError("Purchase invoice not found");

      if (!invoice.data.postingDate) {
        throw new Error("Can only void posted purchase invoices");
      }

      if (invoice.data.status === "Voided") {
        throw new Error("Purchase invoice is already voided");
      }

      // The enable superseded this invoice's journal and opened its
      // payable in the opening journal.
      await refuseVoidBeforeCutover(
        db,
        companyId,
        invoice.data.postingDate,
        PURCHASE_INVOICE_VOID_BEFORE_CUTOVER_ERROR
      );

      if (
        invoice.data.status === "Paid" ||
        invoice.data.status === "Partially Paid"
      ) {
        throw new Error(
          "Cannot void a purchase invoice with payments applied. Reverse the payment first."
        );
      }

      const [originalItemLedger, originalJournalLines, originalCostLedger] =
        await inOrder([
          () => many(db, "itemLedger", { documentId: invoiceId, companyId }),
          () =>
            documentJournalLines(db, companyId, {
              documentId: invoiceId,
              documentType: "Invoice"
            }),
          () =>
            many(db, "costLedger", {
              documentId: invoiceId,
              documentType: ["Purchase Invoice", "Purchase Receipt"],
              companyId
            })
        ]);

      if (originalItemLedger.error)
        throw new Error("Failed to fetch item ledger entries");
      if (originalCostLedger.error)
        throw new Error("Failed to fetch cost ledger entries");

      const invoiceLinesVoid = await many(db, "purchaseInvoiceLine", {
        invoiceId
      });
      if (invoiceLinesVoid.error)
        throw new Error("Failed to fetch purchase invoice lines");

      // A Fixed Asset line that posted into Construction in Progress wrote a
      // CIP cost row; voiding removes those rows and takes their amount back
      // off the asset. A capitalized asset must be reversed first. Assets on a
      // depreciating class keep the existing behaviour (no asset write).
      const faAssetIdsVoid: string[] = [];
      for (const line of invoiceLinesVoid.data) {
        if (
          line.invoiceLineType === "Fixed Asset" &&
          line.assetId &&
          !faAssetIdsVoid.includes(line.assetId)
        ) {
          faAssetIdsVoid.push(line.assetId);
        }
      }
      const cipAssetUpdatesVoid = new Map<string, number>();
      if (faAssetIdsVoid.length > 0) {
        const [cipCostRowsVoid, faRecordsVoid] = await inOrder([
          () =>
            many(
              db,
              "fixedAssetCipCost",
              { companyId, sourceDocumentId: invoiceId },
              { columns: ["fixedAssetId", "amount"] }
            ),
          () =>
            many<
              "fixedAsset",
              Pick<
                rows.Tables["fixedAsset"]["Row"],
                "id" | "status" | "acquisitionCost"
              > & {
                fixedAssetClass: Pick<
                  rows.Tables["fixedAssetClass"]["Row"],
                  "isConstructionInProgress"
                > | null;
              }
            >(
              db,
              "fixedAsset",
              { companyId, id: faAssetIdsVoid },
              {
                columns: ["id", "status", "acquisitionCost"],
                embed: {
                  fixedAssetClass: {
                    table: "fixedAssetClass",
                    via: "fixedAssetClassId",
                    columns: ["isConstructionInProgress"]
                  }
                }
              }
            )
        ]);
        if (cipCostRowsVoid.error)
          throw new Error("Failed to fetch fixed asset CIP costs");
        if (faRecordsVoid.error)
          throw new Error("Failed to fetch fixed assets");

        const cipCostByAssetVoid = new Map<string, number>();
        for (const row of cipCostRowsVoid.data) {
          cipCostByAssetVoid.set(
            row.fixedAssetId,
            (cipCostByAssetVoid.get(row.fixedAssetId) ?? 0) + Number(row.amount)
          );
        }

        for (const asset of faRecordsVoid.data) {
          const isConstructionInProgress =
            cipCostByAssetVoid.has(asset.id) ||
            Boolean((asset.fixedAssetClass as any)?.isConstructionInProgress);
          if (!isConstructionInProgress) continue;
          if (asset.status !== "Under Construction") {
            throw new Error(
              "Asset was capitalized; reverse the capitalization first"
            );
          }
          // Every acquisitionCost change this invoice made to a CIP asset
          // wrote a CIP cost row (the direct line's cost, a receipt-backed
          // line's variance), so no row means it changed nothing to undo:
          // a receipt-backed line whose variance was within a cent.
          const cipCost = cipCostByAssetVoid.get(asset.id);
          if (cipCost !== undefined) {
            cipAssetUpdatesVoid.set(
              asset.id,
              Math.max(0, round(Number(asset.acquisitionCost) - cipCost))
            );
          }
        }
      }

      const purchaseOrderLineIdsVoid = invoiceLinesVoid.data.reduce<string[]>(
        (acc, invoiceLine) => {
          if (
            invoiceLine.purchaseOrderLineId &&
            !acc.includes(invoiceLine.purchaseOrderLineId)
          ) {
            acc.push(invoiceLine.purchaseOrderLineId);
          }
          return acc;
        },
        []
      );

      const affectedPurchaseOrderIdsVoid: string[] = [];

      if (purchaseOrderLineIdsVoid.length > 0) {
        const touchedLines = await many(
          db,
          "purchaseOrderLine",
          { companyId, id: purchaseOrderLineIdsVoid },
          { columns: ["purchaseOrderId"] }
        );
        if (touchedLines.error)
          throw new Error("Failed to fetch purchase order lines");
        for (const { purchaseOrderId } of touchedLines.data) {
          if (
            purchaseOrderId &&
            !affectedPurchaseOrderIdsVoid.includes(purchaseOrderId)
          ) {
            affectedPurchaseOrderIdsVoid.push(purchaseOrderId);
          }
        }
      }

      const purchaseOrderLinesVoid =
        affectedPurchaseOrderIdsVoid.length > 0
          ? await many(db, "purchaseOrderLine", {
              purchaseOrderId: affectedPurchaseOrderIdsVoid
            })
          : {
              data: [] as Database["public"]["Tables"]["purchaseOrderLine"]["Row"][],
              error: null
            };

      if (purchaseOrderLinesVoid.error)
        throw new Error("Failed to fetch purchase order lines");

      const purchaseOrderLinesByIdVoid = purchaseOrderLinesVoid.data.reduce<
        Record<string, Database["public"]["Tables"]["purchaseOrderLine"]["Row"]>
      >((acc, purchaseOrderLine) => {
        acc[purchaseOrderLine.id] = purchaseOrderLine;
        return acc;
      }, {});

      const purchaseOrderLineUpdatesVoid = invoiceLinesVoid.data.reduce<
        Record<
          string,
          Database["public"]["Tables"]["purchaseOrderLine"]["Update"] & {
            purchaseOrderId: string;
          }
        >
      >((acc, invoiceLine) => {
        const purchaseOrderLine =
          purchaseOrderLinesByIdVoid[invoiceLine.purchaseOrderLineId ?? ""];
        if (
          invoiceLine.purchaseOrderLineId &&
          purchaseOrderLine &&
          invoiceLine.quantity &&
          purchaseOrderLine.purchaseQuantity &&
          purchaseOrderLine.purchaseQuantity > 0
        ) {
          const newQuantityInvoiced = getInvoicedPurchaseQuantityAfterVoid(
            purchaseOrderLine.quantityInvoiced,
            invoiceLine.quantity
          );

          // Short-close aware: compare against the billable (received)
          // quantity for short-closed lines, not the ordered quantity.
          const invoicedComplete =
            newQuantityInvoiced >= getBillableQuantity(purchaseOrderLine);

          acc[invoiceLine.purchaseOrderLineId] = {
            quantityInvoiced: newQuantityInvoiced,
            invoicedComplete,
            purchaseOrderId: purchaseOrderLine.purchaseOrderId
          };
        }
        return acc;
      }, {});

      const purchaseOrderStatusUpdatesVoid: Record<
        string,
        Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"]
      > = {};
      for (const purchaseOrderId of affectedPurchaseOrderIdsVoid) {
        const projectedLines = purchaseOrderLinesVoid.data
          .filter((line) => line.purchaseOrderId === purchaseOrderId)
          .map((line) => {
            const update = purchaseOrderLineUpdatesVoid[line.id];
            if (update && update.quantityInvoiced !== undefined) {
              return { ...line, quantityInvoiced: update.quantityInvoiced };
            }
            return line;
          });

        const areAllLinesInvoicedProjected = projectedLines.every((line) => {
          if (line.purchaseOrderLineType === "Comment") return true;
          const target = line.purchaseQuantity ?? 0;
          if (target <= 0) return true;
          return (line.quantityInvoiced ?? 0) >= target;
        });

        const areAllLinesReceivedProjected = projectedLines.every((line) => {
          if (
            line.purchaseOrderLineType === "Comment" ||
            line.purchaseOrderLineType === "G/L Account" ||
            line.purchaseOrderLineType === "Service"
          )
            return true;
          const target = line.purchaseQuantity ?? 0;
          if (target <= 0) return true;
          return (line.quantityReceived ?? 0) >= target;
        });

        let status: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
          "To Receive and Invoice";
        if (areAllLinesInvoicedProjected && areAllLinesReceivedProjected) {
          status = "Completed";
        } else if (areAllLinesInvoicedProjected) {
          status = "To Receive";
        } else if (areAllLinesReceivedProjected) {
          status = "To Invoice";
        }

        purchaseOrderStatusUpdatesVoid[purchaseOrderId] = status;
      }

      const reversingJournalLines: Omit<
        Database["public"]["Tables"]["journalLine"]["Insert"],
        "journalId"
      >[] = originalJournalLines.map((entry) => ({
        accountId: entry.accountId,
        // A reversed stand-in line names the same default, so the enable
        // re-points both sides together.
        accountDefaultRole: entry.accountDefaultRole,
        accrual: entry.accrual,
        description: `VOID: ${entry.description}`,
        // A reversal is a sign flip of an already-posted value, which is
        // exact — no rounding to do.
        amount: -entry.amount,
        quantity: -entry.quantity,
        documentType: entry.documentType,
        documentId: entry.documentId,
        externalDocumentId: entry.externalDocumentId,
        documentLineReference: entry.documentLineReference,
        journalLineReference: entry.journalLineReference,
        companyId
      }));

      const reversingItemLedger: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
        originalItemLedger.data.map((entry) => ({
          postingDate: today,
          itemId: entry.itemId,
          quantity: -entry.quantity,
          locationId: entry.locationId,
          storageUnitId: entry.storageUnitId,
          trackedEntityId: entry.trackedEntityId,
          entryType:
            entry.entryType === "Positive Adjmt."
              ? "Negative Adjmt."
              : entry.entryType === "Negative Adjmt."
                ? "Positive Adjmt."
                : entry.entryType,
          documentType: entry.documentType,
          documentId: entry.documentId,
          externalDocumentId: entry.externalDocumentId,
          createdBy: userId,
          companyId
        }));

      // Partition invoice-created costLedger rows for reversal:
      // - adjustment children (variance bumps on receipt layers)
      // - legacy self-heal layers (documentType 'Purchase Receipt')
      // - plain rows (no-PO direct-invoice layers): negative-mirror as before
      type CostLedgerRow = Database["public"]["Tables"]["costLedger"]["Row"];
      const adjustmentChildrenVoid = originalCostLedger.data.filter(
        (entry: CostLedgerRow) =>
          entry.adjustment && entry.appliesToCostLedgerId
      );
      const selfHealLayersVoid = originalCostLedger.data.filter(
        (entry: CostLedgerRow) =>
          !entry.adjustment && entry.documentType === "Purchase Receipt"
      );
      const plainCostLedgerVoid = originalCostLedger.data.filter(
        (entry: CostLedgerRow) =>
          !adjustmentChildrenVoid.includes(entry) &&
          !selfHealLayersVoid.includes(entry)
      );

      const reversingCostLedger: Database["public"]["Tables"]["costLedger"]["Insert"][] =
        plainCostLedgerVoid.map((entry) => ({
          itemLedgerType: entry.itemLedgerType,
          costLedgerType: entry.costLedgerType,
          adjustment: entry.adjustment,
          documentType: entry.documentType,
          documentId: entry.documentId,
          externalDocumentId: entry.externalDocumentId,
          itemId: entry.itemId,
          quantity: -entry.quantity,
          nominalCost: -entry.nominalCost,
          cost: -entry.cost,
          supplierId: entry.supplierId,
          companyId,
          postingDate: today
        }));

      // A Provisional journal has no accounting period.
      const accountingPeriodIdVoid =
        postingStatus === "Posted" && reversingJournalLines.length > 0
          ? await getCurrentAccountingPeriod(companyId, db, today)
          : null;

      await db.transaction().execute(async (trx) => {
        await assertPostingStatusUnchanged(trx, companyId, postingStatus);
        for await (const [purchaseOrderLineId, update] of Object.entries(
          purchaseOrderLineUpdatesVoid
        )) {
          const { purchaseOrderId: _purchaseOrderId, ...lineUpdate } = update;
          await trx
            .updateTable("purchaseOrderLine")
            .set(lineUpdate)
            .where("id", "=", purchaseOrderLineId)
            .where("companyId", "=", companyId)
            .execute();
        }

        for await (const [purchaseOrderId, status] of Object.entries(
          purchaseOrderStatusUpdatesVoid
        )) {
          await trx
            .updateTable("purchaseOrder")
            .set({ status })
            .where("id", "=", purchaseOrderId)
            .where("companyId", "=", companyId)
            .execute();
        }

        for (const [assetId, acquisitionCost] of cipAssetUpdatesVoid) {
          await trx
            .deleteFrom("fixedAssetCipCost")
            .where("companyId", "=", companyId)
            .where("sourceDocumentId", "=", invoiceId)
            .where("fixedAssetId", "=", assetId)
            .execute();
          await trx
            .updateTable("fixedAsset")
            .set({ acquisitionCost, updatedBy: userId })
            .where("id", "=", assetId)
            .where("companyId", "=", companyId)
            .execute();
        }

        if (reversingJournalLines.length > 0) {
          const voidJournalEntryId = await getNextSequence(
            trx,
            "journalEntry",
            companyId
          );

          const journal = await trx
            .insertInto("journal")
            .values({
              journalEntryId: voidJournalEntryId,
              accountingPeriodId: accountingPeriodIdVoid,
              description: `VOID Purchase Invoice ${invoice.data!.invoiceId}`,
              postingDate: today,
              companyId,
              sourceType: "Purchase Invoice",
              status: postingStatus,
              postedAt: datetime.timestamp(),
              postedBy: userId,
              createdBy: userId
            })
            .returning(["id"])
            .execute();

          const journalId = journal[0]!.id;
          if (!journalId) throw new Error("Failed to insert journal");

          await trx
            .insertInto("journalLine")
            .values(
              reversingJournalLines.map((journalLine) => ({
                ...journalLine,
                journalId
              }))
            )
            .execute();
        }

        if (reversingItemLedger.length > 0) {
          await trx
            .insertInto("itemLedger")
            .values(reversingItemLedger)
            .execute();
        }

        if (reversingCostLedger.length > 0) {
          await trx
            .insertInto("costLedger")
            .values(reversingCostLedger)
            .execute();
        }

        // Reverse variance adjustment children created by this invoice.
        // Untouched children are deleted; partially consumed ones get a
        // counter-child with the SAME remainingQuantity while the original
        // stays live — future consumption applies +bump and −bump together,
        // netting remaining units back to base cost. Already-consumed bumps
        // stay in posted COGS (no retroactive restatement).
        for (const child of adjustmentChildrenVoid) {
          if (Number(child.remainingQuantity ?? 0) === Number(child.quantity)) {
            await trx
              .deleteFrom("costLedger")
              .where("id", "=", child.id)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            await trx
              .insertInto("costLedger")
              .values({
                itemLedgerType: child.itemLedgerType,
                costLedgerType: child.costLedgerType,
                adjustment: true,
                appliesToCostLedgerId: child.appliesToCostLedgerId,
                documentType: child.documentType,
                documentId: child.documentId,
                externalDocumentId: child.externalDocumentId,
                itemId: child.itemId,
                quantity: round(child.quantity),
                nominalCost: round(-child.nominalCost),
                cost: round(-child.cost),
                remainingQuantity: round(child.remainingQuantity),
                supplierId: child.supplierId,
                companyId,
                postingDate: today
              })
              .execute();
          }
        }

        // Reverse legacy self-heal layers created by this invoice. Unconsumed
        // layers are deleted (restores the pre-invoice no-layer state);
        // partially consumed ones get a negative mirror row and stop feeding
        // consumption (remainingQuantity zeroed).
        for (const layer of selfHealLayersVoid) {
          if (Number(layer.remainingQuantity ?? 0) === Number(layer.quantity)) {
            await trx
              .deleteFrom("costLedger")
              .where("id", "=", layer.id)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            await trx
              .insertInto("costLedger")
              .values({
                itemLedgerType: layer.itemLedgerType,
                costLedgerType: layer.costLedgerType,
                adjustment: layer.adjustment,
                documentType: layer.documentType,
                documentId: layer.documentId,
                externalDocumentId: layer.externalDocumentId,
                itemId: layer.itemId,
                quantity: round(-layer.quantity),
                nominalCost: round(-layer.nominalCost),
                cost: round(-layer.cost),
                remainingQuantity: 0,
                supplierId: layer.supplierId,
                companyId,
                postingDate: today
              })
              .execute();
            await trx
              .updateTable("costLedger")
              .set({ remainingQuantity: 0 })
              .where("id", "=", layer.id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }

        // The lease payment rows this invoice billed are owed again: the
        // next run of the daily job drafts them anew.
        const leaseLineIds = invoiceLinesVoid.data
          .filter((line) => line.invoiceLineType === "Lease")
          .map((line) => line.id);
        if (leaseLineIds.length > 0) {
          await trx
            .updateTable("leasePayment")
            .set({
              status: "Pending",
              purchaseInvoiceLineId: null,
              voidedPurchaseInvoiceId: invoiceId,
              updatedBy: userId,
              updatedAt: datetime.timestamp()
            })
            .where("purchaseInvoiceLineId", "in", leaseLineIds)
            .where("companyId", "=", companyId)
            .execute();
        }

        await trx
          .updateTable("purchaseInvoice")
          .set({
            status: "Voided",
            updatedAt: today,
            updatedBy: userId
          })
          .where("id", "=", invoiceId)
          .where("companyId", "=", companyId)
          .execute();
      });

      return { success: true };
    }

    const companyRecord = await single(
      db,
      "company",
      { id: companyId },
      { columns: ["companyGroupId"] }
    );
    if (companyRecord.error) throw new Error("Failed to fetch company");
    const companyGroupId = companyRecord.data.companyGroupId;

    const [
      purchaseInvoice,
      purchaseInvoiceLines,
      purchaseInvoiceDelivery,
      dimensions
    ] = await inOrder([
      // Scoped for the same reason as the void path's read.
      () => maybeSingle(db, "purchaseInvoice", { id: invoiceId, companyId }),
      () => many(db, "purchaseInvoiceLine", { invoiceId, companyId }),
      () =>
        single(
          db,
          "purchaseInvoiceDelivery",
          { companyId, id: invoiceId },
          { columns: ["supplierShippingCost"] }
        ),
      () =>
        many(
          db,
          "dimension",
          {
            companyGroupId: companyGroupId!,
            active: true,
            entityType: [
              "SupplierType",
              "Supplier",
              "ItemPostingGroup",
              "Item",
              "Location",
              "CostCenter",
              "Project",
              "Process",
              "FixedAssetClass"
            ]
          },
          { columns: ["id", "entityType"] }
        )
    ]);

    if (purchaseInvoice.error)
      throw new Error("Failed to fetch purchaseInvoice");
    if (!purchaseInvoice.data)
      throw new NotFoundError("Purchase invoice not found");
    if (purchaseInvoiceLines.error)
      throw new Error("Failed to fetch receipt lines");
    if (purchaseInvoiceDelivery.error)
      throw new Error("Failed to fetch purchase invoice delivery");
    if (dimensions.error) {
      postPurchaseInvoiceLogger.error("Failed to fetch dimensions", {
        error: dimensions.error
      });
    }

    const dimensionMap = new Map<string, string>();
    for (const dim of dimensions.data ?? []) {
      if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
    }

    const amountsByLineId = new Map(
      calculatePurchasePostingAmounts({
        lines: purchaseInvoiceLines.data,
        exchangeRate: purchaseInvoice.data.exchangeRate ?? 1,
        supplierShippingCost:
          purchaseInvoiceDelivery.data.supplierShippingCost ?? 0
      }).map((amounts) => [amounts.id, amounts])
    );

    const itemIds = purchaseInvoiceLines.data.reduce<string[]>(
      (acc, invoiceLine) => {
        if (invoiceLine.itemId && !acc.includes(invoiceLine.itemId)) {
          acc.push(invoiceLine.itemId);
        }
        return acc;
      },
      []
    );

    const [items, itemCosts, purchaseOrderLines, supplier] = await inOrder([
      () =>
        many(
          db,
          "item",
          { id: itemIds, companyId },
          { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
        ),
      () =>
        many(
          db,
          "itemCost",
          { itemId: itemIds },
          { columns: ["itemId", "itemPostingGroupId", "costingMethod"] }
        ),
      () =>
        many(db, "purchaseOrderLine", {
          id: purchaseInvoiceLines.data.reduce<string[]>((acc, invoiceLine) => {
            if (
              invoiceLine.purchaseOrderLineId &&
              !acc.includes(invoiceLine.purchaseOrderLineId)
            ) {
              acc.push(invoiceLine.purchaseOrderLineId);
            }
            return acc;
          }, [])
        }),
      () =>
        single(db, "supplier", {
          id: purchaseInvoice.data?.supplierId ?? "",
          companyId
        })
    ]);
    if (items.error) throw new Error("Failed to fetch items");
    if (itemCosts.error) throw new Error("Failed to fetch item costs");
    if (purchaseOrderLines.error)
      throw new Error("Failed to fetch purchase order lines");
    if (supplier.error) throw new Error("Failed to fetch supplier");

    // Detect the buyer side of an intercompany transaction. The sister supplier
    // row carries intercompanyCompanyId when both companies belong to a group.
    // post-sales-invoice records the seller side; this records the buyer side,
    // so runIntercompanyMatching can pair them for consolidation.
    const isIntercompany = supplier.data.intercompanyCompanyId != null;
    const intercompanyPartnerId = isIntercompany
      ? supplier.data.intercompanyCompanyId
      : null;

    // Keep the existing pre-tax matching basis in the document currency named
    // on the trade. Supplier fields retain that denomination; generated unitPrice
    // and shippingCost are base and must not be labelled as document amounts.
    const intercompanyAmount = [...amountsByLineId.values()].reduce(
      (total, amounts) => total + amounts.intercompanyDocumentAmount,
      0
    );

    const purchaseOrders = await many(db, "purchaseOrder", {
      purchaseOrderId: purchaseOrderLines.data.reduce<string[]>(
        (acc, purchaseOrderLine) => {
          if (
            purchaseOrderLine.purchaseOrderId &&
            !acc.includes(purchaseOrderLine.purchaseOrderId)
          ) {
            acc.push(purchaseOrderLine.purchaseOrderId);
          }
          return acc;
        },
        []
      ),
      companyId
    });

    if (purchaseOrders.error)
      throw new Error("Failed to fetch purchase orders");

    const costLedgerInserts: Database["public"]["Tables"]["costLedger"]["Insert"][] =
      [];

    // A Construction in Progress asset records every posting that adds to its
    // acquisition cost as a CIP cost row. Written inside the transaction, after
    // the journal, so it can carry the journal id.
    const cipCostInserts: Omit<
      Database["public"]["Tables"]["fixedAssetCipCost"]["Insert"],
      "journalId"
    >[] = [];

    const processIdByJobOperationId = new Map<string, string>();
    {
      const jobOpIds = purchaseOrderLines.data
        .map((pol) => pol.jobOperationId)
        .filter((id): id is string => !!id);
      if (jobOpIds.length > 0) {
        const jobOps = await many(
          db,
          "jobOperation",
          { companyId, id: jobOpIds },
          { columns: ["id", "processId"] }
        );
        for (const op of jobOps.data ?? []) {
          if (op.processId) processIdByJobOperationId.set(op.id, op.processId);
        }
      }
    }

    const receiptLineInserts: Omit<
      Database["public"]["Tables"]["receiptLine"]["Insert"],
      "receiptId"
    >[] = [];

    const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
      [];

    const purchaseInvoiceLinesByPurchaseOrderLine =
      purchaseInvoiceLines.data.reduce<
        Record<
          string,
          Database["public"]["Tables"]["purchaseInvoiceLine"]["Row"]
        >
      >((acc, invoiceLine) => {
        if (invoiceLine.purchaseOrderLineId) {
          acc[invoiceLine.purchaseOrderLineId] = invoiceLine;
        }
        return acc;
      }, {});

    const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
      Record<
        string,
        Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
      >
    >((acc, purchaseOrderLine) => {
      const invoiceLine =
        purchaseInvoiceLinesByPurchaseOrderLine[purchaseOrderLine.id];
      if (
        invoiceLine &&
        invoiceLine.quantity &&
        purchaseOrderLine.purchaseQuantity &&
        purchaseOrderLine.purchaseQuantity > 0
      ) {
        const newQuantityInvoiced =
          (purchaseOrderLine.quantityInvoiced ?? 0) + invoiceLine.quantity;

        // Short-close aware: a line whose receiving was stopped is fully
        // invoiced once the received (not ordered) quantity is billed.
        const invoicedComplete =
          purchaseOrderLine.invoicedComplete ||
          invoiceLine.quantity >=
            getRemainingQuantityToInvoice(purchaseOrderLine);

        return {
          ...acc,
          [purchaseOrderLine.id]: {
            quantityInvoiced: newQuantityInvoiced,
            invoicedComplete,
            purchaseOrderId: purchaseOrderLine.purchaseOrderId
          }
        };
      }

      return acc;
    }, {});

    const receiptReferences = purchaseOrderLines.data.reduce<string[]>(
      (acc, purchaseOrderLine) => {
        if (
          (purchaseOrderLine.quantityReceived ?? 0) >
          (purchaseOrderLine.quantityInvoiced ?? 0)
        ) {
          acc.push(journalReference.to.receipt(purchaseOrderLine.id));
        }
        return acc;
      },
      []
    );
    const journalLines = await documentJournalLines(db, companyId, {
      documentLineReference: receiptReferences
    });

    const journalLinesByPurchaseOrderLine = journalLines.reduce<
      Record<string, Database["public"]["Tables"]["journalLine"]["Row"][]>
    >((acc, journalEntry) => {
      // A "receipt:" reference always carries the line id after the colon.
      const [type, purchaseOrderLineId] = (
        journalEntry.documentLineReference ?? ""
      ).split(":") as [string, string];
      if (type === "receipt") {
        if (
          acc[purchaseOrderLineId] &&
          Array.isArray(acc[purchaseOrderLineId])
        ) {
          acc[purchaseOrderLineId].push(journalEntry);
        } else {
          acc[purchaseOrderLineId] = [journalEntry];
        }
      }
      return acc;
    }, {});

    // Get account defaults (once for all lines)
    const accountDefaults = await getDefaultPostingGroup(db, companyId);
    if (accountDefaults.error || !accountDefaults.data) {
      throw new Error("Error getting account defaults");
    }

    // For IC transactions, book the payable to Inter-Company Payables instead of
    // regular AP — the mirror of post-sales-invoice's IC Receivables swap. Resolve
    // it from accountDefault (stable id), not by account number. An empty IC
    // default falls back to regular payables.
    const payables = isIntercompany
      ? resolveDefaultAccount(
          accountDefaults.data,
          "intercompanyPayablesAccount",
          postingStatus
        )
      : {
          accountId: accountDefaults.data.payablesAccount,
          accountDefaultRole: null
        };
    const payablesAccountId = payables.accountId;

    const purchaseOrderLineOf = (id: string | null) =>
      purchaseOrderLines.data.find((line) => line.id === id);
    const itemOf = (itemId: string | null): PurchaseInvoiceItem => {
      const item = items.data.find((row) => row.id === itemId);
      const itemCost = itemCosts.data.find((row) => row.itemId === itemId);
      return {
        itemId,
        itemTrackingType: item?.itemTrackingType ?? null,
        replenishmentSystem: item?.replenishmentSystem ?? null,
        itemPostingGroupId: itemCost?.itemPostingGroupId ?? null,
        // An item with no cost record posts as FIFO.
        costingMethod: itemCost?.costingMethod ?? "FIFO"
      };
    };
    /** A PO line's quantities, in inventory units. */
    const inventoryQuantities = (
      purchaseOrderLine:
        | Database["public"]["Tables"]["purchaseOrderLine"]["Row"]
        | undefined
    ) => ({
      quantityReceived:
        (purchaseOrderLine?.quantityReceived ?? 0) *
        (purchaseOrderLine?.conversionFactor ?? 1),
      quantityInvoiced:
        (purchaseOrderLine?.quantityInvoiced ?? 0) *
        (purchaseOrderLine?.conversionFactor ?? 1)
    });

    // The receipt layers a received line's variance may write up, read once
    // for the invoice: the layers of the line's item on the receipts of its
    // PO line, and the on-hand quantity of an item whose receipts wrote none.
    const layerLines = purchaseInvoiceLines.data.filter((invoiceLine) => {
      if (!isItemLineType(invoiceLine.invoiceLineType) || !invoiceLine.itemId) {
        return false;
      }
      const purchaseOrderLine = purchaseOrderLineOf(
        invoiceLine.purchaseOrderLineId
      );
      if (!purchaseOrderLine) return false;
      const { quantityReceived, quantityInvoiced } =
        inventoryQuantities(purchaseOrderLine);
      return (
        quantityReceived > quantityInvoiced &&
        usesReceiptLayers(
          itemOf(invoiceLine.itemId),
          !!purchaseOrderLine.jobOperationId
        )
      );
    });
    const receiptIdsByPurchaseOrderLine = new Map<string, Set<string>>();
    if (layerLines.length > 0) {
      const receiptLines = await selectRows(
        db,
        "receiptLine",
        {
          lineId: [
            ...new Set(
              layerLines.map((line) => line.purchaseOrderLineId as string)
            )
          ],
          companyId
        },
        { columns: ["lineId", "receiptId"] }
      );
      for (const { lineId, receiptId } of receiptLines) {
        if (!lineId || !receiptId) continue;
        const receiptIds = receiptIdsByPurchaseOrderLine.get(lineId);
        if (receiptIds) receiptIds.add(receiptId);
        else receiptIdsByPurchaseOrderLine.set(lineId, new Set([receiptId]));
      }
    }
    const layerReceiptIds = [
      ...new Set(
        [...receiptIdsByPurchaseOrderLine.values()].flatMap((ids) => [...ids])
      )
    ];
    const receiptLayers =
      layerReceiptIds.length > 0
        ? await selectRows(
            db,
            "costLedger",
            {
              documentType: "Purchase Receipt",
              documentId: layerReceiptIds,
              itemId: [
                ...new Set(layerLines.map((line) => line.itemId as string))
              ],
              adjustment: false,
              companyId
            },
            {
              columns: [
                "id",
                "documentId",
                "itemId",
                "quantity",
                "remainingQuantity"
              ],
              orderBy: ["postingDate", "createdAt"]
            }
          )
        : [];
    const layersByInvoiceLine = new Map(
      layerLines.map((invoiceLine) => {
        const receiptIds = receiptIdsByPurchaseOrderLine.get(
          invoiceLine.purchaseOrderLineId as string
        );
        return [
          invoiceLine.id,
          receiptLayers
            .filter(
              (layer) =>
                layer.itemId === invoiceLine.itemId &&
                !!layer.documentId &&
                !!receiptIds?.has(layer.documentId)
            )
            .map((layer) => ({
              id: layer.id,
              quantity: Number(layer.quantity),
              remainingQuantity: Number(layer.remainingQuantity ?? 0)
            }))
        ];
      })
    );
    const selfHealItemIds = [
      ...new Set(
        layerLines
          .filter((line) => layersByInvoiceLine.get(line.id)?.length === 0)
          .map((line) => line.itemId as string)
      )
    ];
    const onHand =
      selfHealItemIds.length > 0
        ? await db
            .selectFrom("itemLedger")
            .select((eb) => [
              "itemId",
              eb.fn.sum<number>("quantity").as("quantity")
            ])
            .where("itemId", "in", selfHealItemIds)
            .where("companyId", "=", companyId)
            .groupBy("itemId")
            .execute()
        : [];
    const onHandByItem = new Map(
      onHand.map((row) => [row.itemId, Number(row.quantity ?? 0)])
    );

    const glAccountIds = [
      ...new Set(
        purchaseInvoiceLines.data.flatMap((line) =>
          line.invoiceLineType === "G/L Account" && line.accountId
            ? [line.accountId]
            : []
        )
      )
    ];
    const glAccounts =
      glAccountIds.length > 0
        ? await selectRows(
            db,
            "account",
            { companyGroupId: companyGroupId!, id: glAccountIds },
            { columns: ["id", "name", "isGroup"] }
          )
        : [];

    type FixedAssetRow = Pick<
      rows.Tables["fixedAsset"]["Row"],
      | "id"
      | "status"
      | "acquisitionDate"
      | "depreciationStartDate"
      | "acquisitionCost"
      | "locationId"
      | "fixedAssetClassId"
    > & {
      fixedAssetClass: Pick<
        rows.Tables["fixedAssetClass"]["Row"],
        "assetAccountId" | "isConstructionInProgress"
      > | null;
    };
    const fixedAssetIds = [
      ...new Set(
        purchaseInvoiceLines.data.flatMap((line) =>
          line.invoiceLineType === "Fixed Asset" && line.assetId
            ? [line.assetId]
            : []
        )
      )
    ];
    const fixedAssets =
      fixedAssetIds.length > 0
        ? await selectRows<"fixedAsset", FixedAssetRow>(
            db,
            "fixedAsset",
            { companyId, id: fixedAssetIds },
            {
              columns: [
                "id",
                "status",
                "acquisitionDate",
                "depreciationStartDate",
                "acquisitionCost",
                "locationId",
                "fixedAssetClassId"
              ],
              embed: {
                fixedAssetClass: {
                  table: "fixedAssetClass",
                  via: "fixedAssetClassId",
                  columns: ["assetAccountId", "isConstructionInProgress"]
                }
              }
            }
          )
        : [];
    const fixedAssetById = new Map(
      fixedAssets.map((asset) => [asset.id, asset])
    );

    // Lease lines: the leases, payment rows and lease accounts they name.
    const leaseFacts = await loadLeasePostingFacts(db, {
      companyId,
      companyGroupId: companyGroupId!,
      defaults: accountDefaults.data,
      lines: purchaseInvoiceLines.data.filter(
        (line) => line.invoiceLineType === "Lease"
      )
    });

    // The facts of each line, in order. A line the journal cannot be built
    // from is refused here.
    const postingLines: PurchaseInvoicePostingLine[] = [];
    for (const invoiceLine of purchaseInvoiceLines.data) {
      if (invoiceLine.invoiceLineType === "Comment") continue;
      const base = {
        id: invoiceLine.id,
        invoiceLineType: invoiceLine.invoiceLineType,
        locationId: invoiceLine.locationId ?? null,
        amounts: amountsByLineId.get(invoiceLine.id)!
      };

      if (isItemLineType(invoiceLine.invoiceLineType)) {
        const item = itemOf(invoiceLine.itemId ?? null);
        if (invoiceLine.purchaseOrderLineId === null) {
          postingLines.push({
            ...base,
            kind: "direct",
            item,
            receivedWithInvoice: !skipReceiptPost
          });
          continue;
        }
        const purchaseOrderLine = purchaseOrderLineOf(
          invoiceLine.purchaseOrderLineId
        );
        postingLines.push({
          ...base,
          kind: "ordered",
          item,
          purchaseOrderLine: {
            purchaseOrderLineId: invoiceLine.purchaseOrderLineId,
            ...inventoryQuantities(purchaseOrderLine),
            receiptGroups: receiptGroups(
              journalLinesByPurchaseOrderLine[
                invoiceLine.purchaseOrderLineId
              ] ?? []
            ),
            isOutsideProcessing: !!purchaseOrderLine?.jobOperationId,
            processId: purchaseOrderLine?.jobOperationId
              ? (processIdByJobOperationId.get(
                  purchaseOrderLine.jobOperationId
                ) ?? null)
              : null,
            coverage: {
              receiptLayers: layersByInvoiceLine.get(invoiceLine.id) ?? [],
              onHandQuantity: invoiceLine.itemId
                ? (onHandByItem.get(invoiceLine.itemId) ?? 0)
                : 0
            }
          }
        });
        continue;
      }

      switch (invoiceLine.invoiceLineType) {
        case "Fixed Asset": {
          // Silently skipping would credit less to AP than the invoice total
          // the payment flow is allowed to apply against.
          if (!invoiceLine.assetId) {
            throw new Error(
              `Fixed Asset invoice line ${invoiceLine.id} has no asset selected`
            );
          }
          const purchaseOrderLine = purchaseOrderLineOf(
            invoiceLine.purchaseOrderLineId
          );
          const asset = fixedAssetById.get(invoiceLine.assetId);
          const wasReceived =
            !!invoiceLine.purchaseOrderLineId &&
            (purchaseOrderLine?.quantityReceived ?? 0) > 0;
          if (!wasReceived && !asset) {
            throw new Error("Failed to fetch fixed asset");
          }
          postingLines.push({
            ...base,
            kind: "fixedAsset",
            purchaseOrderLineId: invoiceLine.purchaseOrderLineId,
            purchaseOrderLineLocationId: purchaseOrderLine?.locationId ?? null,
            assetLocationId: asset?.locationId ?? null,
            fixedAssetClassId: asset?.fixedAssetClassId ?? null,
            acquisition: wasReceived
              ? {
                  receiptCost: fixedAssetReceiptCost(
                    journalLinesByPurchaseOrderLine[
                      invoiceLine.purchaseOrderLineId!
                    ] ?? []
                  )
                }
              : { assetAccountId: asset!.fixedAssetClass!.assetAccountId }
          });
          break;
        }
        case "G/L Account": {
          const account = glAccounts.find(
            (row) => row.id === invoiceLine.accountId
          );
          if (!account) throw new Error("Failed to fetch account");
          if (account.isGroup)
            throw new Error("Cannot post to a group account");
          postingLines.push({
            ...base,
            kind: "glAccount",
            purchaseOrderLineId: invoiceLine.purchaseOrderLineId,
            account,
            costCenterId: invoiceLine.costCenterId ?? null,
            projectId: invoiceLine.projectId ?? null
          });
          break;
        }
        case "Lease": {
          postingLines.push({
            ...base,
            kind: "lease",
            ...resolveLeasePostingLine(invoiceLine, base.amounts, leaseFacts)
          });
          break;
        }
        default:
          throw new Error("Unsupported invoice line type");
      }
    }

    const posting = buildPurchaseInvoicePostingLines({
      invoice: {
        id: purchaseInvoice.data.id,
        supplierId: purchaseInvoice.data.supplierId,
        supplierReference: purchaseInvoice.data.supplierReference
      },
      supplierTypeId: supplier.data.supplierTypeId ?? null,
      accounts: accountDefaults.data,
      payables,
      lines: postingLines
    });
    const journalLineInserts = posting.lines.map(
      ({ dimensions: _dimensions, ...line }) => ({ ...line, companyId })
    );

    // What the journal decided, written to the receipts, ledgers, layers
    // and fixed assets.
    for (const invoiceLine of purchaseInvoiceLines.data) {
      if (invoiceLine.invoiceLineType === "Comment") continue;
      const postingAmounts = amountsByLineId.get(invoiceLine.id)!;
      const {
        inventoryQuantity: invoiceLineQuantityInInventoryUnit,
        totalBaseCost: totalLineCostWithWeightedShipping,
        inventoryUnitCost: invoiceLineUnitCostInInventoryUnit
      } = postingAmounts;
      const received = posting.receivedVariances.get(invoiceLine.id);

      if (isItemLineType(invoiceLine.invoiceLineType)) {
        const item = items.data.find((item) => item.id === invoiceLine.itemId);
        const itemTrackingType = item?.itemTrackingType ?? "Inventory";

        postPurchaseInvoiceLogger.debug({
          invoiceLineItemId: invoiceLine.itemId,
          foundItem: item,
          itemTrackingType,
          requiresSerialTracking: itemTrackingType === "Serial",
          requiresBatchTracking: itemTrackingType === "Batch"
        });

        // With no PO line the invoice receives the part itself.
        if (invoiceLine.purchaseOrderLineId === null) {
          // Services are never received, so they must not materialize a
          // receipt document — only the expense + AP entries.
          if (invoiceLine.invoiceLineType !== "Service") {
            receiptLineInserts.push({
              itemId: invoiceLine.itemId!,
              lineId: invoiceLine.id,
              orderQuantity: invoiceLineQuantityInInventoryUnit,
              outstandingQuantity: invoiceLineQuantityInInventoryUnit,
              receivedQuantity: invoiceLineQuantityInInventoryUnit,
              locationId: invoiceLine.locationId,
              storageUnitId: invoiceLine.storageUnitId,
              unitOfMeasure: invoiceLine.inventoryUnitOfMeasureCode ?? "EA",
              unitPrice: invoiceLineUnitCostInInventoryUnit,
              requiresSerialTracking: itemTrackingType === "Serial",
              requiresBatchTracking: itemTrackingType === "Batch",
              createdBy: invoiceLine.createdBy,
              companyId
            });
          }

          // Only create item ledger entries if the receipt is being posted
          // (not when skipReceiptPost is true, as entries will be created when the receipt is posted later)
          if (itemTrackingType === "Inventory" && !skipReceiptPost) {
            itemLedgerInserts.push({
              postingDate: today,
              itemId: invoiceLine.itemId!,
              quantity: round(invoiceLineQuantityInInventoryUnit),
              locationId: invoiceLine.locationId,
              storageUnitId: invoiceLine.storageUnitId,
              entryType: "Positive Adjmt.",
              documentType: "Purchase Receipt",
              documentId: purchaseInvoice.data?.id ?? undefined,
              externalDocumentId:
                purchaseInvoice.data?.supplierReference ?? undefined,
              createdBy: userId,
              companyId
            });
          }

          // Services are never stocked — a cost ledger layer would pollute
          // inventory valuation, so only the journal entries apply.
          if (invoiceLine.invoiceLineType !== "Service") {
            costLedgerInserts.push({
              itemLedgerType: "Purchase",
              costLedgerType: "Direct Cost",
              adjustment: false,
              documentType: "Purchase Invoice",
              documentId: purchaseInvoice.data?.id ?? undefined,
              externalDocumentId:
                purchaseInvoice.data?.supplierReference ?? undefined,
              itemId: invoiceLine.itemId,
              quantity: round(invoiceLineQuantityInInventoryUnit),
              nominalCost: postingAmounts.nominalBaseCost,
              cost: round(totalLineCostWithWeightedShipping),
              remainingQuantity: round(invoiceLineQuantityInInventoryUnit),
              supplierId: purchaseInvoice.data?.supplierId,
              companyId,
              postingDate: today
            });
          }
          continue;
        }

        // The receipt is the sole creator of purchase cost layers; this
        // invoice adjusts the receipt's layers instead of creating its own.
        if (!received) continue;

        // Subledger: adjustment child rows on the covered layers, consumed
        // alongside their parent by calculateCOGS.
        for (const entry of received.allocation.perLayer) {
          costLedgerInserts.push({
            itemLedgerType: "Purchase",
            costLedgerType: "Direct Cost",
            adjustment: true,
            appliesToCostLedgerId: entry.costLedgerId,
            documentType: "Purchase Invoice",
            documentId: purchaseInvoice.data?.id ?? undefined,
            externalDocumentId:
              purchaseInvoice.data?.supplierReference ?? undefined,
            itemId: invoiceLine.itemId,
            quantity: round(entry.appliedQuantity),
            nominalCost: round(entry.adjustmentCost),
            cost: round(entry.adjustmentCost),
            remainingQuantity: round(entry.appliedQuantity),
            supplierId: purchaseInvoice.data?.supplierId,
            companyId,
            postingDate: today
          });
        }

        // Legacy self-heal: goods received before receipt-created layers
        // shipped. The layer only represents stock still on hand, at
        // receipt cost plus its share of the variance — the consumed
        // remainder's variance is PPV and must not become consumable
        // subledger value.
        const coveredQuantity = received.selfHealQuantity;
        if (coveredQuantity > 0) {
          const coverageRatio = coveredQuantity / received.quantity;
          costLedgerInserts.push({
            itemLedgerType: "Purchase",
            costLedgerType: "Direct Cost",
            adjustment: false,
            documentType: "Purchase Receipt",
            documentId: purchaseInvoice.data?.id ?? undefined,
            externalDocumentId:
              purchaseInvoice.data?.supplierReference ?? undefined,
            itemId: invoiceLine.itemId,
            quantity: round(coveredQuantity),
            nominalCost: round(
              coveredQuantity * invoiceLineUnitCostInInventoryUnit
            ),
            cost: round(
              received.receiptCost * coverageRatio +
                received.allocation.inventoryShare
            ),
            remainingQuantity: round(coveredQuantity),
            supplierId: purchaseInvoice.data?.supplierId,
            companyId,
            postingDate: today
          });
        }
        continue;
      }

      if (invoiceLine.invoiceLineType !== "Fixed Asset") continue;
      const assetId = invoiceLine.assetId!;
      const asset = fixedAssetById.get(assetId);

      if (received) {
        // Received: a variance changes the asset's acquisition cost.
        const { variance } = received;
        if (Math.abs(variance) > 0.005 && asset) {
          const assetRecord = fixedAssetWrites.overlay(assetId, {
            ...asset
          });
          fixedAssetWrites.patch(assetId, {
            acquisitionCost: Number(assetRecord.acquisitionCost) + variance,
            updatedBy: userId
          });

          if (asset.fixedAssetClass?.isConstructionInProgress) {
            cipCostInserts.push({
              fixedAssetId: assetId,
              sourceType: "Purchase Invoice",
              sourceDocumentId: invoiceId,
              sourceDocumentLineId: invoiceLine.id,
              amount: round(variance),
              costDate: today,
              companyId,
              createdBy: userId
            });
          }
        }
        continue;
      }

      // Direct invoice (no prior receipt) — full acquisition
      const assetRecord = fixedAssetWrites.overlay(assetId, { ...asset! });
      const isConstructionInProgress = Boolean(
        assetRecord.fixedAssetClass?.isConstructionInProgress
      );
      const updateData: Database["public"]["Tables"]["fixedAsset"]["Update"] = {
        acquisitionCost:
          (Number(assetRecord.acquisitionCost) ?? 0) +
          totalLineCostWithWeightedShipping,
        updatedBy: userId
      };
      if (!assetRecord.acquisitionDate) {
        updateData.acquisitionDate = today;
      }
      // A CIP asset does not depreciate until it is capitalized, so its
      // depreciation start date stays null and it goes Under Construction.
      if (!isConstructionInProgress && !assetRecord.depreciationStartDate) {
        updateData.depreciationStartDate = today;
      }
      if (assetRecord.status === "Draft") {
        updateData.status = isConstructionInProgress
          ? "Under Construction"
          : "Active";
      }

      if (invoiceLine.locationId) {
        updateData.locationId = invoiceLine.locationId;
      }

      fixedAssetWrites.patch(assetId, updateData);

      if (isConstructionInProgress) {
        cipCostInserts.push({
          fixedAssetId: assetId,
          sourceType: "Purchase Invoice",
          sourceDocumentId: invoiceId,
          sourceDocumentLineId: invoiceLine.id,
          amount: round(totalLineCostWithWeightedShipping),
          costDate: today,
          companyId,
          createdBy: userId
        });
      }
    }

    // A Provisional journal has no accounting period.
    const accountingPeriodId =
      postingStatus === "Posted"
        ? await getCurrentAccountingPeriod(companyId, db, today)
        : null;

    const createdReceiptIds: string[] = [];

    await db.transaction().execute(async (trx) => {
      await assertPostingStatusUnchanged(trx, companyId, postingStatus);
      await fixedAssetWrites.apply(trx, companyId);
      if (receiptLineInserts.length > 0) {
        const receiptLinesGroupedByLocationId = receiptLineInserts.reduce<
          Record<string, typeof receiptLineInserts>
        >((acc, line) => {
          if (line.locationId) {
            if (line.locationId in acc) {
              acc[line.locationId]!.push(line);
            } else {
              acc[line.locationId] = [line];
            }
          }

          return acc;
        }, {});

        for await (const [locationId, receiptLines] of Object.entries(
          receiptLinesGroupedByLocationId
        )) {
          const readableReceiptId = await getNextSequence(
            trx,
            "receipt",
            companyId
          );
          const receipt = await trx
            .insertInto("receipt")
            .values({
              receiptId: readableReceiptId,
              locationId,
              sourceDocument: "Purchase Invoice",
              sourceDocumentId: purchaseInvoice.data!.id,
              sourceDocumentReadableId: purchaseInvoice.data!.invoiceId,
              externalDocumentId: purchaseInvoice.data!.supplierReference,
              supplierId: purchaseInvoice.data!.supplierId,
              status: skipReceiptPost ? "Draft" : "Posted",
              postingDate: skipReceiptPost ? null : today,
              postedBy: skipReceiptPost ? null : userId,
              invoiced: true,
              companyId,
              createdBy: purchaseInvoice.data!.createdBy
            })
            .returning(["id"])
            .execute();

          const receiptId = receipt[0]!.id;
          if (!receiptId) throw new Error("Failed to insert receipt");
          createdReceiptIds.push(receiptId);

          await trx
            .insertInto("receiptLine")
            .values(
              receiptLines.map((r) => ({
                ...r,
                receiptId: receiptId
              }))
            )
            .returning(["id"])
            .execute();
        }
      }

      for await (const [purchaseOrderLineId, update] of Object.entries(
        purchaseOrderLineUpdates
      )) {
        await trx
          .updateTable("purchaseOrderLine")
          .set(update)
          .where("id", "=", purchaseOrderLineId)
          .where("companyId", "=", companyId)
          .execute();
      }

      const purchaseOrdersUpdated = Object.values(
        purchaseOrderLineUpdates
      ).reduce<string[]>((acc, update) => {
        if (update.purchaseOrderId && !acc.includes(update.purchaseOrderId)) {
          acc.push(update.purchaseOrderId);
        }
        return acc;
      }, []);

      for await (const purchaseOrderId of purchaseOrdersUpdated) {
        const purchaseOrderLines = await trx
          .selectFrom("purchaseOrderLine")
          .select([
            "id",
            "purchaseOrderLineType",
            "invoicedComplete",
            "receivedComplete"
          ])
          .where("purchaseOrderId", "=", purchaseOrderId)
          .execute();

        const areAllLinesInvoiced = purchaseOrderLines.every(
          (line) =>
            line.purchaseOrderLineType === "Comment" || line.invoicedComplete
        );

        const areAllLinesReceived = purchaseOrderLines.every(
          (line) =>
            line.purchaseOrderLineType === "Comment" ||
            line.purchaseOrderLineType === "G/L Account" ||
            line.purchaseOrderLineType === "Service" ||
            line.receivedComplete
        );

        let status: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
          "To Receive and Invoice";

        if (areAllLinesInvoiced && areAllLinesReceived) {
          status = "Completed";
        } else if (areAllLinesInvoiced) {
          status = "To Receive";
        } else if (areAllLinesReceived) {
          status = "To Invoice";
        }

        await trx
          .updateTable("purchaseOrder")
          .set({
            status
          })
          .where("id", "=", purchaseOrderId)
          .where("companyId", "=", companyId)
          .execute();
      }

      let invoiceJournalId: string | null = null;
      if (journalLineInserts.length > 0) {
        const journalEntryId = await getNextSequence(
          trx,
          "journalEntry",
          companyId
        );

        const journal = await trx
          .insertInto("journal")
          .values({
            journalEntryId,
            accountingPeriodId,
            description: `Purchase Invoice ${purchaseInvoice.data?.invoiceId}`,
            postingDate: today,
            companyId,
            sourceType: "Purchase Invoice",
            status: postingStatus,
            postedAt: datetime.timestamp(),
            postedBy: userId,
            createdBy: userId
          })
          .returning(["id"])
          .execute();

        const journalId = journal[0]!.id;
        if (!journalId) throw new Error("Failed to insert journal");
        invoiceJournalId = journalId;

        const journalLineResults = await trx
          .insertInto("journalLine")
          .values(
            journalLineInserts.map((journalLine) => ({
              ...journalLine,
              journalId
            }))
          )
          .returning(["id"])
          .execute();

        if (dimensionMap.size > 0) {
          const journalLineDimensionInserts = journalLineDimensionRows({
            journalLineIds: journalLineResults.map((line) => line.id),
            lines: posting.lines,
            dimensionIdByEntity: dimensionMap,
            companyId
          });

          if (journalLineDimensionInserts.length > 0) {
            await trx
              .insertInto("journalLineDimension")
              .values(journalLineDimensionInserts)
              .execute();
          }
        }

        // Record the buyer side of an intercompany transaction (mirrors the
        // seller-side insert in post-sales-invoice) so runIntercompanyMatching can
        // pair the two and generateEliminationEntries can eliminate them for
        // consolidated reporting. Uses the first journal line as the reference,
        // exactly as the sales side does.
        // Keep the first payable as the matching anchor while capturing every
        // actual payable row for elimination of multiline and split receipts.
        const icControlLines = isIntercompany
          ? classifyIntercompanyPostingLines(
              journalLineInserts.map((line, index) => ({
                ...line,
                id: journalLineResults[index]?.id ?? ""
              })),
              posting.lines.map((line) => ({
                itemId: line.dimensions.Item ?? null
              })),
              { controlAccountId: payablesAccountId }
            )
          : [];
        const icJournalLineId = icControlLines[0]?.journalLineId ?? null;
        if (
          isIntercompany &&
          intercompanyPartnerId &&
          companyGroupId &&
          icJournalLineId
        ) {
          const icTxn = await trx
            .insertInto("intercompanyTransaction")
            .values({
              companyGroupId,
              sourceCompanyId: companyId,
              targetCompanyId: intercompanyPartnerId,
              sourceJournalLineId: icJournalLineId,
              amount: round(intercompanyAmount),
              currencyCode: purchaseInvoice.data?.currencyCode ?? "USD",
              description: `Purchase Invoice ${purchaseInvoice.data?.invoiceId}`,
              documentType: "Invoice",
              documentId: purchaseInvoice.data?.id,
              status: "Unmatched"
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          // Capture the buyer side's role-classified elimination lines. The
          // profit the consolidation defers is embedded in whatever ASSET the
          // buyer capitalized the goods into — inventory OR a fixed asset — so
          // capture the buyer's actual capitalization account (not the seller's
          // inventory relief, which was the negative-Finished-Goods bug).
          const eliminationLineInserts: Database["public"]["Tables"]["intercompanyEliminationLine"]["Insert"][] =
            icControlLines.map((line) => ({
              ...line,
              companyId,
              intercompanyTransactionId: icTxn.id,
              createdBy: userId
            }));

          // Capitalization is any Asset-class DEBIT the buyer posted for the
          // goods — which excludes GR/IR clearing (a liability) and expensed
          // indirect cost by construction. It lands in two places: on THIS
          // invoice for not-yet-received / fixed-asset-at-invoice lines, and on
          // the linked RECEIPT posting for goods already received (the common
          // path — the invoice only trues up the price variance there).
          const poLineToItem = new Map<string, string | null>();
          for (const line of purchaseInvoiceLines.data) {
            if (line.purchaseOrderLineId)
              poLineToItem.set(line.purchaseOrderLineId, line.itemId ?? null);
          }
          const jlIdToItem = new Map<string, string | null>();
          journalLineResults.forEach((jl, index) => {
            jlIdToItem.set(
              jl.id,
              posting.lines[index]?.dimensions.Item ?? null
            );
          });

          // (i) inline capitalization on this invoice's journal
          const invoiceCapLines = await trx
            .selectFrom("journalLine as jl")
            .innerJoin("journal as j", (join) =>
              join
                .onRef("j.id", "=", "jl.journalId")
                .onRef("j.companyId", "=", "jl.companyId")
            )
            .innerJoin("account as a", "a.id", "jl.accountId")
            .select([
              "jl.id as id",
              "jl.accountId as accountId",
              "jl.amount as amount",
              "jl.quantity as quantity"
            ])
            .where("jl.journalId", "=", journalId)
            .where("jl.companyId", "=", companyId)
            .where("a.class", "=", "Asset")
            .where("jl.amount", ">", 0)
            .where("j.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
            .execute();
          for (const cap of invoiceCapLines) {
            eliminationLineInserts.push({
              companyId,
              intercompanyTransactionId: icTxn.id,
              role: "Capitalization",
              journalLineId: cap.id,
              accountId: cap.accountId!,
              amount: cap.amount ?? 0,
              itemId: jlIdToItem.get(cap.id) ?? null,
              quantity: cap.quantity ?? null,
              createdBy: userId
            });
          }

          // (ii) receipt capitalization (goods received before invoicing)
          const poLineIds = [...poLineToItem.keys()];
          if (poLineIds.length > 0) {
            const receiptLineRows = await trx
              .selectFrom("receiptLine")
              .select(["receiptId", "lineId"])
              .where("lineId", "in", poLineIds)
              .where("companyId", "=", companyId)
              .execute();
            const receiptIds = [
              ...new Set(
                receiptLineRows
                  .map((row) => row.receiptId)
                  .filter((id): id is string => !!id)
              )
            ];
            if (receiptIds.length > 0) {
              const receiptCapLines = await trx
                .selectFrom("journalLine as jl")
                .innerJoin("journal as j", (join) =>
                  join
                    .onRef("j.id", "=", "jl.journalId")
                    .onRef("j.companyId", "=", "jl.companyId")
                )
                .innerJoin("account as a", "a.id", "jl.accountId")
                .select([
                  "jl.id as id",
                  "jl.accountId as accountId",
                  "jl.amount as amount",
                  "jl.quantity as quantity",
                  "jl.documentLineReference as documentLineReference"
                ])
                .where("jl.companyId", "=", companyId)
                .where("jl.documentId", "in", receiptIds)
                .where("a.class", "=", "Asset")
                .where("jl.amount", ">", 0)
                .where("j.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
                .execute();
              for (const cap of receiptCapLines) {
                // documentLineReference is `receipt:<purchaseOrderLineId>`; map
                // it back to the item so on-hand realization can scale the
                // writedown. Fixed assets carry no item -> full deferral.
                let itemId: string | null = null;
                const ref = cap.documentLineReference ?? "";
                if (ref.startsWith("receipt:")) {
                  itemId =
                    poLineToItem.get(ref.slice("receipt:".length)) ?? null;
                }
                eliminationLineInserts.push({
                  companyId,
                  intercompanyTransactionId: icTxn.id,
                  role: "Capitalization",
                  journalLineId: cap.id,
                  accountId: cap.accountId!,
                  amount: cap.amount ?? 0,
                  itemId,
                  quantity: cap.quantity ?? null,
                  createdBy: userId
                });
              }
            }
          }

          if (eliminationLineInserts.length > 0) {
            await trx
              .insertInto("intercompanyEliminationLine")
              .values(eliminationLineInserts)
              .execute();
          }
        }
      }

      if (cipCostInserts.length > 0) {
        await trx
          .insertInto("fixedAssetCipCost")
          .values(
            cipCostInserts.map((row) => ({
              ...row,
              journalId: invoiceJournalId
            }))
          )
          .execute();
      }

      if (itemLedgerInserts.length > 0) {
        await trx
          .insertInto("itemLedger")
          .values(itemLedgerInserts)
          .returning(["id"])
          .execute();
      }

      if (costLedgerInserts.length > 0) {
        await trx
          .insertInto("costLedger")
          .values(costLedgerInserts)
          .returning(["id"])
          .execute();
      }

      // Posting keeps the supplier's dateIssued, so only fill dateDue when it
      // is empty — a manually entered due date from the supplier's invoice wins.
      // With no payment term the invoice still gets one, via Net 30.
      const paymentTerm =
        !purchaseInvoice.data?.dateDue && purchaseInvoice.data?.paymentTermId
          ? await trx
              .selectFrom("paymentTerm")
              .select(["daysDue", "calculationMethod"])
              .where("id", "=", purchaseInvoice.data.paymentTermId)
              .where("companyId", "=", companyId)
              .executeTakeFirst()
          : undefined;
      const dateDue = purchaseInvoice.data?.dateDue
        ? null
        : calculateDueDate(
            purchaseInvoice.data?.dateIssued ?? today,
            paymentTerm
          );

      await trx
        .updateTable("purchaseInvoice")
        .set({
          ...(dateDue ? { dateDue } : {}),
          postingDate: today,
          status: "Open"
        })
        .where("id", "=", invoiceId)
        .where("companyId", "=", companyId)
        .execute();
    });

    return {
      success: true,
      receiptIds: createdReceiptIds
    };
  } catch (err) {
    // A failed VOID leaves the invoice Posted: its rows still stand.
    if (type !== "void") {
      await updateRows(
        db,
        "purchaseInvoice",
        { status: "Draft" },
        { id: invoiceId, companyId }
      );
    }
    throw err;
  }
}
