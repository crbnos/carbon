// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { openai } from "@ai-sdk/openai";
import { InvalidInputError, NotFoundError } from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import type {
  CarbonError,
  ServiceContext
} from "@carbon/api/service-fn.server";
import { hasPermission } from "@carbon/auth";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable, getCompanyTimeZone } from "@carbon/database";
import { toBaseAmount } from "@carbon/database/accounting-currency";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  applyContractMovement,
  EMPTY_POSITION
} from "@carbon/database/contract-position";
import {
  type ContractRevenueRow,
  type ContractRevenueStatus,
  monthStart,
  planRevenueSchedule,
  type RevenuePlanLine,
  reconcileRevenueSchedule,
  validateRevenueEdit
} from "@carbon/database/contract-revenue-schedule";
import {
  amendmentEffectiveDate,
  type ContractLineTerms,
  type ContractPlannedInvoice,
  type ContractScheduleReconciliation,
  type ContractTerms,
  discountEndSplits,
  type ExistingRow,
  horizon,
  invoiceLinePricing,
  lastRecurringPeriodEnd,
  lineTotals,
  type PlannedRow,
  periodEndContaining,
  planInvoiceSchedule,
  reconcileContractSchedule,
  recurringValuePerPeriod,
  renewedEndDate,
  suggestAmendmentType,
  validateScheduleEdit
} from "@carbon/database/contract-schedule";
import type { OptionalDefaultRole } from "@carbon/database/journal-posting-status";
import {
  type AutomaticJournalStatus,
  journalPostingStatus,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import { toJson } from "@carbon/database/json";
import {
  assertBalanced,
  distributeRoundingResidual,
  equals
} from "@carbon/database/precision";
import { lockIssueDispositions } from "@carbon/database/quality";
import { monthEnd } from "@carbon/database/revenue-schedule";
import { getNextSequence } from "@carbon/database/sequence";
import { QuoteEmail } from "@carbon/documents/email";
import { getQuoteDisplayId } from "@carbon/documents/pdf";
import {
  dedupeViolations,
  evaluateSalesRuleLines,
  evaluateSalesRulesForSalesDocument,
  isBlocked,
  resolveSalesOrderShipTo
} from "@carbon/ee/rules.server";
import { storage, TEMP_STAGING_BUCKET } from "@carbon/files";
import { parseCsv } from "@carbon/files/csv";
import { trigger } from "@carbon/jobs";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { PickPartial, Violation } from "@carbon/utils";
import {
  billingHorizon,
  buildJournalLineDimensionInserts,
  buildLessorSchedule,
  type ClassificationInputs,
  certainPurchaseOption,
  classifyRentalLine,
  contractInvoiceHold,
  datetime,
  EPSILON,
  type ExistingBillingPeriod,
  earnsInterest,
  effectiveInvoiceAutomation,
  formatDate,
  formatPercent,
  generateRentalBillingPeriods,
  getSalesReturnOrderStatus,
  type InvoiceAutomation,
  type LeasePaymentTerms,
  type LessorClassification,
  type LessorScheduleLine,
  leasePaymentTerms,
  lineRevenueDates,
  type PeriodSpec,
  planRentalInvoices,
  type RentalBillingCycle,
  round,
  salesTypeRequirementError,
  searchFilter,
  suggestContractType,
  wholeRateUnits
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { FileObject } from "@supabase/storage-js";
import type {
  PostgrestError,
  PostgrestSingleResponse,
  SupabaseClient
} from "@supabase/supabase-js";
import { generateText, Output } from "ai";
import { type Selectable, sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { render } from "react-email";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  createDocumentUploadUrl,
  upsertDocument
} from "~/modules/documents/documents.service";
import { upsertPart } from "~/modules/items/items.service";
import { getSupplierPriceBreaksForItems } from "~/modules/items/items.utils";
import { getEmployeeJob } from "~/modules/people/people.service";
import {
  getCompany,
  getCompanySettings
} from "~/modules/settings/settings.service";
import { itemType as sellableItemTypes } from "~/modules/shared/shared.models";
import {
  bookAdjustment,
  createAdjustmentJournal,
  currencyDecimals,
  getCompanyTimeZone as getCachedCompanyTimeZone,
  getCurrentAccountingPeriod,
  refuseUnlessOwned,
  resolveInventoryAccount
} from "~/modules/shared/shared.service";
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
import * as productionPostings from "../production/production.service";
import type {
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator
} from "../shared/shared.models";
import { normalizeOperationSourceIds } from "../shared/shared.models";
import * as sharedPostings from "../shared/shared.service";
import {
  getModelByItemId,
  invokePosting,
  invokePostingOrThrow,
  upsertExternalLink
} from "../shared/shared.service";
import {
  lookupBuyPriceFromMap,
  resolveBuyUnitCost
} from "../shared/shared.utils";
import { updateSortOrder } from "../shared/sort-order";
import type {
  customerBankAccountValidator,
  customerContactValidator,
  customerContractInvoiceAutomationValidator,
  customerContractLineValidator,
  customerContractValidator,
  customerItemRentalRateValidator,
  customerPaymentValidator,
  customerShippingValidator,
  customerStatusValidator,
  customerTaxValidator,
  customerTypeValidator,
  customerValidator,
  getMethodValidator,
  itemRentalRateValidator,
  noQuoteReasonValidator,
  pricingRuleValidator,
  quoteLineAdditionalChargesValidator,
  quoteLineValidator,
  quoteMaterialValidator,
  quoteOperationValidator,
  quotePaymentValidator,
  quoteShipmentValidator,
  quoteStatusType,
  rentalAgreementChargeValidator,
  rentalAgreementInvoiceAutomationValidator,
  rentalAgreementLineValidator,
  rentalAgreementValidator,
  returnReasonValidator,
  salesOrderLineValidator,
  salesOrderPaymentValidator,
  salesOrderShipmentValidator,
  salesOrderStatusType,
  salesReturnOrderLineValidator,
  salesReturnOrderStatusType,
  salesRFQStatusType,
  salesRfqLineValidator,
  salesRfqValidator,
  selectedLinesValidator
} from "./sales.models";
import {
  contractEndDate,
  costCategoryKeys,
  type createContractFromSalesOrderValidator,
  isQuoteLocked,
  isSalesOrderLocked,
  OPEN_SALES_ORDER_STATUSES
} from "./sales.models";
import { renderSalesOrderPdf } from "./sales.pdf";
import type { CategoryMarkups, QuoteLinePriceSource } from "./sales.utils";
import {
  applyPriceRules,
  asConfiguration,
  configuredQuoteBasePrice,
  decideRecalcPricing,
  getDefaultRentalRates,
  getEffectiveDefaultMarkups,
  QUOTE_BASE_PRICE_SOURCES,
  resolvePreservedQuoteLinePriceFields,
  toMatchedRule,
  withBasePriceSource
} from "./sales.utils";
import type {
  OverrideEntry,
  PriceListResult,
  PriceListRow,
  PriceOverrideBreak,
  PriceResolutionInput,
  PriceResolutionResult,
  PriceSource,
  PriceTraceStep,
  Quotation,
  QuoteLinePriceTrace,
  SalesOrder,
  SalesRFQ
} from "./types";

const QUOTES_LIST_COLUMNS =
  "id,quoteId,revisionId,dueDate,expirationDate,status,salesPersonId,estimatorId,customerId,customerReference,assignee,customFields,companyId,createdAt,createdBy,updatedAt,updatedBy,thumbnailPath,itemType,locationName,lines,completedLines" as const;

const SALES_ORDERS_LIST_COLUMNS =
  "id,salesOrderId,status,orderDate,customerId,customerReference,assignee,companyId,customFields,createdAt,createdBy,updatedAt,updatedBy,locationId,displayStatus,thumbnailPath,itemType,orderTotal,jobs,lines,paymentTermId,shippingMethodId,receiptPromisedDate,dropShipment" as const;

const logger = getLogger("erp", "sales");

/** Not published: `sales.rfq.convert` gates and prices the quote too. */
export async function convertSalesRfqToQuote(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  payload: {
    id: string;
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, id } = payload;
  return invokePosting(
    { client, db, companyId, userId },
    "convert",
    {
      type: "salesRfqToQuote",
      id
    },
    sharedPostings.convertDocument,
    { as: sharedPostings.convertDocumentPermission }
  );
}

/** Not published: `sales.quote.convert` also gates and files the PDF. */
export async function convertQuoteToOrder(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  payload: {
    id: string;
    selectedLines: z.infer<typeof selectedLinesValidator>;
    companyId: string;
    purchaseOrderNumber?: string;
    userId: string;
    digitalQuoteAcceptedBy?: string;
    digitalQuoteAcceptedByEmail?: string;
  }
) {
  const { companyId, userId, ...input } = payload;
  const result = await invokePosting(
    { client, db, companyId, userId },
    "convert",
    {
      type: "quoteToSalesOrder",
      ...input
    },
    sharedPostings.convertDocument,
    { as: sharedPostings.convertDocumentPermission }
  );

  if (!result.error && result.data?.convertedId) {
    await raiseMoment("sales.quoteAccepted", {
      outputs: {
        quote: { id: payload.id },
        salesOrder: { id: result.data.convertedId }
      },
      companyId: payload.companyId,
      // A digital acceptance is the customer acting; `userId` is only the
      // employee who created the quote.
      actorId: payload.digitalQuoteAcceptedBy ? null : payload.userId
    });

    trackWorkEvent("quote_accepted", {
      companyId: payload.companyId,
      // Same reasoning as the moment above: on a digital acceptance there is
      // no Carbon user, so the event is anonymous rather than attributed to
      // whoever happened to write the quote.
      userId: payload.digitalQuoteAcceptedBy ? null : payload.userId,
      quoteId: payload.id,
      salesOrderId: result.data.convertedId,
      acceptedBy: payload.digitalQuoteAcceptedBy ? "portal" : "internal"
    });
  }

  return result;
}

export async function copyQuoteLine(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  payload: z.infer<typeof getMethodValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return invokePosting(
    { client, db, companyId: payload.companyId, userId: payload.userId },
    "get-method",
    {
      ...payload,
      type: "quoteLineToQuoteLine",
      parts: {
        billOfMaterial: payload.billOfMaterial,
        billOfProcess: payload.billOfProcess,
        parameters: payload.parameters,
        tools: payload.tools,
        steps: payload.steps,
        workInstructions: payload.workInstructions
      }
    },
    productionPostings.getMethod,
    { as: productionPostings.getMethodPermission }
  );
}

export async function copyQuote(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  payload: {
    /** The quote to copy. */
    sourceId: string;
    /** The same quote id for a new revision, "" for a new quote. */
    targetId: string;
    companyId: string;
    userId: string;
  }
) {
  return invokePosting(
    { client, db, companyId: payload.companyId, userId: payload.userId },
    "get-method",
    {
      ...payload,
      type: "quoteToQuote"
    },
    productionPostings.getMethod,
    { as: productionPostings.getMethodPermission }
  );
}

export async function createPricingRule(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  data: z.infer<typeof pricingRuleValidator>
) {
  const rule = normalizePricingRule(data);
  return client
    .from("pricingRule")
    .insert([
      {
        name: rule.name,
        ruleType: rule.ruleType,
        amountType: rule.amountType,
        amount: rule.amount,
        minQuantity: rule.minQuantity ?? null,
        maxQuantity: rule.maxQuantity ?? null,
        customerIds: rule.customerIds ?? [],
        customerTypeIds: rule.customerTypeIds ?? [],
        itemIds: rule.itemIds ?? [],
        itemPostingGroupId: rule.itemPostingGroupId ?? null,
        validFrom: rule.validFrom || null,
        validTo: rule.validTo || null,
        priority: rule.priority ?? 0,
        active: rule.active ?? true,
        configurationPrices: rule.configurationPrices ?? null,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();
}

// A Configuration rule is one configurable item's parameter prices and
// nothing else: its item comes from `itemId`, and it has no item group and
// no discount/markup amount. Any other rule type carries no configuration
// prices. A partial update that leaves `ruleType` alone is passed through.
function normalizePricingRule<
  T extends Partial<z.infer<typeof pricingRuleValidator>>
>(
  data: T
): Omit<T, "itemId" | "configurationPrices"> & {
  configurationPrices?: Json | null;
} {
  const { itemId, configurationPrices, ...rule } = data;
  if (rule.ruleType === undefined) {
    return configurationPrices === undefined
      ? rule
      : { ...rule, configurationPrices: configurationPrices as Json };
  }
  if (rule.ruleType !== "Configuration") {
    return { ...rule, configurationPrices: null };
  }
  const itemIds = itemId ? [itemId] : (rule.itemIds ?? []);
  const prices = (configurationPrices ?? []).filter(
    (price) => price.amount !== 0
  );
  return {
    ...rule,
    itemIds,
    itemPostingGroupId: undefined,
    amountType: "Fixed" as const,
    amount: 0,
    configurationPrices:
      itemIds.length === 1 && prices.length > 0 ? (prices as Json) : null
  };
}

export async function deleteCustomer(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client.from("customer").delete().eq("id", customerId);
}

export async function deleteCustomerBankAccount(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("customerBankAccount").delete().eq("id", id);
}

/**
 * Lists a customer's bank accounts.
 *
 * Gated on accounting, as the table's RLS and every bank-account screen are:
 * a changed payee account is how payment fraud starts.
 */
export async function getCustomerBankAccounts(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerBankAccount")
    .select("*")
    .eq("customerId", customerId)
    .order("name");
}

export async function upsertCustomerBankAccount(
  db: Kysely<KyselyDatabase>,
  bankAccount:
    | (Omit<z.infer<typeof customerBankAccountValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof customerBankAccountValidator>, "id"> & {
        id: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  const { customerId, companyId } = bankAccount;
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
      .insertInto("customerBankAccount")
      .values({
        ...fields,
        customerId,
        companyId,
        createdBy: bankAccount.createdBy
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  // customerId and companyId are scoping columns, not editable fields. They are
  // re-asserted in the WHERE clause so a forged form value cannot move this
  // row to another customer.
  return await db
    .updateTable("customerBankAccount")
    .set({
      ...fields,
      updatedBy: bankAccount.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .where("id", "=", bankAccount.id)
    .where("customerId", "=", customerId)
    .where("companyId", "=", companyId)
    .returning("id")
    .executeTakeFirstOrThrow();
}

export async function deleteCustomerContact(
  client: SupabaseClient<Database>,
  customerId: string,
  customerContactId: string
) {
  const customerContact = await client
    .from("customerContact")
    .select("contactId")
    .eq("customerId", customerId)
    .eq("id", customerContactId)
    .single();
  if (customerContact.data) {
    const contactDelete = await client
      .from("contact")
      .delete()
      .eq("id", customerContact.data.contactId);

    if (contactDelete.error) {
      return contactDelete;
    }
  }

  return customerContact;
}

export async function deleteCustomerLocation(
  client: SupabaseClient<Database>,
  customerId: string,
  customerLocationId: string
) {
  const { data: customerLocation } = await client
    .from("customerLocation")
    .select("addressId")
    .eq("customerId", customerId)
    .eq("id", customerLocationId)
    .single();

  if (customerLocation?.addressId) {
    return client.from("address").delete().eq("id", customerLocation.addressId);
  } else {
    // The customerLocation should always have an addressId, but just in case
    return client
      .from("customerLocation")
      .delete()
      .eq("customerId", customerId)
      .eq("id", customerLocationId);
  }
}

export async function deleteCustomerStatus(
  client: SupabaseClient<Database>,
  customerStatusId: string
) {
  return client.from("customerStatus").delete().eq("id", customerStatusId);
}

export async function deleteCustomerType(
  client: SupabaseClient<Database>,
  customerTypeId: string
) {
  return client.from("customerType").delete().eq("id", customerTypeId);
}

export async function deleteNoQuoteReason(
  client: SupabaseClient<Database>,
  noQuoteReasonId: string
) {
  return client.from("noQuoteReason").delete().eq("id", noQuoteReasonId);
}

export async function deletePricingRule(
  client: SupabaseClient<Database>,
  pricingRuleId: string
) {
  return client.from("pricingRule").delete().eq("id", pricingRuleId);
}

export async function deleteQuote(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quote").delete().eq("id", quoteId);
}

export async function deleteQuoteLine(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client.from("quoteLine").delete().eq("id", quoteLineId);
}

export async function deleteQuoteMaterial(
  client: SupabaseClient<Database>,
  quoteMaterialId: string
) {
  return client.from("quoteMaterial").delete().eq("id", quoteMaterialId);
}

/** Sets the unit cost of each of a quote line's materials in one statement. */
export async function updateQuoteMaterialUnitCosts(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  quoteLineId: string,
  costs: { id: string; unitCost: number }[]
) {
  if (costs.length === 0) return;
  const values = costs.map(
    (cost) => sql`(${cost.id}::text, ${cost.unitCost}::numeric)`
  );
  await sql`
    UPDATE "quoteMaterial" AS m
    SET "unitCost" = v."unitCost"
    FROM (VALUES ${sql.join(values)}) AS v("id", "unitCost")
    WHERE m."id" = v."id"
      AND m."companyId" = ${companyId}
      AND m."quoteLineId" = ${quoteLineId}
  `.execute(db);
}

export async function deleteQuoteOperationStep(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("quoteOperationStep").delete().eq("id", id);
}

export async function deleteQuoteOperationParameter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("quoteOperationParameter").delete().eq("id", id);
}

export async function deleteQuoteOperationTool(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("quoteOperationTool").delete().eq("id", id);
}

export async function deleteSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client.from("salesOrder").delete().eq("id", salesOrderId);
}

export async function deleteSalesOrderLine(
  client: SupabaseClient<Database>,
  salesOrderLineId: string
) {
  return client.from("salesOrderLine").delete().eq("id", salesOrderLineId);
}

export async function deleteSalesRFQ(
  client: SupabaseClient<Database>,
  salesRfqId: string
) {
  return client.from("salesRfq").delete().eq("id", salesRfqId);
}

export async function deleteSalesRFQLine(
  client: SupabaseClient<Database>,
  salesRFQLineId: string
) {
  return client.from("salesRfqLine").delete().eq("id", salesRFQLineId);
}

export async function duplicatePricingRule(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string,
  userId: string
) {
  const { data: original, error: fetchError } = await getPricingRule(
    client,
    id
  );
  if (fetchError || !original) return { data: null, error: fetchError };

  return client
    .from("pricingRule")
    .insert([
      {
        name: `Copy of ${original.name}`,
        ruleType: original.ruleType,
        amountType: original.amountType,
        amount: original.amount,
        minQuantity: original.minQuantity,
        maxQuantity: original.maxQuantity,
        customerIds: original.customerIds,
        customerTypeIds: original.customerTypeIds,
        itemIds: original.itemIds,
        itemPostingGroupId: original.itemPostingGroupId,
        validFrom: original.validFrom,
        validTo: original.validTo,
        priority: original.priority,
        configurationPrices: original.configurationPrices,
        active: false,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();
}

export async function getConfigurationParametersByQuoteLineId(
  client: SupabaseClient<Database>,
  quoteLineId: string,
  companyId: string
) {
  const quoteLine = await client
    .from("quoteLine")
    .select("itemId")
    .eq("id", quoteLineId)
    .single();

  if (quoteLine.error || !quoteLine.data) {
    return { groups: [], parameters: [] };
  }

  const [parameters, groups] = await Promise.all([
    client
      .from("configurationParameter")
      .select("*")
      .eq("itemId", quoteLine.data.itemId)
      .eq("companyId", companyId),
    client
      .from("configurationParameterGroup")
      .select("*")
      .eq("itemId", quoteLine.data.itemId)
      .eq("companyId", companyId)
  ]);

  if (parameters.error) {
    logger.error("Failed to get configuration parameters", {
      error: parameters.error
    });
    return { groups: [], parameters: [] };
  }

  if (groups.error) {
    logger.error("Failed to get configuration parameter groups", {
      error: groups.error
    });
    return { groups: [], parameters: [] };
  }

  return { groups: groups.data ?? [], parameters: parameters.data ?? [] };
}

export async function getCustomer(
  client: SupabaseClient<Database>,
  customerId: string,
  companyId?: string
) {
  let query = client.from("customers").select("*").eq("id", customerId);
  if (companyId) query = query.eq("companyId", companyId);
  return query.single();
}

export async function getCustomerContact(
  client: SupabaseClient<Database>,
  customerContactId: string,
  companyId?: string
) {
  let query = client
    .from("customerContact")
    .select(
      "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes)"
    )
    .eq("id", customerContactId);
  if (companyId) query = query.eq("companyId", companyId);
  return query.single();
}

export async function getCustomerContacts(
  client: SupabaseClient<Database>,
  customerId: string,
  companyId?: string
) {
  let query = client
    .from("customerContact")
    .select(
      "*, contact(id, fullName, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes), user(id, active)"
    )
    .eq("customerId", customerId);
  if (companyId) query = query.eq("companyId", companyId);
  return query;
}

export async function getCustomerItemPriceOverride(
  client: SupabaseClient<Database>,
  customerId: string,
  itemId: string,
  companyId: string,
  quantity: number = 1,
  date?: string
) {
  const { data, error } = await client
    .from("customerItemPriceOverride")
    .select(
      "*, breaks:customerItemPriceOverrideBreak(id, quantity, overridePrice, active)"
    )
    .eq("customerId", customerId)
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return { data: null, error };
  return { data: applyBreakToParent(data, quantity, date), error: null };
}

export async function getCustomerLocation(
  client: SupabaseClient<Database>,
  customerLocationId: string,
  companyId?: string
) {
  let query = client
    .from("customerLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, stateProvince, countryCode, country(alpha2, name), postalCode)"
    )
    .eq("id", customerLocationId);
  if (companyId) query = query.eq("companyId", companyId);
  return query.single();
}

export async function getCustomerLocations(
  client: SupabaseClient<Database>,
  customerId: string,
  companyId?: string
) {
  let query = client
    .from("customerLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, stateProvince, country(alpha2, name), postalCode)"
    )
    .eq("customerId", customerId);
  if (companyId) query = query.eq("companyId", companyId);
  return query;
}

export async function getCustomerPayment(
  client: SupabaseClient<Database>,
  customerId: string,
  companyId?: string
) {
  let query = client
    .from("customerPayment")
    .select("*")
    .eq("customerId", customerId);
  if (companyId) query = query.eq("companyId", companyId);
  return query.single();
}

export async function getCustomerShipping(
  client: SupabaseClient<Database>,
  customerId: string,
  companyId?: string
) {
  let query = client
    .from("customerShipping")
    .select("*")
    .eq("customerId", customerId);
  if (companyId) query = query.eq("companyId", companyId);
  return query.single();
}

export async function getCustomerTax(
  client: SupabaseClient<Database>,
  customerId: string,
  companyId?: string
) {
  let query = client
    .from("customerTax")
    .select("*")
    .eq("customerId", customerId);
  if (companyId) query = query.eq("companyId", companyId);
  return query.single();
}

export async function getCustomerTypeItemPriceOverride(
  client: SupabaseClient<Database>,
  customerTypeId: string,
  itemId: string,
  companyId: string,
  quantity: number = 1,
  date?: string
) {
  const { data, error } = await client
    .from("customerItemPriceOverride")
    .select(
      "*, breaks:customerItemPriceOverrideBreak(id, quantity, overridePrice, active)"
    )
    .eq("customerTypeId", customerTypeId)
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return { data: null, error };
  return { data: applyBreakToParent(data, quantity, date), error: null };
}

export async function getAllCustomersItemPriceOverride(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  quantity: number = 1,
  date?: string
) {
  const { data, error } = await client
    .from("customerItemPriceOverride")
    .select(
      "*, breaks:customerItemPriceOverrideBreak(id, quantity, overridePrice, active)"
    )
    .is("customerId", null)
    .is("customerTypeId", null)
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return { data: null, error };
  return { data: applyBreakToParent(data, quantity, date), error: null };
}

type AppliedOverride = {
  id: string;
  quantity: number;
  overridePrice: number;
  notes: string | null;
  validFrom: string | null;
  validTo: string | null;
  applyRulesOnTop: boolean;
};

// ignoreDateWindow=true is used by the catalog view; resolvePrice always
// enforces the date window.
function applyBreakToParent(
  parent: {
    id: string;
    notes: string | null;
    validFrom: string | null;
    validTo: string | null;
    applyRulesOnTop: boolean;
    breaks: unknown;
  },
  quantity: number,
  date?: string,
  ignoreDateWindow = false
): AppliedOverride | null {
  if (!ignoreDateWindow) {
    const today = date ?? new Date().toISOString().split("T")[0]!;
    if (parent.validFrom && parent.validFrom > today) return null;
    if (parent.validTo && parent.validTo < today) return null;
  }

  const raw = Array.isArray(parent.breaks)
    ? (parent.breaks as PriceOverrideBreak[])
    : [];
  // Inactive rungs are treated as if they don't exist so a toggled-off break
  // falls through to the next applicable rung (or the next scope in precedence).
  const active = raw.filter((b) => b.active !== false);
  const best = pickBestBreak(active, quantity);
  if (!best) return null;

  return {
    id: parent.id,
    quantity: best.quantity,
    overridePrice: best.overridePrice,
    notes: parent.notes,
    validFrom: parent.validFrom,
    validTo: parent.validTo,
    applyRulesOnTop: parent.applyRulesOnTop
  };
}

// Picks MAX(quantity) <= input. A break at quantity N only applies once the
// requested quantity reaches N; below the smallest rung, no override applies.
function pickBestBreak(
  breaks: PriceOverrideBreak[],
  quantity: number
): PriceOverrideBreak | null {
  let best: PriceOverrideBreak | null = null;
  for (const b of breaks) {
    if (b.quantity > quantity) continue;
    if (!best || b.quantity > best.quantity) best = b;
  }
  return best;
}

export async function getCustomers(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("customers")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getCustomersList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "customer", "id, name", (query) =>
    query.eq("companyId", companyId).order("name")
  );
}

export async function getCustomerStatus(
  client: SupabaseClient<Database>,
  customerStatusId: string
) {
  return client
    .from("customerStatus")
    .select("*")
    .eq("id", customerStatusId)
    .single();
}

export async function getCustomerStatuses(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("customerStatus")
    .select("id, name, customFields", { count: LIST_COUNT })
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

export async function getCustomerStatusesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("customerStatus")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getCustomerType(
  client: SupabaseClient<Database>,
  customerTypeId: string
) {
  return client
    .from("customerType")
    .select("*")
    .eq("id", customerTypeId)
    .single();
}

export async function getCustomerTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("customerType")
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

export async function getCustomerTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("customerType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getExternalSalesOrderLines(
  client: SupabaseClient<Database>,
  customerId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client.rpc(
    "get_sales_order_lines_by_customer_id",
    { customer_id: customerId },
    {
      count: LIST_COUNT
    }
  );

  if (args.search) {
    query = query.or(
      searchFilter(
        ["readableId", "customerReference", "salesOrderId"],
        args.search
      )
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "orderDate", ascending: true }
    ]);
  }

  return query;
}

export async function getModelByQuoteLineId(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  const quoteLine = await client
    .from("quoteLine")
    .select("itemId")
    .eq("id", quoteLineId)
    .single();

  if (!quoteLine.data) return null;

  return getModelByItemId(client, quoteLine.data.itemId);
}

export async function getNoQuoteReasonsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("noQuoteReason")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getNoQuoteReason(
  client: SupabaseClient<Database>,
  noQuoteReasonId: string
) {
  return client
    .from("noQuoteReason")
    .select("*")
    .eq("id", noQuoteReasonId)
    .single();
}

export async function getNoQuoteReasons(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("noQuoteReason")
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

export async function getOpportunity(
  client: SupabaseClient<Database>,
  opportunityId: string | null
): Promise<
  PostgrestSingleResponse<{
    id: string;
    companyId: string;
    purchaseOrderDocumentPath: string;
    requestForQuoteDocumentPath: string;
    salesRfqs: SalesRFQ[];
    quotes: Quotation[];
    salesOrders: SalesOrder[];
  } | null>
> {
  if (!opportunityId) {
    // @ts-expect-error
    return {
      data: null,
      error: null
    };
  }

  const response = await client.rpc("get_opportunity_with_related_records", {
    opportunity_id: opportunityId
  });

  return {
    data: response.data?.[0],
    error: response.error
  } as unknown as PostgrestSingleResponse<{
    id: string;
    companyId: string;
    purchaseOrderDocumentPath: string;
    requestForQuoteDocumentPath: string;
    salesRfqs: SalesRFQ[];
    quotes: Quotation[];
    salesOrders: SalesOrder[];
  }>;
}

export async function getOpportunityDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  opportunityId: string
) {
  const result = await storage(client)
    .company(companyId)
    .list(`${companyId}/opportunity/${opportunityId}`);

  if (result.error) {
    logger.error("Failed to list opportunity documents", {
      error: result.error
    });
    return [];
  }

  return result.data.map((f) => ({
    ...f,
    bucket: "opportunity"
  }));
}

export async function getOpportunityLineDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  lineId: string,
  itemId?: string | null
) {
  const [opportunityLineResult, itemResult] = await Promise.all([
    storage(client)
      .company(companyId)
      .list(`${companyId}/opportunity-line/${lineId}`),
    itemId
      ? storage(client).company(companyId).list(`${companyId}/parts/${itemId}`)
      : Promise.resolve({ data: [] as FileObject[], error: null })
  ]);

  if (opportunityLineResult.error) {
    logger.error("Failed to list opportunity line documents", {
      error: opportunityLineResult.error
    });
  }
  if (itemResult.error) {
    logger.error("Failed to list item documents", {
      error: itemResult.error
    });
  }

  const opportunityLineDocs = (opportunityLineResult.data ?? []).map((f) => ({
    ...f,
    bucket: "opportunity-line"
  }));
  const itemDocs = (itemResult.data ?? []).map((f) => ({
    ...f,
    bucket: "parts"
  }));

  return [...opportunityLineDocs, ...itemDocs];
}

export async function getPricingRule(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("pricingRule").select("*").eq("id", id).single();
}

export async function getPricingRules(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search?: string }
) {
  let query = client
    .from("pricingRule")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args);
  }

  return query;
}

export const priceSourceTypes = [
  "Base",
  "Override",
  "Type Override",
  "All Override",
  "Rule"
] as const;

export async function getQuote(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quotes").select("*").eq("id", quoteId).single();
}

export async function getQuotes(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("quotes")
    .select(QUOTES_LIST_COLUMNS, { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      searchFilter(["quoteId", "customerReference"], args.search)
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "quoteId", ascending: false }
  ]);
  return query;
}

export async function getQuotesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    quoteId: string;
    revisionId: string;
  }>(client, "quote", "id, quoteId, revisionId", (query) =>
    query.eq("companyId", companyId).order("createdAt", { ascending: false })
  );
}

export async function getQuoteAssemblies(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quoteMakeMethod").select("*").eq("quoteId", quoteId);
}

export async function getQuoteCustomerDetails(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client
    .from("quoteCustomerDetails")
    .select("*")
    .eq("quoteId", quoteId)
    .single();
}

export async function getQuoteLine(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client.from("quoteLines").select("*").eq("id", quoteLineId).single();
}

export async function getQuoteLinesList(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client
    .from("quoteLine")
    .select("id, description, ...item(readableIdWithRevision)")
    .eq("quoteId", quoteId);
}

type QuoteMethod = NonNullable<
  Awaited<ReturnType<typeof getQuoteMethodTreeArray>>["data"]
>[number];
type QuoteMethodTreeItem = {
  id: string;
  data: QuoteMethod;
  children: QuoteMethodTreeItem[];
};

export async function getQuoteMakeMethod(
  client: SupabaseClient<Database>,
  quoteMakeMethodId: string
) {
  return client
    .from("quoteMakeMethod")
    .select("*, ...item(itemType:type)")
    .eq("id", quoteMakeMethodId)
    .single();
}

export async function getRootQuoteMakeMethod(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client
    .from("quoteMakeMethod")
    .select("*, ...item(itemType:type)")
    .eq("quoteLineId", quoteLineId)
    .is("parentMaterialId", null)
    .single();
}

export async function getQuoteMethodTrees(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  const items = await getQuoteMethodTreeArray(client, quoteId);
  if (items.error) return items;

  const tree = getQuoteMethodTreeArrayToTree(items.data);

  return {
    data: tree,
    error: null
  };
}

export async function getQuoteMethodTreeArray(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.rpc("get_quote_methods", {
    qid: quoteId
  });
}

function getQuoteMethodTreeArrayToTree(
  items: QuoteMethod[]
): QuoteMethodTreeItem[] {
  // function traverseAndRenameIds(node: QuoteMethodTreeItem) {
  //   const clone = structuredClone(node);
  //   clone.id = `node-${Math.random().toString(16).slice(2)}`;
  //   clone.children = clone.children.map((n) => traverseAndRenameIds(n));
  //   return clone;
  // }

  const rootItems: QuoteMethodTreeItem[] = [];
  const lookup: { [id: string]: QuoteMethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-expect-error
      lookup[itemId] = { id: itemId, children: [] };
    }

    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-expect-error
        lookup[parentId] = { id: parentId, children: [] };
      }

      // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
      lookup[parentId]["children"].push(treeItem);
    }
  }
  return rootItems;
  // return rootItems.map((item) => traverseAndRenameIds(item));
}

export async function getQuoteByExternalId(
  client: SupabaseClient<Database>,
  externalId: string
) {
  return client
    .from("quote")
    .select("*")
    .eq("externalLinkId", externalId)
    .single();
}

export async function getQuoteLinePrices(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteLineId", quoteLineId);
}

export async function getQuoteLinePricesByItemId(
  client: SupabaseClient<Database>,
  itemId: string,
  currentQuoteId: string
) {
  return client
    .from("quoteLinePrices")
    .select("*")
    .eq("itemId", itemId)
    .neq("quoteId", currentQuoteId)
    .order("quoteCreatedAt", { ascending: false })
    .order("qty", { ascending: true });
}

export async function getQuoteLinePricesByItemIds(
  client: SupabaseClient<Database>,
  itemIds: string[],
  currentQuoteId: string
) {
  return client
    .from("quoteLinePrices")
    .select("*")
    .in("itemId", itemIds)
    .neq("quoteId", currentQuoteId)
    .order("quoteCreatedAt", { ascending: false })
    .order("qty", { ascending: true })
    .limit(10);
}

export async function getQuoteMaterial(
  client: SupabaseClient<Database>,
  materialId: string
) {
  return client
    .from("quoteMaterialWithMakeMethodId")
    .select("*")
    .eq("id", materialId)
    .single();
}

export async function getQuoteMaterialsByLine(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client
    .from("quoteMaterial")
    .select("*")
    .eq("quoteLineId", quoteLineId);
}

export async function getQuoteMaterialsByMethodId(
  client: SupabaseClient<Database>,
  quoteMakeMethodId: string
) {
  return client
    .from("quoteMaterial")
    .select("*, item(name, itemTrackingType, replenishmentSystem)")
    .eq("quoteMakeMethodId", quoteMakeMethodId)
    .order("order", { ascending: true });
}

export async function getQuoteMaterialsByOperation(
  client: SupabaseClient<Database>,
  quoteOperationId: string
) {
  return client
    .from("quoteMaterial")
    .select("*")
    .eq("quoteOperationId", quoteOperationId);
}

export async function getQuoteOperation(
  client: SupabaseClient<Database>,
  quoteOperationId: string
) {
  return client
    .from("quoteOperation")
    .select("*")
    .eq("id", quoteOperationId)
    .single();
}

export async function getQuoteOperationsByLine(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client
    .from("quoteOperation")
    .select("*")
    .eq("quoteLineId", quoteLineId);
}

export async function getQuoteOperationsByMethodId(
  client: SupabaseClient<Database>,
  quoteMakeMethodId: string
) {
  return client
    .from("quoteOperation")
    .select(
      "*, quoteOperationTool(*), quoteOperationParameter(*), quoteOperationStep(*)"
    )
    .eq("quoteMakeMethodId", quoteMakeMethodId)
    .order("order", { ascending: true });
}

export async function getQuotePayment(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quotePayment").select("*").eq("id", quoteId).single();
}

export async function getQuoteShipment(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quoteShipment").select("*").eq("id", quoteId).single();
}

export async function getRelatedPricesForQuoteLine(
  client: SupabaseClient<Database>,
  itemId: string,
  quoteId: string
) {
  const item = await client
    .rpc("get_part_details", {
      item_id: itemId
    })
    .single();

  const itemIds = (item.data?.revisions as { id: string }[])?.map(
    (revision) => revision.id
  ) ?? [itemId];

  const [historicalQuoteLinePrices, relatedSalesOrderLines] = await Promise.all(
    [
      getQuoteLinePricesByItemIds(client, itemIds, quoteId),
      getSalesOrderLinesByItemIds(client, itemIds)
    ]
  );

  return {
    historicalQuoteLinePrices: historicalQuoteLinePrices.data,
    relatedSalesOrderLines: relatedSalesOrderLines.data
  };
}

export async function getSalesDocumentsAssignedToMe(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  const [salesOrders, quotes, rfqs] = await Promise.all([
    client
      .from("salesOrder")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId),
    client
      .from("quote")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId),
    client
      .from("salesRfq")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId)
  ]);

  const merged = [
    ...(salesOrders.data?.map((doc) => ({ ...doc, type: "salesOrder" })) ?? []),
    ...(quotes.data?.map((doc) => ({ ...doc, type: "quote" })) ?? []),
    ...(rfqs.data?.map((doc) => ({ ...doc, type: "rfq" })) ?? [])
  ].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  return merged;
}

export async function getSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client.from("salesOrders").select("*").eq("id", salesOrderId).single();
}

export async function getSalesOrderCustomerDetails(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client
    .from("salesOrderLocations")
    .select("*")
    .eq("id", salesOrderId)
    .single();
}

export async function getSalesOrderRelatedItems(
  client: SupabaseClient<Database>,
  salesOrderId: string,
  opportunityId: string
) {
  const [jobs, shipments, invoices, returnOrders, lineLinkedReturns] =
    await Promise.all([
      client.from("job").select("*").eq("salesOrderId", salesOrderId),
      client
        .from("shipment")
        .select("*, shipmentLine(*)")
        .eq("opportunityId", opportunityId),
      client
        .from("salesInvoice")
        .select("id, invoiceId, status")
        .eq("opportunityId", opportunityId),
      // RMAs linked at the header level
      client
        .from("salesReturnOrder")
        .select("id, salesReturnOrderId, status")
        .eq("salesOrderId", salesOrderId),
      // RMAs linked only through their lines (salesOrderLineId provenance)
      client
        .from("salesReturnOrderLine")
        .select(
          "salesReturnOrder!salesReturnOrderLine_salesReturnOrderId_fkey(id, salesReturnOrderId, status), salesOrderLine!inner(salesOrderId)"
        )
        .eq("salesOrderLine.salesOrderId", salesOrderId)
    ]);

  // Union of header-linked and line-linked, de-duplicated by id
  const returnsById = new Map<
    string,
    { id: string; salesReturnOrderId: string; status: string }
  >();
  for (const row of returnOrders.data ?? []) {
    returnsById.set(row.id, row);
  }
  for (const row of lineLinkedReturns.data ?? []) {
    const order = row.salesReturnOrder;
    if (order) returnsById.set(order.id, order);
  }

  return {
    jobs: jobs.data ?? [],
    shipments: shipments.data ?? [],
    invoices: invoices.data ?? [],
    salesReturnOrders: Array.from(returnsById.values())
  };
}

export async function getSalesOrders(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: string | null;
    customerId: string | null;
  }
) {
  let query = client
    .from("salesOrders")
    .select(SALES_ORDERS_LIST_COLUMNS, { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      searchFilter(["salesOrderId", "customerReference"], args.search)
    );
  }

  if (args.customerId) {
    query = query.eq("customerId", args.customerId);
  }

  if (args.status) {
    query = query.eq("status", args.status as never);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);

  return query;
}

export async function getSalesOrdersList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    salesOrderId: string;
  }>(client, "salesOrder", "id, salesOrderId", (query) =>
    query.eq("companyId", companyId)
  );
}

export async function getSalesOrderPayment(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client
    .from("salesOrderPayment")
    .select("*")
    .eq("id", salesOrderId)
    .single();
}

export async function getSalesTerms(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("terms").select("salesTerms").eq("id", companyId).single();
}

export async function getSalesOrderShipment(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client
    .from("salesOrderShipment")
    .select("*")
    .eq("id", salesOrderId)
    .single();
}

export async function getSalesOrderCustomers(client: SupabaseClient<Database>) {
  return client.from("salesOrderCustomers").select("id, name");
}

export async function getSalesOrderLines(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client
    .from("salesOrderLines")
    .select("*")
    .eq("salesOrderId", salesOrderId)
    .order("sortOrder", { ascending: true })
    .order("itemReadableId", { ascending: true });
}

export async function getSalesOrderInvoiceLines(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client
    .from("salesInvoiceLine")
    .select("invoiceId")
    .eq("salesOrderId", salesOrderId);
}

export async function getSalesOrderInvoicesByIds(
  client: SupabaseClient<Database>,
  invoiceIds: string[]
) {
  return client
    .from("salesInvoices")
    .select("id, invoiceTotal, balance, status, currencyCode, exchangeRate")
    .in("id", invoiceIds);
}

export async function getSalesOrderInvoicePaymentsByIds(
  client: SupabaseClient<Database>,
  companyId: string,
  invoiceIds: string[]
) {
  return fetchAllFromTable<{
    targetSalesInvoiceId: string | null;
    appliedAmount: number;
    payment: { status: string } | null;
  }>(
    client,
    "invoiceSettlement",
    "targetSalesInvoiceId, appliedAmount, payment:payment!invoiceSettlement_paymentId_fkey!inner(status)",
    (query) =>
      query
        .eq("companyId", companyId)
        .eq("payment.companyId", companyId)
        .eq("payment.status", "Posted")
        .in("targetSalesInvoiceId", invoiceIds)
        .order("id")
  );
}

export async function getSalesOrderLinesByItemId(
  client: SupabaseClient<Database>,
  itemId: string
) {
  return client
    .from("salesOrderLines")
    .select("*")
    .eq("itemId", itemId)
    .order("orderDate", { ascending: false })
    .order("createdAt", { ascending: false });
}

/**
 * Sales order lines eligible for a job to link to: lines whose item matches the
 * job's item, on sales orders that are still open (not Completed/Invoiced/
 * Cancelled/Closed). Joins the base salesOrder header so we can filter on its
 * status (the salesOrderLines view only exposes the line-level status).
 */
export async function getOpenSalesOrderLinesForItem(
  client: SupabaseClient<Database>,
  companyId: string,
  itemId: string
) {
  return client
    .from("salesOrderLine")
    .select(
      "id, saleQuantity, salesOrderLineType, salesOrder!inner(id, salesOrderId, customerId, status)"
    )
    .eq("companyId", companyId)
    .eq("itemId", itemId)
    .in("salesOrder.status", [...OPEN_SALES_ORDER_STATUSES])
    .order("createdAt", { ascending: false });
}

export async function getSalesOrderLinesByItemIds(
  client: SupabaseClient<Database>,
  itemIds: string[]
) {
  return client
    .from("salesOrderLines")
    .select("*")
    .in("itemId", itemIds)
    .order("orderDate", { ascending: false })
    .order("createdAt", { ascending: false })
    .limit(10);
}

export async function getSalesOrderLine(
  client: SupabaseClient<Database>,
  salesOrderLineId: string
) {
  return client
    .from("salesOrderLines")
    .select("*")
    .eq("id", salesOrderLineId)
    .single();
}

export async function getSalesOrderLineShipments(
  client: SupabaseClient<Database>,
  salesOrderLineId: string
) {
  return client
    .from("shipmentLine")
    .select("*, shipment(*), storageUnit(id, name)")
    .eq("lineId", salesOrderLineId)
    .gt("shippedQuantity", 0);
}

export async function getSalesRFQ(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("salesRfqs").select("*").eq("id", id).single();
}

export async function getSalesRFQs(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("salesRfqs")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(searchFilter(["rfqId", "customerReference"], args.search));
  }

  query = setGenericQueryFilters(query, args, [
    { column: "rfqId", ascending: false }
  ]);
  return query;
}

export async function getSalesRFQLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client.from("salesRfqLines").select("*").eq("id", lineId).single();
}

export async function getSalesRFQLines(
  client: SupabaseClient<Database>,
  salesRfqId: string
) {
  return client
    .from("salesRfqLines")
    .select("*")
    .eq("salesRfqId", salesRfqId)
    .order("order", { ascending: true })
    .order("customerPartId", { ascending: true });
}

export async function insertCustomerContact(
  client: SupabaseClient<Database>,
  customerContact: {
    customerId: string;
    companyId: string;
    contact: PickPartial<z.infer<typeof customerContactValidator>, "email">;
    customerLocationId?: string;
    customFields?: Json;
  }
) {
  const insertContact = await client
    .from("contact")
    .insert([
      {
        ...customerContact.contact,
        isCustomer: true,
        companyId: customerContact.companyId
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
    .from("customerContact")
    .insert([
      {
        customerId: customerContact.customerId,
        contactId,
        customerLocationId: customerContact.customerLocationId,
        companyId: customerContact.companyId,
        customFields: customerContact.customFields
      }
    ])
    .select("id")
    .single();
}

export async function insertCustomerLocation(
  client: SupabaseClient<Database>,
  customerLocation: {
    customerId: string;
    companyId: string;
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
  const insertAddress = await client
    .from("address")
    .insert([
      { ...customerLocation.address, companyId: customerLocation.companyId }
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
    .from("customerLocation")
    .insert([
      {
        customerId: customerLocation.customerId,
        addressId,
        name: customerLocation.name,
        companyId: customerLocation.companyId,
        customFields: customerLocation.customFields
      }
    ])
    .select("id")
    .single();
}

/** Not published: `sales.quote.finalize` also gates, links and files the PDF. */
export async function finalizeQuote(
  client: SupabaseClient<Database>,
  quoteId: string,
  userId: string,
  companyId: string
) {
  const quoteUpdate = await client
    .from("quote")
    .update({
      status: "Sent",
      updatedAt: datetime.timestamp(),
      updatedBy: userId
    })
    .eq("id", quoteId);

  if (quoteUpdate.error) {
    return quoteUpdate;
  }

  const lineUpdate = await client
    .from("quoteLine")
    .update({
      status: "Complete",
      updatedAt: datetime.timestamp(),
      updatedBy: userId
    })
    .neq("status", "No Quote")
    .eq("quoteId", quoteId);

  // Gated on the quote reaching 'Sent' (the early return above), not on the
  // line write — a zero-line quote is still sent.
  await raiseMoment("sales.quoteSent", {
    outputs: { quote: { id: quoteId }, sentBy: { id: userId } },
    companyId,
    actorId: userId
  });

  // finalizeQuote is the only writer of status 'Sent', and it is also the MCP
  // write path, so this one capture covers API callers too.
  trackWorkEvent("quote_sent", { companyId, userId, quoteId });

  return lineUpdate;
}

export async function resolvePrice(
  client: SupabaseClient<Database>,
  companyId: string,
  input: PriceResolutionInput
): Promise<PriceResolutionResult> {
  const date =
    input.date ??
    datetime.today(await getCompanyTimeZone(client, companyId)).toString();
  const trace: PriceTraceStep[] = [];

  let resolvedCustomerTypeId = input.customerTypeId ?? null;

  if (input.customerId && !resolvedCustomerTypeId) {
    const { data: cust } = await client
      .from("customer")
      .select("customerTypeId")
      .eq("id", input.customerId)
      .maybeSingle();
    resolvedCustomerTypeId = cust?.customerTypeId ?? null;
  }

  // Pull posting group from itemCost so we can match rules scoped to
  // itemPostingGroupId.
  let resolvedItemPostingGroupId = input.itemPostingGroupId ?? null;
  if (!resolvedItemPostingGroupId) {
    const { data: costRow } = await client
      .from("itemCost")
      .select("itemPostingGroupId")
      .eq("itemId", input.itemId)
      .eq("companyId", companyId)
      .maybeSingle();
    resolvedItemPostingGroupId = costRow?.itemPostingGroupId ?? null;
  }

  let basePrice: number;
  if (input.existingBasePrice !== undefined) {
    basePrice = input.existingBasePrice;
  } else {
    const { data: salePrice } = await client
      .from("itemUnitSalePrice")
      .select("unitSalePrice")
      .eq("itemId", input.itemId)
      .maybeSingle();
    basePrice = salePrice?.unitSalePrice ?? 0;
  }

  trace.push({
    step: "Base Price",
    source: "Item Unit Sale Price",
    amount: basePrice
  });

  // Precedence: customer > type > all-customers > base. We commit to the
  // first scope that yields any rung and do not cross-shop.
  let startingPrice = basePrice;
  let overrideApplied = false;
  let skipRules = false;

  if (input.customerId) {
    const { data: override } = await getCustomerItemPriceOverride(
      client,
      input.customerId,
      input.itemId,
      companyId,
      input.quantity,
      date
    );

    if (override) {
      startingPrice = override.overridePrice;
      overrideApplied = true;
      skipRules = override.applyRulesOnTop === false;
      trace.push({
        step: "Override",
        source: override.notes
          ? `Customer Price Override: ${override.notes}`
          : "Customer Price Override",
        amount: override.overridePrice,
        adjustment: override.overridePrice - basePrice
      });
    }
  }

  if (!overrideApplied && resolvedCustomerTypeId) {
    const { data: typeOverride } = await getCustomerTypeItemPriceOverride(
      client,
      resolvedCustomerTypeId,
      input.itemId,
      companyId,
      input.quantity,
      date
    );

    if (typeOverride) {
      startingPrice = typeOverride.overridePrice;
      overrideApplied = true;
      skipRules = typeOverride.applyRulesOnTop === false;
      trace.push({
        step: "Type Override",
        source: typeOverride.notes
          ? `Customer Type Override: ${typeOverride.notes}`
          : "Customer Type Override",
        amount: typeOverride.overridePrice,
        adjustment: typeOverride.overridePrice - basePrice
      });
    }
  }

  if (!overrideApplied) {
    const { data: allOverride } = await getAllCustomersItemPriceOverride(
      client,
      input.itemId,
      companyId,
      input.quantity,
      date
    );

    if (allOverride) {
      startingPrice = allOverride.overridePrice;
      overrideApplied = true;
      skipRules = allOverride.applyRulesOnTop === false;
      trace.push({
        step: "All Override",
        source: allOverride.notes
          ? `All Customers Override: ${allOverride.notes}`
          : "All Customers Override",
        amount: allOverride.overridePrice,
        adjustment: allOverride.overridePrice - basePrice
      });
    }
  }

  // An override that skips the rules still takes the line's configuration
  // prices — they price the chosen options, not the part.
  let finalPrice = startingPrice;
  if (!skipRules || input.configuration) {
    let rulesQuery = client
      .from("pricingRule")
      .select("*")
      .eq("companyId", companyId)
      .eq("active", true);

    rulesQuery = rulesQuery.or(`validFrom.is.null,validFrom.lte.${date}`);
    rulesQuery = rulesQuery.or(`validTo.is.null,validTo.gte.${date}`);

    const { data: allRules } = await rulesQuery;

    const matchedRules = (allRules ?? []).filter((rule) => {
      if (rule.minQuantity !== null && input.quantity < rule.minQuantity)
        return false;
      if (rule.maxQuantity !== null && input.quantity > rule.maxQuantity)
        return false;
      const ruleItemIds = rule.itemIds as string[] | null;
      if (
        ruleItemIds &&
        ruleItemIds.length > 0 &&
        !ruleItemIds.includes(input.itemId)
      )
        return false;
      if (
        rule.itemPostingGroupId !== null &&
        rule.itemPostingGroupId !== resolvedItemPostingGroupId
      )
        return false;
      const ruleCustomerIds = rule.customerIds as string[] | null;
      if (ruleCustomerIds && ruleCustomerIds.length > 0) {
        if (!input.customerId || !ruleCustomerIds.includes(input.customerId))
          return false;
      }
      const ruleCustomerTypeIds = rule.customerTypeIds as string[] | null;
      if (ruleCustomerTypeIds && ruleCustomerTypeIds.length > 0) {
        if (
          !resolvedCustomerTypeId ||
          !ruleCustomerTypeIds.includes(resolvedCustomerTypeId)
        )
          return false;
      }
      return true;
    });

    const ruleResult = applyPriceRules(
      startingPrice,
      matchedRules.map(toMatchedRule),
      { configuration: input.configuration, configurationOnly: skipRules }
    );
    finalPrice = ruleResult.finalPrice;
    trace.push(...ruleResult.appendedTrace);
  }

  trace.push({
    step: "Final Price",
    source: "Resolved",
    amount: finalPrice
  });

  return { finalPrice, basePrice, trace };
}

// itemPostingGroupId is stored on itemCost, not item. The generic filter
// helper assumes the column exists on the primary table, so we lift the
// posting-group filter out, pre-resolve matching item IDs from itemCost, and
// return the remaining filters to apply normally. Returns { itemIds: null }
// when no posting-group filter is present.
async function resolvePostingGroupFilter(
  client: SupabaseClient<Database>,
  companyId: string,
  filters: GenericQueryFilters["filters"]
): Promise<{
  itemIds: string[] | null;
  filters: GenericQueryFilters["filters"];
}> {
  if (!filters || filters.length === 0) {
    return { itemIds: null, filters };
  }
  const postingGroupFilters = filters.filter(
    (f): f is { column: string; operator: string; value: string } =>
      f.column === "itemPostingGroupId" && Boolean(f.value)
  );
  if (postingGroupFilters.length === 0) {
    return { itemIds: null, filters };
  }
  const remaining = filters.filter((f) => f.column !== "itemPostingGroupId");
  const groupIds = postingGroupFilters.flatMap((f) =>
    f.operator === "in" ? f.value.split(",") : [f.value]
  );
  const { data } = await client
    .from("itemCost")
    .select("itemId")
    .eq("companyId", companyId)
    .in("itemPostingGroupId", groupIds);
  const itemIds = (data ?? []).map((r) => r.itemId);
  return { itemIds, filters: remaining };
}

export async function resolvePriceList(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    customerId?: string;
    customerTypeId?: string;
    search?: string;
    quantity?: number;
  }
): Promise<PriceListResult> {
  const date = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const previewQuantity = Math.max(args.quantity ?? 1, 0);

  let scopeQuery = client
    .from("customerItemPriceOverride")
    .select("itemId")
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.customerId) {
    scopeQuery = scopeQuery.eq("customerId", args.customerId);
  } else if (args.customerTypeId) {
    scopeQuery = scopeQuery.eq("customerTypeId", args.customerTypeId);
  } else {
    return { data: [], count: 0 };
  }

  const { data: scopedOverrides } = await scopeQuery;
  const overriddenItemIds = (scopedOverrides ?? []).map((r) => r.itemId);
  if (overriddenItemIds.length === 0) {
    return { data: [], count: 0 };
  }

  let itemQuery = client
    .from("item")
    .select(
      "id, readableId, name, thumbnailPath, itemUnitSalePrice(unitSalePrice), itemCost(itemPostingGroupId)",
      { count: LIST_COUNT }
    )
    .eq("active", true)
    .in("id", overriddenItemIds);

  if (args.search) {
    itemQuery = itemQuery.or(searchFilter(["name", "readableId"], args.search));
  }

  const { itemIds: postingGroupItemIds, filters: filtersWithoutPostingGroup } =
    await resolvePostingGroupFilter(client, companyId, args.filters);
  if (postingGroupItemIds !== null) {
    if (postingGroupItemIds.length === 0) {
      return { data: [], count: 0 };
    }
    itemQuery = itemQuery.in("id", postingGroupItemIds);
  }

  itemQuery = setGenericQueryFilters(itemQuery, {
    ...args,
    filters: filtersWithoutPostingGroup
  });

  const { data: items, count } = await itemQuery;
  if (!items || items.length === 0) {
    return { data: [], count: count ?? 0 };
  }

  const itemIds = items.map((i) => i.id);

  let resolvedCustomerTypeId = args.customerTypeId ?? null;
  if (args.customerId && !resolvedCustomerTypeId) {
    const { data: cust } = await client
      .from("customer")
      .select("customerTypeId")
      .eq("id", args.customerId)
      .maybeSingle();
    resolvedCustomerTypeId = cust?.customerTypeId ?? null;
  }

  const overrideSelect =
    "id, itemId, notes, validFrom, validTo, applyRulesOnTop, breaks:customerItemPriceOverrideBreak(id, quantity, overridePrice, active)";

  type ParentRow = {
    id: string;
    itemId: string;
    notes: string | null;
    validFrom: string | null;
    validTo: string | null;
    applyRulesOnTop: boolean;
    breaks: PriceOverrideBreak[] | null;
  };

  const fillMap = (
    rows: ParentRow[] | null | undefined,
    target: Map<string, OverrideEntry>
  ) => {
    for (const row of rows ?? []) {
      // Catalog view bypasses the date window; resolvePrice still enforces it.
      const applied = applyBreakToParent(row, previewQuantity, date, true);
      if (applied) target.set(row.itemId, applied);
    }
  };

  const overrideMap = new Map<string, OverrideEntry>();
  const typeOverrideMap = new Map<string, OverrideEntry>();
  const allOverrideMap = new Map<string, OverrideEntry>();

  if (args.customerId) {
    const { data: rows } = await client
      .from("customerItemPriceOverride")
      .select(overrideSelect)
      .eq("companyId", companyId)
      .eq("customerId", args.customerId)
      .eq("active", true)
      .in("itemId", itemIds);
    fillMap(rows as unknown as ParentRow[] | null, overrideMap);
  }

  if (resolvedCustomerTypeId) {
    const { data: rows } = await client
      .from("customerItemPriceOverride")
      .select(overrideSelect)
      .eq("companyId", companyId)
      .eq("customerTypeId", resolvedCustomerTypeId)
      .eq("active", true)
      .in("itemId", itemIds);
    fillMap(rows as unknown as ParentRow[] | null, typeOverrideMap);
  }

  const { data: allRows } = await client
    .from("customerItemPriceOverride")
    .select(overrideSelect)
    .eq("companyId", companyId)
    .is("customerId", null)
    .is("customerTypeId", null)
    .eq("active", true)
    .in("itemId", itemIds);
  fillMap(allRows as unknown as ParentRow[] | null, allOverrideMap);

  let rulesQuery = client
    .from("pricingRule")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true);

  rulesQuery = rulesQuery.or(`validFrom.is.null,validFrom.lte.${date}`);
  rulesQuery = rulesQuery.or(`validTo.is.null,validTo.gte.${date}`);

  const { data: allRules } = await rulesQuery;

  const rows: PriceListRow[] = items.map((item) => {
    const salePriceRow = Array.isArray(item.itemUnitSalePrice)
      ? item.itemUnitSalePrice[0]
      : item.itemUnitSalePrice;
    const basePrice = salePriceRow?.unitSalePrice ?? 0;
    const itemCostRow = Array.isArray(item.itemCost)
      ? item.itemCost[0]
      : item.itemCost;
    const itemPostingGroupId = itemCostRow?.itemPostingGroupId ?? null;
    const trace: PriceTraceStep[] = [];

    let startingPrice = basePrice;
    let isOverridden = false;
    let overrideId: string | null = null;
    let overrideQuantity: number | null = null;
    let overrideNotes: string | null = null;
    let overrideValidFrom: string | null = null;
    let overrideValidTo: string | null = null;
    let overrideSource: "Override" | "Type Override" | "All Override" | null =
      null;
    let skipRules = false;

    trace.push({
      step: "Base Price",
      source: "Item Unit Sale Price",
      amount: basePrice
    });

    const override = overrideMap.get(item.id);
    const typeOverride = typeOverrideMap.get(item.id);
    const allOverride = allOverrideMap.get(item.id);
    const appliedOverride = override ?? typeOverride ?? allOverride;

    if (appliedOverride) {
      startingPrice = appliedOverride.overridePrice;
      isOverridden = true;
      overrideId = appliedOverride.id;
      overrideQuantity = appliedOverride.quantity;
      overrideNotes = appliedOverride.notes;
      overrideValidFrom = appliedOverride.validFrom;
      overrideValidTo = appliedOverride.validTo;
      skipRules = appliedOverride.applyRulesOnTop === false;

      if (override) {
        overrideSource = "Override";
        trace.push({
          step: "Override",
          source: override.notes
            ? `Customer Price Override: ${override.notes}`
            : "Customer Price Override",
          amount: override.overridePrice,
          adjustment: override.overridePrice - basePrice
        });
      } else if (typeOverride) {
        overrideSource = "Type Override";
        trace.push({
          step: "Type Override",
          source: typeOverride.notes
            ? `Customer Type Override: ${typeOverride.notes}`
            : "Customer Type Override",
          amount: typeOverride.overridePrice,
          adjustment: typeOverride.overridePrice - basePrice
        });
      } else if (allOverride) {
        overrideSource = "All Override";
        trace.push({
          step: "All Override",
          source: allOverride.notes
            ? `All Customers Override: ${allOverride.notes}`
            : "All Customers Override",
          amount: allOverride.overridePrice,
          adjustment: allOverride.overridePrice - basePrice
        });
      }
    }

    let finalPrice = startingPrice;
    let hasRuleAdjustment = false;

    if (!skipRules) {
      const matchedRules = (allRules ?? []).filter((rule) => {
        if (rule.minQuantity !== null && previewQuantity < rule.minQuantity)
          return false;
        if (rule.maxQuantity !== null && previewQuantity > rule.maxQuantity)
          return false;

        const ruleItemIds = rule.itemIds as string[] | null;
        if (
          ruleItemIds &&
          ruleItemIds.length > 0 &&
          !ruleItemIds.includes(item.id)
        )
          return false;

        if (
          rule.itemPostingGroupId !== null &&
          rule.itemPostingGroupId !== itemPostingGroupId
        )
          return false;

        const ruleCustomerIds = rule.customerIds as string[] | null;
        const ruleCustomerTypeIds = rule.customerTypeIds as string[] | null;

        if (ruleCustomerIds && ruleCustomerIds.length > 0) {
          if (!args.customerId || !ruleCustomerIds.includes(args.customerId))
            return false;
        }
        if (ruleCustomerTypeIds && ruleCustomerTypeIds.length > 0) {
          if (
            !resolvedCustomerTypeId ||
            !ruleCustomerTypeIds.includes(resolvedCustomerTypeId)
          )
            return false;
        }

        return true;
      });

      const ruleResult = applyPriceRules(
        startingPrice,
        matchedRules.map(toMatchedRule)
      );
      finalPrice = ruleResult.finalPrice;
      trace.push(...ruleResult.appendedTrace);
      hasRuleAdjustment = ruleResult.appendedTrace.length > 0;
    }

    trace.push({
      step: "Final Price",
      source: "Resolved",
      amount: finalPrice
    });

    const source: PriceSource = isOverridden
      ? overrideSource!
      : hasRuleAdjustment
        ? "Rule"
        : "Base";

    return {
      itemId: item.id,
      partId: item.readableId,
      itemName: item.name,
      itemPostingGroupId,
      thumbnailPath: item.thumbnailPath ?? null,
      basePrice,
      resolvedPrice: finalPrice,
      isOverridden,
      source,
      trace,
      overrideId,
      overrideQuantity,
      overrideNotes,
      overrideValidFrom,
      overrideValidTo
    };
  });

  return {
    data: rows,
    count: count ?? 0
  };
}

export async function getBaseCatalog(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search?: string }
): Promise<PriceListResult> {
  let query = client
    .from("item")
    .select(
      "id, readableId, name, thumbnailPath, itemUnitSalePrice(unitSalePrice), itemCost(itemPostingGroupId)",
      { count: LIST_COUNT }
    )
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.search) {
    query = query.or(searchFilter(["name", "readableId"], args.search));
  }

  const { itemIds: postingGroupItemIds, filters: filtersWithoutPostingGroup } =
    await resolvePostingGroupFilter(client, companyId, args.filters);
  if (postingGroupItemIds !== null) {
    if (postingGroupItemIds.length === 0) {
      return { data: [], count: 0 };
    }
    query = query.in("id", postingGroupItemIds);
  }

  query = setGenericQueryFilters(query, {
    ...args,
    filters: filtersWithoutPostingGroup
  });

  const { data: items, count } = await query;
  if (!items || items.length === 0) {
    return { data: [], count: count ?? 0 };
  }

  const rows: PriceListRow[] = items.map((item) => {
    const salePriceRow = Array.isArray(item.itemUnitSalePrice)
      ? item.itemUnitSalePrice[0]
      : item.itemUnitSalePrice;
    const basePrice = salePriceRow?.unitSalePrice ?? 0;
    const itemCostRow = Array.isArray(item.itemCost)
      ? item.itemCost[0]
      : item.itemCost;
    return {
      itemId: item.id,
      partId: item.readableId,
      itemName: item.name,
      itemPostingGroupId: itemCostRow?.itemPostingGroupId ?? null,
      thumbnailPath: item.thumbnailPath ?? null,
      basePrice,
      resolvedPrice: basePrice,
      isOverridden: false,
      source: "Base" as PriceSource,
      trace: [],
      overrideId: null,
      overrideQuantity: null,
      overrideNotes: null,
      overrideValidFrom: null,
      overrideValidTo: null
    };
  });

  return { data: rows, count: count ?? 0 };
}

export async function upsertCustomer(
  client: SupabaseClient<Database>,
  customer:
    | (Omit<z.infer<typeof customerValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof customerValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in customer) {
    return client
      .from("customer")
      .insert([customer])
      .select("id, name, website, readableId")
      .single();
  }
  return client
    .from("customer")
    .update({
      ...sanitize(customer),
      updatedAt: datetime.timestamp()
    })
    .eq("id", customer.id)
    .select("id")
    .single();
}

export async function upsertCustomerItemPriceOverride(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  data: {
    id?: string;
    customerId?: string;
    customerTypeId?: string;
    itemId: string;
    breaks: PriceOverrideBreak[];
    active: boolean;
    applyRulesOnTop: boolean;
    notes?: string;
    validFrom?: string;
    validTo?: string;
  }
) {
  if (data.customerId && data.customerTypeId) {
    return {
      data: null,
      error: { message: "Cannot set both customerId and customerTypeId" }
    };
  }

  // Kysely bypasses RLS and the dispatcher reaches this with caller-supplied
  // ids, so the item and the customer (or customer type) must belong to this
  // company before either is written onto the override.
  const [item, customer, customerType] = await Promise.all([
    db
      .selectFrom("item")
      .select("id")
      .where("id", "=", data.itemId)
      .where("companyId", "=", companyId)
      .executeTakeFirst(),
    data.customerId
      ? db
          .selectFrom("customer")
          .select("id")
          .where("id", "=", data.customerId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : null,
    data.customerTypeId
      ? db
          .selectFrom("customerType")
          .select("id")
          .where("id", "=", data.customerTypeId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : null
  ]);
  if (
    !item ||
    (data.customerId && !customer) ||
    (data.customerTypeId && !customerType)
  ) {
    return {
      data: null,
      error: { message: "Item, customer or customer type not found" }
    };
  }

  const sortedBreaks = [...data.breaks].sort((a, b) => a.quantity - b.quantity);

  const parentFields = {
    notes: data.notes ?? null,
    validFrom: data.validFrom ?? null,
    validTo: data.validTo ?? null,
    active: data.active,
    applyRulesOnTop: data.applyRulesOnTop
  };

  // Parent + break rungs in one transaction. Breaks sync by id (update in place,
  // insert new, delete missing) to keep the audit log to one UPDATE per rung.
  // The (parent, quantity) UNIQUE is deferred to commit so shifting the ladder
  // one rung at a time doesn't trip a transient duplicate mid-transaction.
  const timestamp = new Date().toISOString();
  try {
    return await db.transaction().execute(async (trx) => {
      await sql`SET CONSTRAINTS "public"."customerItemPriceOverrideBreak_override_qty_uq" DEFERRED`.execute(
        trx
      );

      let parentId: string;

      if (data.id) {
        const row = await trx
          .updateTable("customerItemPriceOverride")
          .set({
            ...parentFields,
            customerId: data.customerId ?? null,
            customerTypeId: data.customerTypeId ?? null,
            itemId: data.itemId,
            updatedBy: userId,
            updatedAt: timestamp
          })
          .where("id", "=", data.id)
          .where("companyId", "=", companyId)
          .returning("id")
          .executeTakeFirstOrThrow();
        parentId = row.id;
      } else {
        // Collapse onto an existing (scope, item) row if one exists — the partial
        // unique indexes would reject a duplicate insert anyway.
        let lookup = trx
          .selectFrom("customerItemPriceOverride")
          .select("id")
          .where("itemId", "=", data.itemId)
          .where("companyId", "=", companyId);

        lookup = data.customerId
          ? lookup.where("customerId", "=", data.customerId)
          : data.customerTypeId
            ? lookup.where("customerTypeId", "=", data.customerTypeId)
            : lookup
                .where("customerId", "is", null)
                .where("customerTypeId", "is", null);
        const existing = await lookup.executeTakeFirst();

        if (existing) {
          const row = await trx
            .updateTable("customerItemPriceOverride")
            .set({ ...parentFields, updatedBy: userId, updatedAt: timestamp })
            .where("id", "=", existing.id)
            .where("companyId", "=", companyId)
            .returning("id")
            .executeTakeFirstOrThrow();
          parentId = row.id;
        } else {
          const row = await trx
            .insertInto("customerItemPriceOverride")
            .values({
              ...parentFields,
              customerId: data.customerId ?? null,
              customerTypeId: data.customerTypeId ?? null,
              itemId: data.itemId,
              companyId,
              createdBy: userId
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          parentId = row.id;
        }
      }

      const existingRows = await trx
        .selectFrom("customerItemPriceOverrideBreak")
        .select("id")
        .where("customerItemPriceOverrideId", "=", parentId)
        .where("companyId", "=", companyId)
        .execute();

      const existingIds = new Set(existingRows.map((r) => r.id));
      const submittedIds = new Set(
        sortedBreaks
          .map((b) => b.id)
          .filter((id): id is string => typeof id === "string")
      );

      const toDelete = [...existingIds].filter((id) => !submittedIds.has(id));
      if (toDelete.length > 0) {
        await trx
          .deleteFrom("customerItemPriceOverrideBreak")
          .where("id", "in", toDelete)
          .where("companyId", "=", companyId)
          .execute();
      }

      for (const b of sortedBreaks) {
        if (!b.id || !existingIds.has(b.id)) continue;
        await trx
          .updateTable("customerItemPriceOverrideBreak")
          .set({
            quantity: b.quantity,
            overridePrice: b.overridePrice,
            active: b.active,
            updatedBy: userId,
            updatedAt: timestamp
          })
          .where("id", "=", b.id)
          .where("companyId", "=", companyId)
          .execute();
      }

      const toInsert = sortedBreaks.filter(
        (b) => !b.id || !existingIds.has(b.id)
      );
      if (toInsert.length > 0) {
        await trx
          .insertInto("customerItemPriceOverrideBreak")
          .values(
            toInsert.map((b) => ({
              customerItemPriceOverrideId: parentId,
              quantity: b.quantity,
              overridePrice: b.overridePrice,
              active: b.active,
              companyId,
              createdBy: userId
            }))
          )
          .execute();
      }

      return { data: { id: parentId }, error: null };
    });
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : { message: String(err) }
    };
  }
}

export async function deleteCustomerItemPriceOverride(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("customerItemPriceOverride")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

type CustomerItemPriceOverrideWithRelations =
  Database["public"]["Tables"]["customerItemPriceOverride"]["Row"] & {
    customer: { id: string; name: string } | null;
    customerType: { id: string; name: string } | null;
    item: { id: string; name: string } | null;
    breaks: {
      id: string;
      quantity: number;
      overridePrice: number;
      active: boolean;
    }[];
  };

export async function getCustomerItemPriceOverrideById(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
): Promise<PostgrestSingleResponse<CustomerItemPriceOverrideWithRelations>> {
  return client
    .from("customerItemPriceOverride")
    .select(
      `
      *,
      customer(id, name),
      customerType:customerTypeId(id, name),
      item:itemId(id, name),
      breaks:customerItemPriceOverrideBreak(id, quantity, overridePrice, active)
    `
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getCustomerItemPriceOverridesList(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search?: string;
    customerId?: string;
    customerTypeId?: string;
    itemId?: string;
  }
) {
  let query = client
    .from("customerItemPriceOverride")
    .select(
      `
      *,
      customer(id, name),
      customerType:customerTypeId(id, name),
      item:itemId(id, name, unitSalePrice:itemUnitSalePrice(unitSalePrice))
    `,
      { count: LIST_COUNT }
    )
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      searchFilter(["item.name", "customer.name", "notes"], args.search)
    );
  }

  if (args.customerId) {
    query = query.eq("customerId", args.customerId);
  }

  if (args.customerTypeId) {
    query = query.eq("customerTypeId", args.customerTypeId);
  }

  if (args.itemId) {
    query = query.eq("itemId", args.itemId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);

  return query;
}

export async function updateCustomerContact(
  client: SupabaseClient<Database>,
  customerContact: {
    contactId: string;
    contact: z.infer<typeof customerContactValidator>;
    customerLocationId?: string;
    customFields?: Json;
  }
) {
  if (customerContact.customFields) {
    const customFieldUpdate = await client
      .from("customerContact")
      .update({
        customFields: customerContact.customFields,
        customerLocationId: customerContact.customerLocationId
      })
      .eq("contactId", customerContact.contactId);

    if (customFieldUpdate.error) {
      return customFieldUpdate;
    }
  }
  // The contact id is the row key and the location is set on customerContact
  // above; neither is a contact column.
  const {
    contactId: _contactId,
    customerLocationId: _customerLocationId,
    ...contact
  } = customerContact.contact;
  return client
    .from("contact")
    .update(sanitize(contact))
    .eq("id", customerContact.contactId)
    .select("id")
    .single();
}

export async function updateCustomerLocation(
  client: SupabaseClient<Database>,
  customerLocation: {
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
  if (customerLocation.customFields) {
    const customFieldUpdate = await client
      .from("customerLocation")
      .update({
        name: customerLocation.name,
        customFields: customerLocation.customFields
      })
      .eq("addressId", customerLocation.addressId);

    if (customFieldUpdate.error) {
      return customFieldUpdate;
    }
  }
  return client
    .from("address")
    .update(sanitize(customerLocation.address))
    .eq("id", customerLocation.addressId)
    .select("id")
    .single();
}
export async function updateCustomerPayment(
  client: SupabaseClient<Database>,
  customerPayment: z.infer<typeof customerPaymentValidator> & {
    updatedBy: string;
  }
) {
  return client
    .from("customerPayment")
    .update(sanitize(customerPayment))
    .eq("customerId", customerPayment.customerId);
}

export async function updateCustomerShipping(
  client: SupabaseClient<Database>,
  customerShipping: z.infer<typeof customerShippingValidator> & {
    updatedBy: string;
  }
) {
  return client
    .from("customerShipping")
    .update(sanitize(customerShipping))
    .eq("customerId", customerShipping.customerId);
}

export async function updateCustomerTax(
  client: SupabaseClient<Database>,
  customerTax: z.infer<typeof customerTaxValidator> & {
    updatedBy: string;
    taxExemptionCertificatePath?: string | null;
  }
) {
  return client
    .from("customerTax")
    .update(sanitize({ ...customerTax, updatedAt: new Date().toISOString() }))
    .eq("customerId", customerTax.customerId);
}

export async function updatePricingRule(
  client: SupabaseClient<Database>,
  id: string,
  userId: string,
  data: Partial<z.infer<typeof pricingRuleValidator>>
) {
  return client
    .from("pricingRule")
    .update(
      sanitize({
        ...normalizePricingRule(data),
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", id)
    .select("id")
    .single();
}

export async function upsertCustomerStatus(
  client: SupabaseClient<Database>,
  customerStatus:
    | (Omit<z.infer<typeof customerStatusValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof customerStatusValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in customerStatus) {
    return client.from("customerStatus").insert([customerStatus]).select("id");
  } else {
    return client
      .from("customerStatus")
      .update(sanitize(customerStatus))
      .eq("id", customerStatus.id);
  }
}

export async function upsertCustomerType(
  client: SupabaseClient<Database>,
  customerType:
    | (Omit<z.infer<typeof customerTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof customerTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in customerType) {
    return client.from("customerType").insert([customerType]).select("id");
  } else {
    return client
      .from("customerType")
      .update(sanitize(customerType))
      .eq("id", customerType.id);
  }
}

export async function upsertNoQuoteReason(
  client: SupabaseClient<Database>,
  noQuoteReason:
    | (Omit<z.infer<typeof noQuoteReasonValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof noQuoteReasonValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in noQuoteReason) {
    return client.from("noQuoteReason").insert([noQuoteReason]).select("id");
  } else {
    return client
      .from("noQuoteReason")
      .update(sanitize(noQuoteReason))
      .eq("id", noQuoteReason.id);
  }
}

export async function updateSalesRFQFavorite(
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
      .from("salesRfqFavorite")
      .delete()
      .eq("rfqId", id)
      .eq("userId", userId);
  } else {
    return client
      .from("salesRfqFavorite")
      .insert({ rfqId: id, userId: userId });
  }
}

export async function updateQuoteExchangeRate(
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

  return client.from("quote").update(update).eq("id", update.id);
}

export async function updateQuoteLinePrecision(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  quoteId: string,
  lineId: string,
  precision: number
) {
  return db.transaction().execute(async (trx) => {
    const line = await trx
      .updateTable("quoteLine")
      .set({ unitPricePrecision: precision })
      .where("id", "=", lineId)
      .where("companyId", "=", companyId)
      .returning("id")
      .executeTakeFirst();

    if (!line) {
      throw new Error(
        `Quote line ${lineId} was not found for company ${companyId}`
      );
    }

    await rewriteQuoteLinePrices(trx, companyId, quoteId, lineId);
  });
}

export async function updateSalesOrderExchangeRate(
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

  return client.from("salesOrder").update(update).eq("id", update.id);
}

export async function updateQuoteFavorite(
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
      .from("quoteFavorite")
      .delete()
      .eq("quoteId", id)
      .eq("userId", userId);
  } else {
    return client.from("quoteFavorite").insert({ quoteId: id, userId: userId });
  }
}

/** Not published: `sales.rfq.setStatus` also sends the Ready for Quote notification. */
export async function updateSalesRFQStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof salesRFQStatusType)[number];
    noQuoteReasonId: string | null;
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  const { noQuoteReasonId, status, ...rest } = update;

  // Only include noQuoteReasonId if it has a value to avoid foreign key constraint error
  // Set completedAt when status is Ready for Quote
  const updateData = {
    status,
    ...rest,
    ...(noQuoteReasonId ? { noQuoteReasonId } : {}),
    ...(status === "Ready for Quote"
      ? { completedDate: datetime.timestamp() }
      : {})
  };

  return client.from("salesRfq").update(updateData).eq("id", update.id);
}

export async function updateQuoteMaterialOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("quoteMaterial").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateQuoteOperationOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("quoteOperation").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateQuoteStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof quoteStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  const { status, ...rest } = update;

  // Set completedDate when status is Ready for Quote
  const updateData = {
    status,
    ...rest,
    ...(status === "Sent" ? { completedDate: datetime.timestamp() } : {})
  };
  return client.from("quote").update(updateData).eq("id", update.id);
}

export async function upsertMakeMethodFromQuoteLine(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  lineMethod: {
    itemId: string;
    quoteId: string;
    quoteLineId: string;
    companyId: string;
    userId: string;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  }
) {
  return invokePosting(
    {
      client,
      db,
      companyId: lineMethod.companyId,
      userId: lineMethod.userId
    },
    "get-method",
    {
      type: "quoteLineToItem",
      sourceId: `${lineMethod.quoteId}:${lineMethod.quoteLineId}`,
      targetId: lineMethod.itemId,
      parts: lineMethod.parts
    },
    productionPostings.getMethod,
    { as: productionPostings.getMethodPermission }
  );
}

export async function upsertMakeMethodFromQuoteMethod(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  quoteMethod: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  }
) {
  const { error } = await invokePosting(
    {
      client,
      db,
      companyId: quoteMethod.companyId,
      userId: quoteMethod.userId
    },
    "get-method",
    {
      type: "quoteMakeMethodToItem",
      sourceId: quoteMethod.sourceId,
      targetId: quoteMethod.targetId,
      parts: quoteMethod.parts
    },
    productionPostings.getMethod,
    { as: productionPostings.getMethodPermission }
  );

  if (error) {
    return {
      data: null,
      error: { message: "Failed to save method" } as PostgrestError
    };
  }

  return { data: null, error: null };
}

export async function insertQuote(
  client: SupabaseClient<Database>,
  input: {
    customerId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    quoteId?: string;
    locationId?: string;
    status?: (typeof quoteStatusType)[number];
    currencyCode?: string;
    expirationDate?: string;
    customerContactId?: string;
    customerLocationId?: string;
    customerEngineeringContactId?: string;
    customerReference?: string;
    salesPersonId?: string;
    estimatorId?: string;
    dueDate?: string;
    opportunityId?: string;
    notes?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; quoteId: string } | null;
  error: PostgrestError | null;
}> {
  let quoteId: string;
  if (input.quoteId) {
    quoteId = input.quoteId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "quote",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({ message: "Failed to generate quote sequence" } as PostgrestError)
      };
    }
    quoteId = seq.data;
  }

  let opportunityId = input.opportunityId;
  if (!opportunityId) {
    const opportunity = await client
      .from("opportunity")
      .insert({
        customerId: input.customerId,
        companyId: input.companyId
      })
      .select("id")
      .single();

    if (opportunity.error) return { data: null, error: opportunity.error };
    opportunityId = opportunity.data.id;
  }

  const [customerPayment, customerShipping, seller] = await Promise.all([
    getCustomerPayment(client, input.customerId),
    getCustomerShipping(client, input.customerId),
    getEmployeeJob(client, input.createdBy, input.companyId)
  ]);

  if (customerPayment.error)
    return { data: null, error: customerPayment.error };
  if (customerShipping.error)
    return { data: null, error: customerShipping.error };

  const {
    paymentTermId,
    invoiceCustomerId,
    invoiceCustomerContactId,
    invoiceCustomerLocationId
  } = customerPayment.data;
  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    customerShipping.data;

  let exchangeRate = 1;
  let exchangeRateUpdatedAt = new Date().toISOString();
  if (input.currencyCode) {
    const exchangeRateResult = await getExchangeRate(
      client,
      input.companyId,
      input.currencyCode
    );
    if (exchangeRateResult.error) {
      return { data: null, error: exchangeRateResult.error };
    }
    exchangeRate = exchangeRateResult.data;
    exchangeRateUpdatedAt = new Date().toISOString();
  }

  const locationId = input.locationId ?? seller?.data?.locationId ?? null;

  const quote = await client
    .from("quote")
    .insert({
      quoteId,
      customerId: input.customerId,
      customerContactId: input.customerContactId,
      customerLocationId: input.customerLocationId,
      customerEngineeringContactId: input.customerEngineeringContactId,
      customerReference: input.customerReference,
      salesPersonId: input.salesPersonId,
      estimatorId: input.estimatorId,
      dueDate: input.dueDate,
      opportunityId,
      status: input.status ?? "Draft",
      expirationDate: input.expirationDate,
      currencyCode: input.currencyCode,
      exchangeRate,
      exchangeRateUpdatedAt,
      locationId,
      internalNotes: input.notes,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, quoteId")
    .single();

  if (quote.error) return { data: null, error: quote.error };

  const createdQuoteId = quote.data.id;

  const [payment, shipment, externalLink] = await Promise.all([
    client.from("quotePayment").insert({
      id: createdQuoteId,
      paymentTermId,
      invoiceCustomerId,
      invoiceCustomerContactId,
      invoiceCustomerLocationId,
      companyId: input.companyId
    }),
    client.from("quoteShipment").insert({
      id: createdQuoteId,
      locationId,
      shippingMethodId,
      shippingTermId,
      incoterm,
      incotermLocation,
      companyId: input.companyId
    }),
    upsertExternalLink(client, {
      documentType: "Quote",
      documentId: createdQuoteId,
      customerId: input.customerId,
      expiresAt: input.expirationDate,
      companyId: input.companyId
    })
  ]);

  if (payment.error || shipment.error) {
    await deleteQuote(client, createdQuoteId);
    return { data: null, error: payment.error ?? shipment.error };
  }

  if (externalLink.data) {
    await client
      .from("quote")
      .update({ externalLinkId: externalLink.data.id })
      .eq("id", createdQuoteId);
  }

  return { data: { id: createdQuoteId, quoteId }, error: null };
}

export async function updateQuote(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    status?: (typeof quoteStatusType)[number];
    currencyCode?: string;
    expirationDate?: string | null;
    customerContactId?: string | null;
    customerLocationId?: string | null;
    customerEngineeringContactId?: string | null;
    customerReference?: string | null;
    customerId?: string;
    salesPersonId?: string | null;
    estimatorId?: string | null;
    locationId?: string;
    dueDate?: string | null;
    digitalQuoteAcceptedBy?: string | null;
    digitalQuoteAcceptedByEmail?: string | null;
    notes?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: PostgrestError | null;
}> {
  const { id, updatedBy, notes, ...updates } = input;

  let exchangeRate: number | undefined;
  let exchangeRateUpdatedAt: string | undefined;

  const existing = await client
    .from("quote")
    .select("companyId, currencyCode, opportunityId")
    .eq("id", id)
    .single();

  if (existing.error) return { data: null, error: existing.error };

  if (
    updates.currencyCode &&
    existing.data.currencyCode !== updates.currencyCode
  ) {
    const exchangeRateResult = await getExchangeRate(
      client,
      existing.data.companyId,
      updates.currencyCode
    );
    if (exchangeRateResult.error) {
      return { data: null, error: exchangeRateResult.error };
    }
    exchangeRate = exchangeRateResult.data;
    exchangeRateUpdatedAt = new Date().toISOString();
  }

  if (updates.customerId && existing.data.opportunityId) {
    await client
      .from("opportunity")
      .update({ customerId: updates.customerId })
      .eq("id", existing.data.opportunityId);
  }

  return client
    .from("quote")
    .update({
      ...sanitize(updates),
      ...(exchangeRate !== undefined && { exchangeRate }),
      ...(exchangeRateUpdatedAt && { exchangeRateUpdatedAt }),
      ...(notes !== undefined && { internalNotes: notes }),
      updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .select("id")
    .single();
}

export async function upsertQuoteLine(
  client: SupabaseClient<Database>,
  quotationLine:
    | (Omit<z.infer<typeof quoteLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quoteLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in quotationLine) {
    return client
      .from("quoteLine")
      .update(sanitize(quotationLine))
      .eq("id", quotationLine.id)
      .select("id")
      .single();
  }

  const existing = await client
    .from("quoteLine")
    .select("sortOrder")
    .eq("quoteId", quotationLine.quoteId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("quoteLine")
    .insert([{ ...quotationLine, sortOrder: maxSortOrder + 1 }])
    .select("*")
    .single();
}

export async function updateQuoteLineOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  quoteId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "quoteLine",
    column: "sortOrder",
    companyId,
    userId,
    parent: { column: "quoteId", id: quoteId },
    updates
  });
}

export async function upsertQuoteLineAdditionalCharges(
  client: SupabaseClient<Database>,
  lineId: string,
  update: {
    additionalCharges: z.infer<typeof quoteLineAdditionalChargesValidator>;
    updatedBy: string;
  }
) {
  return client.from("quoteLine").update(update).eq("id", lineId);
}

type QuoteLinePriceInput = {
  quoteLineId: string;
  unitPrice: number;
  quantity: number;
  createdBy: string;
  // Optional: an explicit value wins, an omitted one preserves the stored value
  // for that quantity (so a cost recalc can leave user-entered fields alone).
  leadTime?: number;
  discountPercent?: number;
  shippingCost?: number;
  categoryMarkups?: Record<string, number>;
  priceSource?: "system" | "manual";
  // How unitPrice was resolved. Unlike the fields above, an omitted trace is
  // NOT carried over: it explains the unit price, which every caller restates.
  priceTrace?: PriceTraceStep[] | null;
};

/**
 *                  deleteFrom("quoteLinePrice") then re-inserts. The body of
 *                  THIS function holds no delete, so reading it cannot show
 *                  that; declaring it is the point.
 */
export async function upsertQuoteLinePrices(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  quoteId: string,
  lineId: string,
  quoteLinePrices: {
    quoteLineId: string;
    unitPrice: number;
    quantity: number;
    createdBy: string;
    leadTime?: number;
    discountPercent?: number;
    shippingCost?: number;
    categoryMarkups?: Record<string, number>;
    priceSource?: "system" | "manual";
    priceTrace?: PriceTraceStep[] | null;
  }[]
) {
  return db
    .transaction()
    .execute((trx) =>
      rewriteQuoteLinePrices(trx, companyId, quoteId, lineId, quoteLinePrices)
    );
}

async function rewriteQuoteLinePrices(
  trx: KyselyTx,
  companyId: string,
  quoteId: string,
  lineId: string,
  quoteLinePrices?: QuoteLinePriceInput[]
) {
  const existingPrices = await trx
    .selectFrom("quoteLinePrice")
    .selectAll()
    .where("quoteLineId", "=", lineId)
    .where("companyId", "=", companyId)
    .execute();

  const replacements: QuoteLinePriceInput[] =
    quoteLinePrices ??
    existingPrices.map((price) => ({
      quoteLineId: lineId,
      quantity: Number(price.quantity),
      unitPrice: Number(price.unitPrice),
      leadTime: Number(price.leadTime),
      discountPercent: Number(price.discountPercent),
      // A precision rebuild only re-rounds the price; its explanation stands.
      priceTrace: (price.priceTrace as PriceTraceStep[] | null) ?? null,
      createdBy: price.createdBy
    }));

  if (replacements.length === 0) return;

  const quote = await trx
    .selectFrom("quote")
    .select("exchangeRate")
    .where("id", "=", quoteId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();

  const quoteLine = await trx
    .selectFrom("quoteLine")
    .select("unitPricePrecision")
    .where("id", "=", lineId)
    .where("quoteId", "=", quoteId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();

  if (!quote || !quoteLine) {
    throw new Error(
      `Quote ${quoteId} / line ${lineId} was not found for company ${companyId}`
    );
  }

  const exchangeRate = quote.exchangeRate;
  if (exchangeRate === null) {
    throw new Error(
      `Quote ${quoteId} has no exchange rate for company ${companyId}`
    );
  }

  await trx
    .deleteFrom("quoteLinePrice")
    .where("quoteLineId", "=", lineId)
    .where("companyId", "=", companyId)
    .execute();

  const existingByQuantity = new Map(
    existingPrices.map((price) => [Number(price.quantity), price])
  );

  await trx
    .insertInto("quoteLinePrice")
    .values(
      replacements.map((p) => {
        const existing = existingByQuantity.get(Number(p.quantity));

        return {
          ...p,
          quoteLineId: lineId,
          companyId,
          quoteId,
          unitPrice: round(p.unitPrice, quoteLine.unitPricePrecision),
          // Kysely sends a JS array as a Postgres array literal; jsonb needs
          // JSON text.
          priceTrace: p.priceTrace ? JSON.stringify(p.priceTrace) : null,
          // Explicit value wins, omitted value is preserved from the stored row.
          ...resolvePreservedQuoteLinePriceFields(p, {
            leadTime: existing ? Number(existing.leadTime) : undefined,
            discountPercent: existing
              ? Number(existing.discountPercent)
              : undefined,
            shippingCost: existing ? Number(existing.shippingCost) : undefined,
            categoryMarkups:
              (existing?.categoryMarkups as CategoryMarkups | null) ??
              undefined,
            priceSource:
              (existing?.priceSource as QuoteLinePriceSource | null) ??
              undefined
          }),
          exchangeRate
        };
      })
    )
    .execute();

  // Keep quoteLine.quantity in step with the rows that now exist, but only when
  // the caller supplied an explicit price set — the precision rebuild
  // (quoteLinePrices omitted) must not touch the line's quantity breaks.
  if (quoteLinePrices) {
    const quantities = [
      ...new Set(replacements.map((p) => Number(p.quantity)))
    ].sort((a, b) => a - b);
    await trx
      .updateTable("quoteLine")
      .set({ quantity: quantities })
      .where("id", "=", lineId)
      .where("companyId", "=", companyId)
      .execute();
  }
}

async function buildCostEffects(
  client: SupabaseClient<Database>,
  quoteLineId: string,
  /** Set to rewrite the Buy materials' costs; a read-only caller leaves it out. */
  refresh?: { db: Kysely<KyselyDatabase>; companyId: string }
) {
  const operationsResult = await client
    .from("quoteOperation")
    .select("*")
    .eq("quoteLineId", quoteLineId);

  const operations = operationsResult.data ?? [];

  // Refresh Buy material costs from supplier price breaks; resolveBuyUnitCost
  // leaves a typed cost alone. A read-only caller skips the write — the cost
  // effects below price Buy materials from the same breaks either way.
  const buyMaterials = await client
    .from("quoteMaterial")
    .select("id, itemId, unitCost, unitCostSource")
    .eq("quoteLineId", quoteLineId)
    .eq("methodType", "Purchase to Order");

  const buyItemIds = [
    ...new Set((buyMaterials.data ?? []).map((m) => m.itemId))
  ];
  const priceMap = await getSupplierPriceBreaksForItems(client, buyItemIds);

  if (refresh) {
    const changed = (buyMaterials.data ?? []).flatMap((mat) => {
      if (mat.unitCostSource === "manual") return [];
      const price = resolveBuyUnitCost(mat, 1, priceMap);
      return price !== mat.unitCost ? [{ id: mat.id, unitCost: price }] : [];
    });
    await updateQuoteMaterialUnitCosts(
      refresh.db,
      refresh.companyId,
      quoteLineId,
      changed
    );
  }

  // Build method tree
  const rootMethod = await client
    .from("quoteMakeMethod")
    .select("id")
    .eq("quoteLineId", quoteLineId)
    .is("parentMaterialId", null)
    .single();

  if (rootMethod.error) return null;

  const treeResult = await client.rpc("get_quote_methods_by_method_id", {
    mid: rootMethod.data.id
  });

  if (treeResult.error || !treeResult.data) return null;

  type TreeNode = {
    id: string;
    data: (typeof treeResult.data)[number];
    children: TreeNode[];
  };

  const rootItems: TreeNode[] = [];
  const lookup: Record<string, TreeNode> = {};

  for (const item of treeResult.data) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!lookup[itemId]) {
      lookup[itemId] = {
        id: itemId,
        children: [],
        data: item
      };
    } else {
      lookup[itemId].data = item;
    }

    if (!parentId) {
      rootItems.push(lookup[itemId]);
    } else {
      if (!lookup[parentId]) {
        lookup[parentId] = {
          id: parentId,
          children: [],
          data: {} as (typeof treeResult.data)[number]
        };
      }
      lookup[parentId].children.push(lookup[itemId]);
    }
  }

  type CostEffects = Record<string, ((qty: number) => number)[]>;
  const effects: CostEffects = {};
  for (const key of costCategoryKeys) {
    effects[key] = [];
  }

  function normalizeTime(
    time: number,
    unit: string
  ): { fixedHours: number; hoursPerUnit: number } {
    let fixedHours = 0;
    let hoursPerUnit = 0;
    switch (unit) {
      case "Total Hours":
        fixedHours = time;
        break;
      case "Total Minutes":
        fixedHours = time / 60;
        break;
      case "Hours/Piece":
        hoursPerUnit = time;
        break;
      case "Hours/100 Pieces":
        hoursPerUnit = time / 100;
        break;
      case "Hours/1000 Pieces":
        hoursPerUnit = time / 1000;
        break;
      case "Minutes/Piece":
        hoursPerUnit = time / 60;
        break;
      case "Minutes/100 Pieces":
        hoursPerUnit = time / 100 / 60;
        break;
      case "Minutes/1000 Pieces":
        hoursPerUnit = time / 1000 / 60;
        break;
      case "Pieces/Hour":
        hoursPerUnit = 1 / time;
        break;
      case "Pieces/Minute":
        hoursPerUnit = 1 / (time / 60);
        break;
      case "Seconds/Piece":
        hoursPerUnit = time / 3600;
        break;
    }
    return { fixedHours, hoursPerUnit };
  }

  function pushBuyCostEffect(
    itemId: string,
    itemType: string,
    quantity: number,
    unitCost: number,
    unitCostSource: string | null
  ) {
    const costFn = (outerQty: number) => {
      const requestedQty = quantity * outerQty;
      return (
        resolveBuyUnitCost(
          { itemId, unitCost, unitCostSource },
          requestedQty,
          priceMap
        ) * requestedQty
      );
    };
    const key =
      itemType === "Material"
        ? "materialCost"
        : itemType === "Part"
          ? "partCost"
          : itemType === "Tool"
            ? "toolCost"
            : itemType === "Consumable"
              ? "consumableCost"
              : itemType === "Service"
                ? "serviceCost"
                : null;
    if (key) effects[key].push(costFn);
  }

  function walkTree(node: TreeNode, parentQuantity: number) {
    const d = node.data;
    const qty = d.quantity * parentQuantity;

    if (d.methodType === "Purchase to Order") {
      pushBuyCostEffect(
        d.itemId,
        d.itemType,
        qty,
        d.unitCost,
        d.unitCostSource
      );
    } else if (d.methodType === "Pull from Inventory") {
      const costFn = (outerQty: number) => d.unitCost * qty * outerQty;
      const key =
        d.itemType === "Material"
          ? "materialCost"
          : d.itemType === "Part"
            ? "partCost"
            : d.itemType === "Tool"
              ? "toolCost"
              : d.itemType === "Consumable"
                ? "consumableCost"
                : d.itemType === "Service"
                  ? "serviceCost"
                  : null;
      if (key) effects[key].push(costFn);
    }

    const nodeOps = operations.filter(
      (o) => o.quoteMakeMethodId === d.quoteMaterialMakeMethodId
    );

    for (const op of nodeOps) {
      // Outside Processing is subcontracted — its cost is the supplier's per-unit
      // price (with a minimum). Every other operationType (Process, Assembly,
      // Inspection, and any future in-house type) is costed in-house from
      // labor/machine/setup times. Match the subcontract case explicitly so a new
      // operationType can't silently inherit the outside-cost branch.
      if (op.operationType === "Outside Processing") {
        effects.outsideCost.push((outerQty) => {
          const cost = op.operationUnitCost * qty * outerQty;
          return Math.max(op.operationMinimumCost, cost);
        });
      } else {
        if (op.setupTime) {
          const { fixedHours, hoursPerUnit } = normalizeTime(
            op.setupTime,
            op.setupUnit
          );
          effects.laborCost.push((outerQty) => {
            return (
              hoursPerUnit * outerQty * qty * (op.laborRate ?? 0) +
              fixedHours * (op.laborRate ?? 0)
            );
          });
          effects.overheadCost.push((outerQty) => {
            return (
              hoursPerUnit * outerQty * qty * (op.overheadRate ?? 0) +
              fixedHours * (op.overheadRate ?? 0)
            );
          });
        }

        let laborFixedHours = 0;
        let laborHoursPerUnit = 0;
        let machineFixedHours = 0;
        let machineHoursPerUnit = 0;

        if (op.laborTime) {
          const n = normalizeTime(op.laborTime, op.laborUnit);
          laborFixedHours = n.fixedHours;
          laborHoursPerUnit = n.hoursPerUnit;
          effects.laborCost.push((outerQty) => {
            return (
              laborHoursPerUnit * outerQty * qty * (op.laborRate ?? 0) +
              laborFixedHours * (op.laborRate ?? 0)
            );
          });
        }

        if (op.machineTime) {
          const n = normalizeTime(op.machineTime, op.machineUnit);
          machineFixedHours = n.fixedHours;
          machineHoursPerUnit = n.hoursPerUnit;
          effects.machineCost.push((outerQty) => {
            return (
              machineHoursPerUnit * outerQty * qty * (op.machineRate ?? 0) +
              machineFixedHours * (op.machineRate ?? 0)
            );
          });
        }

        const hpu = Math.max(laborHoursPerUnit, machineHoursPerUnit);
        const fh = Math.max(laborFixedHours, machineFixedHours);
        effects.overheadCost.push((outerQty) => {
          if (hpu * outerQty * qty > fh) {
            return hpu * outerQty * qty * (op.overheadRate ?? 0);
          }
          return fh * (op.overheadRate ?? 0);
        });
      }
    }

    for (const child of node.children) {
      walkTree(child, qty);
    }
  }

  for (const root of rootItems) {
    walkTree(root, 1);
  }

  return { effects, costCategoryKeys };
}

/**
 * The three price resolvers below each read a pile of context, compute price
 * rows, and finish with ONE insert. They are split at that seam so a caller
 * that needs the write to be atomic with other writes can build the rows first
 * and hand them to a transaction (see `saveQuoteLineWithPrices`).
 *
 * `itemIdOverride` exists because the quote-line save path updates the line and
 * prices together: the row in the database still holds the OLD `itemId` while
 * the new one is only in the validated form data, so the caller passes it in
 * rather than the builder reading a value that is about to change.
 */
export type QuoteLinePriceRow = {
  quoteId: string;
  quoteLineId: string;
  companyId: string;
  quantity: number;
  unitPrice: number;
  exchangeRate: number;
  createdBy: string;
  leadTime: number;
  discountPercent: number;
  categoryMarkups?: Record<string, number>;
  priceSource?: string;
  priceTrace?: PriceTraceStep[] | null;
};

type BuildPriceRowsResult = {
  rows: QuoteLinePriceRow[];
  error: unknown | null;
};

// The part's unit sale price for a configured line (see
// configuredQuoteBasePrice); null data for an unconfigured line, which never
// reads it.
async function getConfiguredSalePrice(
  client: SupabaseClient<Database>,
  companyId: string,
  itemId: string | null | undefined,
  configuration: Record<string, unknown> | null
): Promise<{ data: number | null; error: PostgrestError | null }> {
  if (!itemId || !configuration) return { data: null, error: null };
  const { data, error } = await client
    .from("itemUnitSalePrice")
    .select("unitSalePrice")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
  return { data: data?.unitSalePrice ?? null, error };
}

export async function buildMakeToOrderPriceRows(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  quoteId: string,
  quoteLineId: string,
  quantities: number[],
  userId: string,
  itemIdOverride?: string | null
): Promise<BuildPriceRowsResult> {
  if (!quantities.length) return { rows: [], error: null };

  // 1. Fetch quote (with companyId + customerId) and line in parallel
  const [quoteResult, lineResult] = await Promise.all([
    client
      .from("quote")
      .select("companyId, customerId, exchangeRate")
      .eq("id", quoteId)
      .single(),
    client
      .from("quoteLine")
      .select("itemId, unitPricePrecision, configuration")
      .eq("id", quoteLineId)
      .single()
  ]);

  if (quoteResult.error) return { rows: [], error: quoteResult.error };
  if (lineResult.error) return { rows: [], error: lineResult.error };

  // Fetch settings filtered by company (required for service-role access)
  const settingsResult = await client
    .from("companySettings")
    .select("quoteLineCategoryMarkups")
    .eq("id", quoteResult.data.companyId)
    .single();

  if (settingsResult.error) return { rows: [], error: settingsResult.error };

  const companyId = quoteResult.data.companyId;
  const customerId = quoteResult.data.customerId ?? undefined;
  const itemId =
    itemIdOverride === undefined
      ? (lineResult.data.itemId ?? undefined)
      : (itemIdOverride ?? undefined);
  const exchangeRate = quoteResult.data.exchangeRate;
  if (exchangeRate === null) {
    return {
      rows: [],
      error: new Error(`Quote ${quoteId} has no exchange rate`)
    };
  }
  const precision = lineResult.data.unitPricePrecision ?? 2;

  // Parse default markups (settings stores decimals, convert to whole numbers)
  const rawMarkups =
    (settingsResult.data.quoteLineCategoryMarkups as Record<string, number>) ??
    {};
  const defaultMarkups: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawMarkups)) {
    defaultMarkups[key] = value * 100;
  }
  const effectiveDefaults = getEffectiveDefaultMarkups(defaultMarkups);

  // 2. Build cost effects
  const result = await buildCostEffects(client, quoteLineId, {
    db,
    companyId
  });
  // buildCostEffects returns null when the line has no costed method yet —
  // treat as a no-op so partial drafts don't block the save.
  if (!result) return { rows: [], error: null };

  const { effects } = result;

  const configuration = asConfiguration(lineResult.data.configuration);
  const salePrice = await getConfiguredSalePrice(
    client,
    companyId,
    itemId,
    configuration
  );
  if (salePrice.error) return { rows: [], error: salePrice.error };

  const priceRows: QuoteLinePriceRow[] = [];
  for (const qty of quantities) {
    const categoryCosts: Record<string, number> = {};
    for (const key of costCategoryKeys) {
      const total = effects[key].reduce((acc, fn) => acc + fn(qty), 0);
      categoryCosts[key] = qty > 0 ? total / qty : 0;
    }

    const rollupPrice = costCategoryKeys.reduce((sum, key) => {
      const cost = categoryCosts[key] ?? 0;
      const markup = effectiveDefaults[key] ?? 0;
      return sum + cost * (1 + markup / 100);
    }, 0);

    const basePrice = configuredQuoteBasePrice({
      configuration,
      unitSalePrice: salePrice.data,
      categoryMarkups: null,
      defaultMarkups: effectiveDefaults
    });

    const resolved = itemId
      ? await resolvePrice(client, companyId, {
          itemId,
          quantity: qty,
          customerId,
          existingBasePrice: basePrice ?? rollupPrice,
          configuration
        })
      : null;

    priceRows.push({
      quoteId,
      quoteLineId,
      companyId,
      quantity: qty,
      unitPrice: round(resolved?.finalPrice ?? rollupPrice, precision),
      // A row priced from the sale price is not cost-plus.
      categoryMarkups: basePrice === null ? effectiveDefaults : {},
      priceSource: "system",
      priceTrace: resolved
        ? withBasePriceSource(
            resolved.trace,
            basePrice === null ? QUOTE_BASE_PRICE_SOURCES.costPlus : null
          )
        : null,
      exchangeRate,
      createdBy: userId,
      leadTime: 0,
      discountPercent: 0
    });
  }

  return { rows: priceRows, error: null };
}

export async function calculatePricesForQuantities(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  quoteId: string,
  quoteLineId: string,
  quantities: number[],
  userId: string
) {
  const { rows, error } = await buildMakeToOrderPriceRows(
    client,
    db,
    quoteId,
    quoteLineId,
    quantities,
    userId
  );
  if (error) return { error };
  if (!rows.length) return { error: null };

  const insertResult = await client.from("quoteLinePrice").insert(rows);
  if (insertResult.error) {
    logger.error("Failed to insert MtO calc quote line prices", {
      quoteLineId,
      error: insertResult.error
    });
    return { error: insertResult.error };
  }
  return { error: null };
}

export async function buildPullFromInventoryPriceRows(
  client: SupabaseClient<Database>,
  companyId: string,
  quoteId: string,
  quoteLineId: string,
  quantities: number[],
  userId: string,
  itemIdOverride?: string | null
): Promise<BuildPriceRowsResult> {
  if (!quantities.length) return { rows: [], error: null };

  const [quoteResult, lineResult] = await Promise.all([
    client
      .from("quote")
      .select("customerId, exchangeRate")
      .eq("id", quoteId)
      .single(),
    client
      .from("quoteLine")
      .select("itemId, unitPricePrecision, configuration")
      .eq("id", quoteLineId)
      .single()
  ]);

  if (quoteResult.error) return { rows: [], error: quoteResult.error };
  if (lineResult.error) return { rows: [], error: lineResult.error };

  const itemId =
    itemIdOverride === undefined ? lineResult.data.itemId : itemIdOverride;
  // Missing itemId is a benign draft state, not an error.
  if (!itemId) return { rows: [], error: null };

  const exchangeRate = quoteResult.data.exchangeRate;
  if (exchangeRate === null) {
    return {
      rows: [],
      error: new Error(`Quote ${quoteId} has no exchange rate`)
    };
  }
  const precision = lineResult.data.unitPricePrecision ?? 2;
  const customerId = quoteResult.data.customerId ?? undefined;

  const priceRows: QuoteLinePriceRow[] = [];
  for (const qty of quantities) {
    const resolved = await resolvePrice(client, companyId, {
      itemId,
      quantity: qty,
      customerId,
      configuration: asConfiguration(lineResult.data.configuration)
    });

    priceRows.push({
      quoteId,
      quoteLineId,
      companyId,
      quantity: qty,
      unitPrice: round(resolved.finalPrice, precision),
      priceTrace: resolved.trace,
      exchangeRate,
      createdBy: userId,
      leadTime: 0,
      discountPercent: 0
    });
  }

  return { rows: priceRows, error: null };
}

export async function resolveQuoteLinePrices(
  client: SupabaseClient<Database>,
  companyId: string,
  quoteId: string,
  quoteLineId: string,
  quantities: number[],
  userId: string
) {
  const { rows, error } = await buildPullFromInventoryPriceRows(
    client,
    companyId,
    quoteId,
    quoteLineId,
    quantities,
    userId
  );
  if (error) return { error };
  if (!rows.length) return { error: null };

  const insertResult = await client.from("quoteLinePrice").insert(rows);
  if (insertResult.error) {
    logger.error("Failed to insert Pull quote line prices", {
      quoteLineId,
      error: insertResult.error
    });
    return { error: insertResult.error };
  }
  return { error: null };
}

export async function buildPurchaseToOrderPriceRows(
  client: SupabaseClient<Database>,
  companyId: string,
  quoteId: string,
  quoteLineId: string,
  quantities: number[],
  userId: string,
  itemIdOverride?: string | null
): Promise<BuildPriceRowsResult> {
  if (!quantities.length) return { rows: [], error: null };

  const [quoteResult, lineResult] = await Promise.all([
    client
      .from("quote")
      .select("customerId, exchangeRate")
      .eq("id", quoteId)
      .single(),
    client
      .from("quoteLine")
      .select("itemId, unitPricePrecision, configuration")
      .eq("id", quoteLineId)
      .single()
  ]);

  if (quoteResult.error) return { rows: [], error: quoteResult.error };
  if (lineResult.error) return { rows: [], error: lineResult.error };

  const itemId =
    itemIdOverride === undefined ? lineResult.data.itemId : itemIdOverride;
  if (!itemId) return { rows: [], error: null };

  const exchangeRate = quoteResult.data.exchangeRate;
  if (exchangeRate === null) {
    return {
      rows: [],
      error: new Error(`Quote ${quoteId} has no exchange rate`)
    };
  }
  const precision = lineResult.data.unitPricePrecision ?? 2;
  const customerId = quoteResult.data.customerId ?? undefined;

  const priceMap = await getSupplierPriceBreaksForItems(client, [itemId]);

  const priceRows: QuoteLinePriceRow[] = [];
  for (const qty of quantities) {
    const supplierPrice = lookupBuyPriceFromMap(itemId, qty, priceMap, 0);
    const resolved = await resolvePrice(client, companyId, {
      itemId,
      quantity: qty,
      customerId,
      existingBasePrice: supplierPrice,
      configuration: asConfiguration(lineResult.data.configuration)
    });

    priceRows.push({
      quoteId,
      quoteLineId,
      companyId,
      quantity: qty,
      unitPrice: round(resolved.finalPrice, precision),
      priceTrace: withBasePriceSource(
        resolved.trace,
        QUOTE_BASE_PRICE_SOURCES.supplier
      ),
      exchangeRate,
      createdBy: userId,
      leadTime: 0,
      discountPercent: 0
    });
  }

  return { rows: priceRows, error: null };
}

export async function resolvePurchaseToOrderPrices(
  client: SupabaseClient<Database>,
  companyId: string,
  quoteId: string,
  quoteLineId: string,
  quantities: number[],
  userId: string
) {
  const { rows, error } = await buildPurchaseToOrderPriceRows(
    client,
    companyId,
    quoteId,
    quoteLineId,
    quantities,
    userId
  );
  if (error) return { error };
  if (!rows.length) return { error: null };

  const insertResult = await client.from("quoteLinePrice").insert(rows);
  if (insertResult.error) {
    logger.error("Failed to insert P2O quote line prices", {
      quoteLineId,
      error: insertResult.error
    });
    return { error: insertResult.error };
  }
  return { error: null };
}

export async function recalculateQuoteLinePrices(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  companyId: string,
  quoteId: string,
  quoteLineId: string,
  userId: string
) {
  // Callers pass a service-role client and URL ids: the line must belong to
  // this quote AND this company before any price row is read or rewritten.
  const [lineResult, quoteResult] = await Promise.all([
    client
      .from("quoteLine")
      .select("itemId, unitPricePrecision, configuration")
      .eq("id", quoteLineId)
      .eq("quoteId", quoteId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("quote")
      .select("customerId")
      .eq("id", quoteId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);

  if (lineResult.error) return { error: lineResult.error };
  if (quoteResult.error) return { error: quoteResult.error };
  if (!lineResult.data || !quoteResult.data) {
    logger.error("Quote line not found for price recalculation", {
      companyId,
      quoteId,
      quoteLineId
    });
    return {
      error: { message: "Quote line not found" } as PostgrestError
    };
  }

  // 1. Fetch existing price rows
  const existingPrices = await client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteLineId", quoteLineId)
    .eq("companyId", companyId);

  if (existingPrices.error) return { error: existingPrices.error };
  if (!existingPrices.data?.length) return { error: null };

  // 2. Line precision and customer context for engine pipe-through
  const precision = lineResult.data.unitPricePrecision ?? 2;
  const itemId = lineResult.data.itemId ?? undefined;
  const customerId = quoteResult.data.customerId ?? undefined;

  // Fetch default markups to use as fallback for legacy rows without categoryMarkups
  let defaultMarkups: Record<string, number> = {};
  if (companyId) {
    const settingsResult = await client
      .from("companySettings")
      .select("quoteLineCategoryMarkups")
      .eq("id", companyId)
      .single();

    const rawDefaults =
      (settingsResult.data?.quoteLineCategoryMarkups as Record<
        string,
        number
      >) ?? {};
    for (const [key, value] of Object.entries(rawDefaults)) {
      defaultMarkups[key] = value * 100;
    }
  }

  // 3. Build cost effects
  const result = await buildCostEffects(client, quoteLineId, {
    db,
    companyId
  });
  if (!result) return { error: null };

  const { effects } = result;

  const effectiveDefaults = getEffectiveDefaultMarkups(defaultMarkups);

  const configuration = asConfiguration(lineResult.data.configuration);
  const salePrice = await getConfiguredSalePrice(
    client,
    companyId,
    itemId,
    configuration
  );
  if (salePrice.error) return { error: salePrice.error };

  const repricedRows: {
    quantity: number;
    unitPrice: number;
    categoryMarkups: Record<string, number>;
    priceTrace: PriceTraceStep[] | null;
  }[] = [];
  for (const row of existingPrices.data) {
    const qty = row.quantity;

    const decision = decideRecalcPricing(
      {
        priceSource: row.priceSource,
        categoryMarkups: row.categoryMarkups as Record<string, number> | null
      },
      effectiveDefaults
    );

    // Manual price: a person or an external system stated this price.
    // Leave the row untouched — never re-derive it from costs or defaults
    // (the core fix).
    if (decision.mode === "preserve") {
      continue;
    }

    const markups = decision.markups;

    const categoryCosts: Record<string, number> = {};
    for (const key of costCategoryKeys) {
      const total = effects[key].reduce((acc, fn) => acc + fn(qty), 0);
      categoryCosts[key] = qty > 0 ? total / qty : 0;
    }

    const rollupPrice = costCategoryKeys.reduce((sum, key) => {
      const cost = categoryCosts[key] ?? 0;
      const markup = markups[key] ?? 0;
      return sum + cost * (1 + markup / 100);
    }, 0);

    const basePrice = configuredQuoteBasePrice({
      configuration,
      unitSalePrice: salePrice.data,
      categoryMarkups: row.categoryMarkups as Record<string, number> | null,
      defaultMarkups: effectiveDefaults
    });

    const resolved =
      itemId && companyId
        ? await resolvePrice(client, companyId, {
            itemId,
            quantity: qty,
            customerId,
            existingBasePrice: basePrice ?? rollupPrice,
            configuration
          })
        : null;

    repricedRows.push({
      quantity: qty,
      unitPrice: round(resolved?.finalPrice ?? rollupPrice, precision),
      // A row priced from the sale price is not cost-plus.
      categoryMarkups: basePrice === null ? markups : {},
      priceTrace: resolved
        ? withBasePriceSource(
            resolved.trace,
            basePrice === null ? QUOTE_BASE_PRICE_SOURCES.costPlus : null
          )
        : null
    });
  }

  // 5. Update only the repriced rows in place. Preserved (manual) rows are
  // not written at all, so no column can be lost or clobbered.
  for (const row of repricedRows) {
    const updateResult = await client
      .from("quoteLinePrice")
      .update({
        unitPrice: row.unitPrice,
        categoryMarkups: row.categoryMarkups,
        priceSource: "system",
        priceTrace: row.priceTrace,
        updatedBy: userId
      })
      .eq("quoteLineId", quoteLineId)
      .eq("companyId", companyId)
      .eq("quantity", row.quantity);

    if (updateResult.error) {
      logger.error("Failed to update quote line price during recalc", {
        quoteLineId,
        quantity: row.quantity,
        error: updateResult.error
      });
      return { error: updateResult.error };
    }
  }
  return { error: null };
}

/**
 * Explains each quantity's price on a quote line. `trace` is the snapshot
 * written with the price — how it was actually reached, whatever the rules say
 * now. `currentTrace` re-runs today's pipeline from the base the row's builder
 * starts from — the cost-plus rollup (or a configured part's sale price) for
 * Make to Order, the supplier price break for Purchase to Order, the item's
 * sale price for Pull from Inventory — so the UI can show what repricing would
 * change. A manual row has neither: a person stated that price and no rule
 * touched it. Read-only — null data when the line is not this quote's in this
 * company.
 */
export async function getQuoteLinePriceTraces(
  client: SupabaseClient<Database>,
  companyId: string,
  quoteId: string,
  quoteLineId: string
): Promise<{
  data: QuoteLinePriceTrace[] | null;
  error: PostgrestError | null;
}> {
  const [lineResult, quoteResult, pricesResult] = await Promise.all([
    client
      .from("quoteLine")
      .select("itemId, methodType, configuration")
      .eq("id", quoteLineId)
      .eq("quoteId", quoteId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("quote")
      .select("customerId")
      .eq("id", quoteId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("quoteLinePrice")
      .select("quantity, unitPrice, priceSource, categoryMarkups, priceTrace")
      .eq("quoteLineId", quoteLineId)
      .eq("companyId", companyId)
      .order("quantity")
  ]);

  const error = lineResult.error ?? quoteResult.error ?? pricesResult.error;
  if (error) return { data: null, error };
  if (!lineResult.data || !quoteResult.data) return { data: null, error: null };

  const itemId = lineResult.data.itemId;
  const methodType = lineResult.data.methodType;
  const customerId = quoteResult.data.customerId ?? undefined;
  const configuration = asConfiguration(lineResult.data.configuration);
  const rows = pricesResult.data ?? [];

  const stored = (row: (typeof rows)[number]): QuoteLinePriceTrace => ({
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    priceSource: row.priceSource as QuoteLinePriceSource,
    trace: (row.priceTrace as PriceTraceStep[] | null) ?? null,
    currentTrace: null
  });

  if (!itemId) return { data: rows.map(stored), error: null };

  // The base price each system row starts from today, and what it is; an
  // undefined amount lets resolvePrice read the item's sale price, as the Pull
  // from Inventory builder does.
  type BasePrice = { amount: number | undefined; source: string | null };
  let basePriceFor: (row: (typeof rows)[number]) => BasePrice = () => ({
    amount: undefined,
    source: null
  });

  if (methodType === "Make to Order") {
    const [settingsResult, salePrice, costEffects] = await Promise.all([
      client
        .from("companySettings")
        .select("quoteLineCategoryMarkups")
        .eq("id", companyId)
        .single(),
      getConfiguredSalePrice(client, companyId, itemId, configuration),
      buildCostEffects(client, quoteLineId)
    ]);
    if (settingsResult.error)
      return { data: null, error: settingsResult.error };
    if (salePrice.error) return { data: null, error: salePrice.error };
    // No costed method yet: nothing to roll up, so nothing to compare against.
    if (!costEffects) return { data: rows.map(stored), error: null };

    const defaultMarkups: Record<string, number> = {};
    for (const [key, value] of Object.entries(
      (settingsResult.data.quoteLineCategoryMarkups as Record<
        string,
        number
      >) ?? {}
    )) {
      defaultMarkups[key] = value * 100;
    }
    const effectiveDefaults = getEffectiveDefaultMarkups(defaultMarkups);
    const { effects } = costEffects;

    basePriceFor = (row) => {
      const categoryMarkups = row.categoryMarkups as CategoryMarkups | null;
      const decision = decideRecalcPricing(
        { priceSource: row.priceSource, categoryMarkups },
        effectiveDefaults
      );
      const markups = decision.mode === "reprice" ? decision.markups : {};
      const qty = row.quantity;
      const rollupPrice = costCategoryKeys.reduce((sum, key) => {
        const total = effects[key].reduce((acc, fn) => acc + fn(qty), 0);
        const cost = qty > 0 ? total / qty : 0;
        return sum + cost * (1 + (markups[key] ?? 0) / 100);
      }, 0);
      const configuredPrice = configuredQuoteBasePrice({
        configuration,
        unitSalePrice: salePrice.data,
        categoryMarkups,
        defaultMarkups: effectiveDefaults
      });
      return configuredPrice === null
        ? { amount: rollupPrice, source: QUOTE_BASE_PRICE_SOURCES.costPlus }
        : { amount: configuredPrice, source: null };
    };
  } else if (methodType === "Purchase to Order") {
    const priceMap = await getSupplierPriceBreaksForItems(client, [itemId]);
    basePriceFor = (row) => ({
      amount: lookupBuyPriceFromMap(itemId, row.quantity, priceMap, 0),
      source: QUOTE_BASE_PRICE_SOURCES.supplier
    });
  }

  const data = await Promise.all(
    rows.map(async (row) => {
      if (row.priceSource === "manual") return stored(row);
      const base = basePriceFor(row);
      const { trace } = await resolvePrice(client, companyId, {
        itemId,
        quantity: row.quantity,
        customerId,
        existingBasePrice: base.amount,
        configuration
      });
      return {
        ...stored(row),
        currentTrace: withBasePriceSource(trace, base.source)
      };
    })
  );

  return { data, error: null };
}

export class QuoteLockedError extends Error {
  constructor() {
    super("Cannot modify a locked quote. Reopen it first.");
  }
}

/**
 * Reprices a quote line's system rows to what today's rules give — the
 * `currentTrace` getQuoteLinePriceTraces shows — storing that trace with the
 * price. Manual rows, and rows today's pipeline cannot price, are rewritten
 * unchanged; one transaction either way. Draft quotes only (QuoteLockedError
 * otherwise) — checked here, not in the route, because this is also an MCP
 * tool.
 */
export async function repriceQuoteLineFromRules(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  companyId: string,
  quoteId: string,
  quoteLineId: string,
  userId: string
): Promise<{ data: null; error: PostgrestError | Error | null }> {
  const quote = await client
    .from("quote")
    .select("status")
    .eq("id", quoteId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (quote.error) return { data: null, error: quote.error };
  if (!quote.data) return { data: null, error: new Error("Quote not found") };
  if (isQuoteLocked(quote.data.status)) {
    return { data: null, error: new QuoteLockedError() };
  }

  const traces = await getQuoteLinePriceTraces(
    client,
    companyId,
    quoteId,
    quoteLineId
  );
  if (traces.error) return { data: null, error: traces.error };
  if (!traces.data) {
    return { data: null, error: new Error("Quote line not found") };
  }

  const prices = traces.data.map((price) => {
    const finalPrice = price.currentTrace?.at(-1)?.amount;
    if (!price.currentTrace || finalPrice === undefined) {
      return {
        quoteLineId,
        quantity: price.quantity,
        unitPrice: price.unitPrice,
        priceTrace: price.trace,
        createdBy: userId
      };
    }
    return {
      quoteLineId,
      quantity: price.quantity,
      unitPrice: finalPrice,
      priceTrace: price.currentTrace,
      priceSource: "system" as const,
      createdBy: userId
    };
  });

  try {
    await upsertQuoteLinePrices(db, companyId, quoteId, quoteLineId, prices);
  } catch (error) {
    logger.error("Failed to reprice quote line from rules", {
      companyId,
      quoteId,
      quoteLineId,
      error
    });
    return { data: null, error: error as Error };
  }
  return { data: null, error: null };
}

export async function upsertQuoteLineMethod(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  lineMethod: {
    itemId: string;
    quoteId: string;
    quoteLineId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  }
) {
  const body: {
    type: "itemToQuoteLine";
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  } = {
    type: "itemToQuoteLine",
    sourceId: lineMethod.itemId,
    targetId: `${lineMethod.quoteId}:${lineMethod.quoteLineId}`,
    companyId: lineMethod.companyId,
    userId: lineMethod.userId
  };

  // Only add configuration if it exists
  if (lineMethod.configuration !== undefined) {
    body.configuration = lineMethod.configuration;
  }

  // Only add parts if it exists
  if (lineMethod.parts !== undefined) {
    body.parts = lineMethod.parts;
  }

  return invokePosting(
    { client, db, companyId: body.companyId, userId: body.userId },
    "get-method",
    body,
    productionPostings.getMethod,
    { as: productionPostings.getMethodPermission }
  );
}

export async function upsertQuoteMaterial(
  client: SupabaseClient<Database>,
  quoteMaterial:
    | (z.infer<typeof quoteMaterialValidator> & {
        quoteId: string;
        quoteLineId: string;
        quoteOperationId?: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof quoteMaterialValidator> & {
        quoteId: string;
        quoteLineId: string;
        quoteOperationId?: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("updatedBy" in quoteMaterial) {
    // A material never moves between quotes, lines, make methods or tenants —
    // strip the parent columns so an update cannot re-parent the row, and
    // scope it to the caller's company (callers may pass a service-role client).
    const {
      id,
      companyId,
      quoteId: _quoteId,
      quoteLineId: _quoteLineId,
      quoteMakeMethodId: _quoteMakeMethodId,
      ...update
    } = quoteMaterial;
    return client
      .from("quoteMaterial")
      .update(sanitize(update))
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id, methodType")
      .single();
  }
  return client
    .from("quoteMaterial")
    .insert([quoteMaterial])
    .select("id, methodType")
    .single();
}

export async function upsertQuoteMaterialMakeMethod(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  quoteMethod: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  }
) {
  const body: {
    type: "itemToQuoteMakeMethod";
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  } = {
    type: "itemToQuoteMakeMethod",
    sourceId: quoteMethod.sourceId,
    targetId: quoteMethod.targetId,
    companyId: quoteMethod.companyId,
    userId: quoteMethod.userId
  };

  // Only add configuration if it exists
  if (quoteMethod.configuration !== undefined) {
    body.configuration = quoteMethod.configuration;
  }

  // Only add parts if it exists
  if (quoteMethod.parts !== undefined) {
    body.parts = quoteMethod.parts;
  }

  const { error } = await invokePosting(
    { client, db, companyId: body.companyId, userId: body.userId },
    "get-method",
    body,
    productionPostings.getMethod,
    { as: productionPostings.getMethodPermission }
  );

  if (error) {
    return {
      data: null,
      error: { message: "Failed to pull method" } as PostgrestError
    };
  }

  return { data: null, error: null };
}

export async function upsertQuoteOperation(
  client: SupabaseClient<Database>,
  operation:
    | (Omit<z.infer<typeof quoteOperationValidator>, "id"> & {
        quoteId: string;
        quoteLineId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof quoteOperationValidator> & {
        quoteId: string;
        quoteLineId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quoteOperationValidator>, "id"> & {
        id: string;
        quoteId: string;
        quoteLineId: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in operation) {
    return client
      .from("quoteOperation")
      .insert([normalizeOperationSourceIds(operation)])
      .select("id")
      .single();
  }
  // An operation never moves between quotes, lines, make methods or tenants —
  // strip the parent columns so an update cannot re-parent the row.
  const {
    id,
    companyId,
    quoteId: _quoteId,
    quoteLineId: _quoteLineId,
    quoteMakeMethodId: _quoteMakeMethodId,
    ...update
  } = operation;
  return client
    .from("quoteOperation")
    .update(sanitize(normalizeOperationSourceIds(update)))
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

export async function upsertQuoteOperationStep(
  client: SupabaseClient<Database>,
  quoteOperationStep:
    | (Omit<z.infer<typeof operationStepValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<
        z.infer<typeof operationStepValidator>,
        "id" | "minValue" | "maxValue"
      > & {
        id: string;
        minValue: number | null;
        maxValue: number | null;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in quoteOperationStep) {
    return client
      .from("quoteOperationStep")
      .insert(quoteOperationStep)
      .select("id")
      .single();
  }

  return client
    .from("quoteOperationStep")
    .update(sanitize(quoteOperationStep))
    .eq("id", quoteOperationStep.id)
    .select("id")
    .single();
}

export async function upsertQuoteOperationParameter(
  client: SupabaseClient<Database>,
  quoteOperationParameter:
    | (Omit<z.infer<typeof operationParameterValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof operationParameterValidator>, "id"> & {
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in quoteOperationParameter) {
    return client
      .from("quoteOperationParameter")
      .insert(quoteOperationParameter)
      .select("id")
      .single();
  }

  return client
    .from("quoteOperationParameter")
    .update(sanitize(quoteOperationParameter))
    .eq("id", quoteOperationParameter.id)
    .select("id")
    .single();
}

export async function upsertQuoteOperationTool(
  client: SupabaseClient<Database>,
  quoteOperationTool:
    | (Omit<z.infer<typeof operationToolValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof operationToolValidator>, "id"> & {
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in quoteOperationTool) {
    return client
      .from("quoteOperationTool")
      .insert(quoteOperationTool)
      .select("id")
      .single();
  }

  return client
    .from("quoteOperationTool")
    .update(sanitize(quoteOperationTool))
    .eq("id", quoteOperationTool.id)
    .select("id")
    .single();
}

export async function upsertQuotePayment(
  client: SupabaseClient<Database>,
  quotePayment:
    | (z.infer<typeof quotePaymentValidator> & {
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof quotePaymentValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in quotePayment) {
    return client
      .from("quotePayment")
      .update(sanitize(quotePayment))
      .eq("id", quotePayment.id)
      .select("id")
      .single();
  }
  return client
    .from("quotePayment")
    .insert([quotePayment])
    .select("id")
    .single();
}

export async function upsertQuoteShipment(
  client: SupabaseClient<Database>,
  quoteShipment:
    | (z.infer<typeof quoteShipmentValidator> & {
        createdBy: string;
      })
    | (z.infer<typeof quoteShipmentValidator> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("id" in quoteShipment) {
    return client
      .from("quoteShipment")
      .update(sanitize(quoteShipment))
      .eq("id", quoteShipment.id)
      .select("id")
      .single();
  }
  return client
    .from("quoteShipment")
    .insert([quoteShipment])
    .select("id")
    .single();
}

export async function updateSalesOrderFavorite(
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
      .from("salesOrderFavorite")
      .delete()
      .eq("salesOrderId", id)
      .eq("userId", userId);
  } else {
    return client
      .from("salesOrderFavorite")
      .insert({ salesOrderId: id, userId: userId });
  }
}

export async function updateSalesOrderStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof salesOrderStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  const { status, ...rest } = update;

  // Set completedDate when status is Confirmed
  const updateData = {
    status,
    ...rest,
    ...(["To Ship", "To Ship and Invoice"].includes(status)
      ? { completedDate: datetime.timestamp() }
      : {})
  };

  return client.from("salesOrder").update(updateData).eq("id", update.id);
}

export async function insertSalesOrder(
  client: SupabaseClient<Database>,
  input: {
    customerId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    salesOrderId?: string;
    locationId?: string;
    status?: (typeof salesOrderStatusType)[number];
    currencyCode?: string;
    orderDate?: string;
    customerContactId?: string;
    customerLocationId?: string;
    quoteId?: string;
    opportunityId?: string;
    requestedDate?: string;
    promisedDate?: string;
    notes?: string;
    customerReference?: string;
    customerEngineeringContactId?: string;
    salesPersonId?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; salesOrderId: string } | null;
  error: PostgrestError | null;
}> {
  let salesOrderId: string;
  if (input.salesOrderId) {
    salesOrderId = input.salesOrderId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "salesOrder",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({ message: "Failed to generate SO sequence" } as PostgrestError)
      };
    }
    salesOrderId = seq.data;
  }

  let opportunityId = input.opportunityId;
  if (!opportunityId) {
    const opportunity = await client
      .from("opportunity")
      .insert({
        customerId: input.customerId,
        companyId: input.companyId
      })
      .select("id")
      .single();

    if (opportunity.error) return { data: null, error: opportunity.error };
    opportunityId = opportunity.data.id;
  }

  const [customerPayment, customerShipping, seller] = await Promise.all([
    getCustomerPayment(client, input.customerId),
    getCustomerShipping(client, input.customerId),
    getEmployeeJob(client, input.createdBy, input.companyId)
  ]);

  if (customerPayment.error)
    return { data: null, error: customerPayment.error };
  if (customerShipping.error)
    return { data: null, error: customerShipping.error };

  const {
    paymentTermId,
    invoiceCustomerId,
    invoiceCustomerContactId,
    invoiceCustomerLocationId
  } = customerPayment.data;

  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    customerShipping.data;

  // Look up the base currency if none was provided
  let currencyCode = input.currencyCode;
  if (!currencyCode) {
    const companyResult = await client
      .from("company")
      .select("baseCurrencyCode")
      .eq("id", input.companyId)
      .single();
    currencyCode = companyResult.data?.baseCurrencyCode ?? "USD";
  }

  let exchangeRate = 1;
  let exchangeRateUpdatedAt = new Date().toISOString();
  if (currencyCode) {
    const exchangeRateResult = await getExchangeRate(
      client,
      input.companyId,
      currencyCode
    );
    if (exchangeRateResult.error) {
      return { data: null, error: exchangeRateResult.error };
    }
    exchangeRate = exchangeRateResult.data;
    exchangeRateUpdatedAt = new Date().toISOString();
  }

  const locationId = input.locationId ?? seller?.data?.locationId ?? null;

  const order = await client
    .from("salesOrder")
    .insert({
      salesOrderId,
      customerId: input.customerId,
      customerContactId: input.customerContactId,
      customerLocationId: input.customerLocationId,
      customerEngineeringContactId: input.customerEngineeringContactId ?? null,
      customerReference: input.customerReference ?? null,
      salesPersonId: input.salesPersonId ?? null,
      opportunityId,
      status: input.status ?? "Draft",
      orderDate:
        input.orderDate ??
        datetime
          .today(await getCompanyTimeZone(client, input.companyId))
          .toString(),
      currencyCode,
      exchangeRate,
      exchangeRateUpdatedAt,
      locationId,
      internalNotes: input.notes ?? null,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, salesOrderId")
    .single();

  if (order.error) return { data: null, error: order.error };

  const orderId = order.data.id;

  const [shipment, payment] = await Promise.all([
    client.from("salesOrderShipment").insert({
      id: orderId,
      locationId,
      receiptRequestedDate: input.requestedDate ?? null,
      receiptPromisedDate: input.promisedDate ?? null,
      shippingMethodId,
      shippingTermId,
      incoterm,
      incotermLocation,
      companyId: input.companyId
    }),
    client.from("salesOrderPayment").insert({
      id: orderId,
      paymentTermId,
      invoiceCustomerId: invoiceCustomerId ?? input.customerId,
      invoiceCustomerContactId,
      invoiceCustomerLocationId,
      companyId: input.companyId
    })
  ]);

  if (shipment.error || payment.error) {
    await deleteSalesOrder(client, orderId);
    return { data: null, error: shipment.error ?? payment.error };
  }

  return { data: { id: orderId, salesOrderId }, error: null };
}

export async function updateSalesOrder(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    status?: (typeof salesOrderStatusType)[number];
    currencyCode?: string;
    orderDate?: string;
    customerContactId?: string | null;
    customerLocationId?: string | null;
    customerId?: string;
    notes?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: PostgrestError | null;
}> {
  const { id, updatedBy, notes, ...updates } = input;

  let exchangeRate: number | undefined;
  let exchangeRateUpdatedAt: string | undefined;

  const existing = await client
    .from("salesOrder")
    .select("companyId, currencyCode, opportunityId")
    .eq("id", id)
    .single();

  if (existing.error) return { data: null, error: existing.error };

  if (
    updates.currencyCode &&
    existing.data.currencyCode !== updates.currencyCode
  ) {
    const exchangeRateResult = await getExchangeRate(
      client,
      existing.data.companyId,
      updates.currencyCode
    );
    if (exchangeRateResult.error) {
      return { data: null, error: exchangeRateResult.error };
    }
    exchangeRate = exchangeRateResult.data;
    exchangeRateUpdatedAt = new Date().toISOString();
  }

  if (updates.customerId && existing.data.opportunityId) {
    await client
      .from("opportunity")
      .update({ customerId: updates.customerId })
      .eq("id", existing.data.opportunityId);
  }

  return client
    .from("salesOrder")
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

export const LIVE_JOB_STATUSES: Database["public"]["Enums"]["jobStatus"][] = [
  "Draft",
  "Ready",
  "In Progress",
  "Paused"
];

export async function cancelSalesOrder(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    userId: string;
    jobs?: string[];
  }
): Promise<{
  success: boolean;
  message: string;
  cancelledJobIds: string[];
}> {
  const orderUpdate = await updateSalesOrderStatus(client, {
    id: args.id,
    status: "Cancelled",
    assignee: undefined,
    updatedBy: args.userId
  });

  if (orderUpdate.error) {
    return {
      success: false,
      message: `Failed to cancel sales order: ${orderUpdate.error.message}`,
      cancelledJobIds: []
    };
  }

  // Resolve the set of job ids to cancel.
  let jobIdsToCancel: string[];
  if (args.jobs === undefined) {
    const liveJobs = await client
      .from("job")
      .select("id")
      .eq("salesOrderId", args.id)
      .in("status", LIVE_JOB_STATUSES);
    if (liveJobs.error) {
      return {
        success: false,
        message:
          "Sales order cancelled, but failed to look up associated jobs to cancel",
        cancelledJobIds: []
      };
    }
    jobIdsToCancel = (liveJobs.data ?? [])
      .map((j) => j.id)
      .filter((v): v is string => Boolean(v));
  } else {
    jobIdsToCancel = args.jobs.filter(Boolean);
  }

  if (jobIdsToCancel.length === 0) {
    return {
      success: true,
      message: "Sales order cancelled",
      cancelledJobIds: []
    };
  }

  const jobUpdate = await client
    .from("job")
    .update({ status: "Cancelled", updatedBy: args.userId })
    .in("id", jobIdsToCancel)
    .in("status", LIVE_JOB_STATUSES)
    .select("id");

  if (jobUpdate.error) {
    return {
      success: false,
      message: `Sales order cancelled, but failed to cancel some associated jobs: ${jobUpdate.error.message}`,
      cancelledJobIds: []
    };
  }

  const cancelledJobIds = (jobUpdate.data ?? [])
    .map((j) => j.id)
    .filter((v): v is string => Boolean(v));

  return {
    success: true,
    message:
      cancelledJobIds.length === 0
        ? "Sales order cancelled"
        : `Sales order cancelled and ${cancelledJobIds.length} job${cancelledJobIds.length === 1 ? "" : "s"} cancelled`,
    cancelledJobIds
  };
}

export async function upsertSalesOrderShipment(
  client: SupabaseClient<Database>,
  salesOrderShipment:
    | (z.infer<typeof salesOrderShipmentValidator> & {
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof salesOrderShipmentValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesOrderShipment) {
    return client
      .from("salesOrderShipment")
      .update(sanitize(salesOrderShipment))
      .eq("id", salesOrderShipment.id)
      .select("id")
      .single();
  }
  return client
    .from("salesOrderShipment")
    .insert([salesOrderShipment])
    .select("id")
    .single();
}

/** Not published: `sales.order.line.create` / `update` also refuse a locked order. */
export async function upsertSalesOrderLine(
  client: SupabaseClient<Database>,
  salesOrderLine:
    | (Omit<z.infer<typeof salesOrderLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesOrderLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  // Only a Service line has a service period — every other item type is a
  // physical good, earned when it ships. A cleared DatePicker posts "", which
  // a DATE column rejects, so both collapse to null.
  const isService = salesOrderLine.salesOrderLineType === "Service";
  const servicePeriod = {
    serviceStartDate: (isService && salesOrderLine.serviceStartDate) || null,
    serviceEndDate: (isService && salesOrderLine.serviceEndDate) || null
  };
  // A service is promised for the day it starts: a line with a service period
  // takes its promised date from it, and the form hides the field.
  const promisedDate =
    servicePeriod.serviceStartDate ?? salesOrderLine.promisedDate;

  if ("id" in salesOrderLine) {
    // salesOrderLine has no serviceId column.
    const { serviceId: _serviceId, ...lineUpdate } = salesOrderLine;
    return client
      .from("salesOrderLine")
      .update(
        sanitize({
          ...lineUpdate,
          ...servicePeriod,
          promisedDate
        })
      )
      .eq("id", salesOrderLine.id)
      .select("id")
      .single();
  }

  const salesOrder = await getSalesOrder(client, salesOrderLine.salesOrderId);
  if (salesOrder.error) return salesOrder;

  const exchangeRate = salesOrder.data.exchangeRate;
  if (exchangeRate === null) {
    return {
      data: null,
      error: new Error(
        `Sales order ${salesOrderLine.salesOrderId} has no exchange rate`
      )
    };
  }

  const existing = await client
    .from("salesOrderLine")
    .select("sortOrder")
    .eq("salesOrderId", salesOrderLine.salesOrderId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("salesOrderLine")
    .insert([
      {
        ...salesOrderLine,
        // methodType is NOT NULL DEFAULT 'Pull from Inventory', but the validator
        // legitimately omits it for Fixed Asset / Comment lines. Because the key is
        // still present (as undefined) in the spread, PostgREST lists the column and
        // inserts NULL rather than applying the DB default — a not-null violation.
        // Supply the column default explicitly so those line types insert cleanly.
        methodType: salesOrderLine.methodType ?? "Pull from Inventory",
        setupPrice: salesOrderLine.setupPrice ?? 0,
        unitPrice: salesOrderLine.unitPrice ?? 0,
        shippingCost: salesOrderLine.shippingCost ?? 0,
        addOnCost: salesOrderLine.addOnCost ?? 0,
        nonTaxableAddOnCost: salesOrderLine.nonTaxableAddOnCost ?? 0,
        taxPercent: salesOrderLine.taxPercent ?? 0,
        ...servicePeriod,
        promisedDate,
        exchangeRate,
        sortOrder: maxSortOrder + 1
      }
    ])
    .select("id")
    .single();
}

export async function updateSalesOrderLineOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  salesOrderId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "salesOrderLine",
    column: "sortOrder",
    companyId,
    userId,
    parent: { column: "salesOrderId", id: salesOrderId },
    updates
  });
}

export async function upsertSalesOrderPayment(
  client: SupabaseClient<Database>,
  salesOrderPayment:
    | (z.infer<typeof salesOrderPaymentValidator> & {
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof salesOrderPaymentValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  // The currency is the order's; salesOrderPayment has no currencyCode column.
  if ("id" in salesOrderPayment) {
    const { currencyCode: _currencyCode, ...paymentUpdate } = salesOrderPayment;
    return client
      .from("salesOrderPayment")
      .update(sanitize(paymentUpdate))
      .eq("id", salesOrderPayment.id)
      .select("id")
      .single();
  }
  return client
    .from("salesOrderPayment")
    .insert([salesOrderPayment])
    .select("id")
    .single();
}

export async function insertSalesRFQ(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    customerId: string;
    companyId: string;
    createdBy: string;
    rfqId?: string;
    rfqDate?: string;
    expirationDate?: string;
    locationId?: string;
    salesPersonId?: string;
    customerContactId?: string;
    customerEngineeringContactId?: string;
    customerLocationId?: string;
    customerReference?: string;
    status?: "Draft" | "Ready for Quote" | "Quoted" | "Closed";
    notes?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; rfqId: string } | null;
  error: PostgrestError | null;
}> {
  // Kysely bypasses RLS and the dispatcher reaches this with caller-supplied
  // ids: the customer, its contacts and location, the location and the sales
  // person must all belong to this company (the contacts and location to this
  // customer) before any of them is written onto the RFQ.
  const { companyId, customerId } = input;
  const contactIds = [
    ...new Set(
      [input.customerContactId, input.customerEngineeringContactId].filter(
        (id): id is string => !!id
      )
    )
  ];
  const [customer, contacts, customerLocation, location, salesPerson] =
    await Promise.all([
      db
        .selectFrom("customer")
        .select("id")
        .where("id", "=", customerId)
        .where("companyId", "=", companyId)
        .executeTakeFirst(),
      contactIds.length > 0
        ? db
            .selectFrom("customerContact")
            .select("id")
            .where("id", "in", contactIds)
            .where("customerId", "=", customerId)
            .where("companyId", "=", companyId)
            .execute()
        : [],
      input.customerLocationId
        ? db
            .selectFrom("customerLocation")
            .select("id")
            .where("id", "=", input.customerLocationId)
            .where("customerId", "=", customerId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : null,
      input.locationId
        ? db
            .selectFrom("location")
            .select("id")
            .where("id", "=", input.locationId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : null,
      input.salesPersonId
        ? db
            .selectFrom("employee")
            .select("id")
            .where("id", "=", input.salesPersonId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : null
    ]);
  if (
    !customer ||
    contacts.length !== contactIds.length ||
    (input.customerLocationId && !customerLocation) ||
    (input.locationId && !location) ||
    (input.salesPersonId && !salesPerson)
  ) {
    return {
      data: null,
      error: {
        message: "Customer, contact, location or sales person not found"
      } as PostgrestError
    };
  }

  let rfqId: string;
  if (input.rfqId) {
    rfqId = input.rfqId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "salesRfq",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate salesRfq sequence"
          } as PostgrestError)
      };
    }
    rfqId = seq.data;
  }

  const rfqDate =
    input.rfqDate ??
    datetime
      .today(await getCompanyTimeZone(client, input.companyId))
      .toString();

  // The opportunity and the RFQ are created together or not at all — a failed
  // RFQ insert must not leave an orphaned opportunity behind.
  try {
    const rfq = await db.transaction().execute(async (trx) => {
      const opportunity = await trx
        .insertInto("opportunity")
        .values({
          companyId: input.companyId,
          customerId: input.customerId
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      return trx
        .insertInto("salesRfq")
        .values({
          rfqId,
          customerId: input.customerId,
          customerContactId: input.customerContactId,
          customerEngineeringContactId: input.customerEngineeringContactId,
          customerLocationId: input.customerLocationId,
          customerReference: input.customerReference,
          rfqDate,
          expirationDate: input.expirationDate,
          locationId: input.locationId,
          salesPersonId: input.salesPersonId,
          status: input.status ?? "Draft",
          internalNotes: input.notes ?? null,
          customFields: input.customFields,
          opportunityId: opportunity.id,
          companyId: input.companyId,
          createdBy: input.createdBy,
          updatedBy: input.createdBy
        })
        .returning(["id", "rfqId"])
        .executeTakeFirstOrThrow();
    });

    return { data: { id: rfq.id, rfqId: rfq.rfqId }, error: null };
  } catch (err) {
    return {
      data: null,
      error: {
        message:
          err instanceof Error ? err.message : "Failed to insert sales RFQ"
      } as PostgrestError
    };
  }
}

export async function updateSalesRFQ(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    customerId?: string;
    customerContactId?: string | null;
    customerEngineeringContactId?: string | null;
    customerLocationId?: string | null;
    customerReference?: string | null;
    rfqDate?: string;
    expirationDate?: string | null;
    locationId?: string;
    salesPersonId?: string | null;
    status?: "Draft" | "Ready for Quote" | "Quoted" | "Closed";
    notes?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: PostgrestError | null;
}> {
  const { id, updatedBy, customerId, notes, ...updates } = input;

  // If customerId is being updated, also update the opportunity's customerId
  if (customerId) {
    const existingRfq = await client
      .from("salesRfq")
      .select("opportunityId")
      .eq("id", id)
      .single();

    if (existingRfq.data?.opportunityId) {
      await client
        .from("opportunity")
        .update({ customerId })
        .eq("id", existingRfq.data.opportunityId);
    }
  }

  return client
    .from("salesRfq")
    .update({
      ...sanitize(updates),
      ...(customerId && { customerId }),
      ...(notes !== undefined && { internalNotes: notes }),
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

/**
 * @deprecated Use insertSalesRFQ for new RFQs, updateSalesRFQ for existing RFQs
 */
export async function upsertSalesRFQ(
  client: SupabaseClient<Database>,
  rfq:
    | (Omit<z.infer<typeof salesRfqValidator>, "id" | "rfqId"> & {
        rfqId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesRfqValidator>, "id" | "rfqId"> & {
        id: string;
        rfqId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in rfq) {
    const opportunity = await client
      .from("opportunity")
      .insert([{ companyId: rfq.companyId, customerId: rfq.customerId }])
      .select("id")
      .single();

    if (opportunity.error) {
      return opportunity;
    }

    const insert = await client
      .from("salesRfq")
      .insert([
        {
          ...rfq,
          opportunityId: opportunity.data?.id
        }
      ])
      .select("id, rfqId");
    if (insert.error) {
      return insert;
    }

    return insert;
  } else {
    // If customerId is being updated, also update the opportunity's customerId
    if (rfq.customerId) {
      const existingRfq = await client
        .from("salesRfq")
        .select("opportunityId")
        .eq("id", rfq.id)
        .single();

      if (existingRfq.data?.opportunityId) {
        await client
          .from("opportunity")
          .update({ customerId: rfq.customerId })
          .eq("id", existingRfq.data.opportunityId);
      }
    }

    return client
      .from("salesRfq")
      .update({
        ...sanitize(rfq),
        updatedAt: datetime.timestamp()
      })
      .eq("id", rfq.id);
  }
}

export async function upsertSalesRFQLine(
  client: SupabaseClient<Database>,

  salesRfqLine:
    | (Omit<z.infer<typeof salesRfqLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesRfqLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in salesRfqLine) {
    const existing = await client
      .from("salesRfqLine")
      .select("order")
      .eq("salesRfqId", salesRfqLine.salesRfqId);

    const maxOrder = (existing.data ?? []).reduce(
      (max, row) => Math.max(max, row.order ?? 0),
      0
    );

    return client
      .from("salesRfqLine")
      .insert([{ ...salesRfqLine, order: maxOrder + 1 }])
      .select("id")
      .single();
  }
  return client
    .from("salesRfqLine")
    .update(sanitize(salesRfqLine))
    .eq("id", salesRfqLine.id)
    .select("id")
    .single();
}

/** Points each RFQ line at its item in one statement, scoped to the RFQ. */
export async function setSalesRfqLineItems(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  salesRfqId: string,
  lines: { lineId: string; itemId: string }[]
) {
  if (lines.length === 0) return;
  const values = lines.map(
    (line) => sql`(${line.lineId}::text, ${line.itemId}::text)`
  );
  await sql`
    UPDATE "salesRfqLine" AS l
    SET "itemId" = v."itemId",
        "updatedBy" = ${userId},
        "updatedAt" = now()
    FROM (VALUES ${sql.join(values)}) AS v("lineId", "itemId")
    WHERE l."id" = v."lineId"
      AND l."companyId" = ${companyId}
      AND l."salesRfqId" = ${salesRfqId}
  `.execute(db);
}

export async function updateSalesRFQLineOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  salesRfqId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "salesRfqLine",
    column: "order",
    companyId,
    userId,
    parent: { column: "salesRfqId", id: salesRfqId },
    updates
  });
}

// ─── Sales Return Orders (RMAs) ───

export async function getReturnReasons(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("returnReason")
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

export async function getReturnReasonsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("returnReason")
    .select("id, name, inventoryValueZero")
    .eq("companyId", companyId)
    .order("name");
}

export async function getReturnReason(
  client: SupabaseClient<Database>,
  returnReasonId: string
) {
  return client
    .from("returnReason")
    .select("*")
    .eq("id", returnReasonId)
    .single();
}

export async function upsertReturnReason(
  client: SupabaseClient<Database>,
  returnReason:
    | (Omit<z.infer<typeof returnReasonValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof returnReasonValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in returnReason) {
    return client
      .from("returnReason")
      .insert([returnReason])
      .select("id")
      .single();
  }
  return client
    .from("returnReason")
    .update({
      ...sanitize(returnReason),
      inventoryValueZero: returnReason.inventoryValueZero,
      updatedAt: datetime.timestamp()
    })
    .eq("id", returnReason.id)
    .select("id")
    .single();
}

export async function deleteReturnReason(
  client: SupabaseClient<Database>,
  returnReasonId: string
) {
  return client.from("returnReason").delete().eq("id", returnReasonId);
}

export async function getSalesReturnOrders(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: string | null;
    customerId: string | null;
  }
) {
  let query = client
    .from("salesReturnOrders")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      searchFilter(["salesReturnOrderId", "customerReference"], args.search)
    );
  }

  if (args.status) {
    query = query.eq(
      "status",
      args.status as (typeof salesReturnOrderStatusType)[number]
    );
  }

  if (args.customerId) {
    query = query.eq("customerId", args.customerId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

export async function getSalesReturnOrder(
  client: SupabaseClient<Database>,
  salesReturnOrderId: string
) {
  return client
    .from("salesReturnOrders")
    .select("*")
    .eq("id", salesReturnOrderId)
    .single();
}

export async function getSalesReturnOrderLines(
  client: SupabaseClient<Database>,
  salesReturnOrderId: string,
  companyId: string
) {
  return client
    .from("salesReturnOrderLine")
    .select(
      "*, returnReason(name), item(name, readableIdWithRevision, itemTrackingType, thumbnailPath)"
    )
    .eq("salesReturnOrderId", salesReturnOrderId)
    .eq("companyId", companyId)
    .order("lineNumber");
}

export async function getSalesReturnOrderLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client
    .from("salesReturnOrderLine")
    .select("*")
    .eq("id", lineId)
    .single();
}

export async function getSalesReturnOrderLineTrackedEntities(
  client: SupabaseClient<Database>,
  lineIds: string[]
) {
  return client
    .from("salesReturnOrderLineTrackedEntity")
    .select("*, trackedEntity(id, readableId, status, quantity)")
    .in("salesReturnOrderLineId", lineIds);
}

export async function insertSalesReturnOrder(
  client: SupabaseClient<Database>,
  input: {
    customerId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    salesReturnOrderId?: string;
    orderDate: string;
    customerLocationId?: string;
    customerContactId?: string;
    customerReference?: string;
    locationId?: string;
    salesOrderId?: string;
    currencyCode?: string;
    expirationDate?: string;
    assignee?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; salesReturnOrderId: string } | null;
  error: PostgrestError | null;
}> {
  let salesReturnOrderId: string;
  if (input.salesReturnOrderId) {
    salesReturnOrderId = input.salesReturnOrderId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "salesReturnOrder",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({ message: "Failed to generate RMA sequence" } as PostgrestError)
      };
    }
    salesReturnOrderId = seq.data;
  }

  let currencyCode = input.currencyCode;
  if (!currencyCode) {
    const [customer, company] = await Promise.all([
      client
        .from("customer")
        .select("currencyCode")
        .eq("id", input.customerId)
        .single(),
      client
        .from("company")
        .select("baseCurrencyCode")
        .eq("id", input.companyId)
        .single()
    ]);
    currencyCode =
      customer.data?.currencyCode ?? company.data?.baseCurrencyCode ?? "USD";
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
    .from("salesReturnOrder")
    .insert({
      salesReturnOrderId,
      customerId: input.customerId,
      customerLocationId: input.customerLocationId,
      customerContactId: input.customerContactId,
      customerReference: input.customerReference ?? null,
      locationId: input.locationId,
      salesOrderId: input.salesOrderId,
      currencyCode,
      exchangeRate,
      orderDate: input.orderDate,
      expirationDate: input.expirationDate,
      assignee: input.assignee,
      companyId: input.companyId,
      createdBy: input.createdBy,
      customFields: input.customFields
    })
    .select("id, salesReturnOrderId")
    .single();

  return order;
}

/** Not published: `sales.returnOrder.line.create` refuses a non-Draft RMA. */
export async function upsertSalesReturnOrderLine(
  client: SupabaseClient<Database>,
  line:
    | (Omit<
        z.infer<typeof salesReturnOrderLineValidator>,
        "id" | "trackedEntityIds"
      > & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<
        z.infer<typeof salesReturnOrderLineValidator>,
        "id" | "trackedEntityIds"
      > & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in line) {
    const existing = await client
      .from("salesReturnOrderLine")
      .select("lineNumber")
      .eq("salesReturnOrderId", line.salesReturnOrderId)
      .eq("companyId", line.companyId)
      .order("lineNumber", { ascending: false })
      .limit(1)
      .maybeSingle();

    return client
      .from("salesReturnOrderLine")
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
    .from("salesReturnOrderLine")
    .update({ ...sanitize(update), updatedAt: datetime.timestamp() })
    .eq("id", id)
    .select("id")
    .single();
}

export async function deleteSalesReturnOrder(
  client: SupabaseClient<Database>,
  salesReturnOrderId: string
) {
  return client.from("salesReturnOrder").delete().eq("id", salesReturnOrderId);
}

export async function deleteSalesReturnOrderLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client.from("salesReturnOrderLine").delete().eq("id", lineId);
}

export async function getSalesReturnOrderReceipts(
  client: SupabaseClient<Database>,
  salesReturnOrderId: string,
  companyId: string
) {
  return client
    .from("receipt")
    .select("id, receiptId, status, postingDate, createdAt")
    .eq("sourceDocumentId", salesReturnOrderId)
    .eq("sourceDocument", "Sales Return Order")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

export async function getSalesReturnOrderCredits(
  client: SupabaseClient<Database>,
  salesReturnOrderId: string,
  companyId: string
) {
  return client
    .from("memo")
    .select("id, memoId, status, amount, currencyCode, memoDate, postingDate")
    .eq("salesReturnOrderId", salesReturnOrderId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

export async function getSalesReturnOrderIssues(
  client: SupabaseClient<Database>,
  salesReturnOrderId: string,
  companyId: string
) {
  return client
    .from("nonConformanceSalesReturnOrderLine")
    .select(
      "id, salesReturnOrderLineId, nonConformance(id, nonConformanceId, name, status)"
    )
    .eq("salesReturnOrderId", salesReturnOrderId)
    .eq("companyId", companyId);
}

/**
 * Confirm an RMA. The reversible-quantity cap is a transactional invariant:
 * the governing SOURCE rows (shipment/SO/invoice lines) are row-locked so two
 * concurrent confirms against the same source line serialize, and the
 * aggregates are re-read under that lock (replaceInvoiceSettlements pattern).
 * Not published: `sales.returnOrder.confirm` also files the PDF.
 */
export async function confirmSalesReturnOrder(
  db: Kysely<KyselyDatabase>,
  { id, companyId }: { id: string; companyId: string },
  userId: string
) {
  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("salesReturnOrder")
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
      .selectFrom("salesReturnOrderLine")
      .select([
        "id",
        "lineNumber",
        "quantity",
        "salesOrderLineId",
        "shipmentLineId",
        "salesInvoiceLineId"
      ])
      .where("salesReturnOrderId", "=", id)
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
      linkColumn: "shipmentLineId" | "salesOrderLineId" | "salesInvoiceLineId";
      linkId: string;
    }[] = [];

    const byLink = new Map<string, (typeof checks)[number]>();
    for (const line of lines) {
      const linkColumn = line.shipmentLineId
        ? ("shipmentLineId" as const)
        : line.salesOrderLineId
          ? ("salesOrderLineId" as const)
          : line.salesInvoiceLineId
            ? ("salesInvoiceLineId" as const)
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
      // Lock the governing source row, then read its shipped/sent base.
      let base = 0;
      if (check.linkColumn === "shipmentLineId") {
        const src = await trx
          .selectFrom("shipmentLine")
          .select(["shippedQuantity"])
          .where("id", "=", check.linkId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        base = Number(src?.shippedQuantity ?? 0);
      } else if (check.linkColumn === "salesOrderLineId") {
        const src = await trx
          .selectFrom("salesOrderLine")
          .select(["quantitySent"])
          .where("id", "=", check.linkId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        base = Number(src?.quantitySent ?? 0);
      } else {
        const src = await trx
          .selectFrom("salesInvoiceLine")
          .select(["quantity"])
          .where("id", "=", check.linkId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        base = Number(src?.quantity ?? 0);
      }

      // Everything already authorized against this source line by OTHER
      // non-cancelled return orders (re-read under the source-row lock).
      // An SO-line check must ALSO count returns linked via a shipment line
      // OF that SO line: shipment-linked and SO-linked returns draw on the
      // same shipped base, and per-column counting let the two link types
      // jointly over-authorize the same goods. (A line carrying both links
      // matches the OR once — rows are counted, not columns.) The
      // shipment-line check deliberately does NOT count SO-linked returns the
      // other way: they cannot be attributed to one shipment line of a
      // multi-shipment SO line, and blocking on them would refuse legitimate
      // returns.
      let siblingShipmentLineIds: string[] = [];
      if (check.linkColumn === "salesOrderLineId") {
        const shipmentLinesOfSoLine = await trx
          .selectFrom("shipmentLine")
          .select(["id"])
          .where("lineId", "=", check.linkId)
          .where("companyId", "=", companyId)
          .execute();
        siblingShipmentLineIds = shipmentLinesOfSoLine.map((r) => r.id);
      }

      const others = await trx
        .selectFrom("salesReturnOrderLine")
        .innerJoin(
          "salesReturnOrder",
          "salesReturnOrder.id",
          "salesReturnOrderLine.salesReturnOrderId"
        )
        .select(({ fn }) => [
          fn
            .coalesce(fn.sum("salesReturnOrderLine.quantity"), sql<number>`0`)
            .as("authorized")
        ])
        .where((eb) =>
          siblingShipmentLineIds.length > 0
            ? eb.or([
                eb(
                  `salesReturnOrderLine.${check.linkColumn}`,
                  "=",
                  check.linkId
                ),
                eb(
                  "salesReturnOrderLine.shipmentLineId",
                  "in",
                  siblingShipmentLineIds
                )
              ])
            : eb(`salesReturnOrderLine.${check.linkColumn}`, "=", check.linkId)
        )
        .where("salesReturnOrderLine.companyId", "=", companyId)
        .where("salesReturnOrder.status", "!=", "Cancelled")
        .where("salesReturnOrder.id", "!=", id)
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

    // Confirm releases the RMA for receiving. Status is derived, not fixed — a
    // fresh confirm from Draft has nothing received, so it lands on "To Receive",
    // but deriving keeps this consistent with the receipt/short-close paths.
    const { status } = getSalesReturnOrderStatus(
      lines.map((line) => ({
        quantity: line.quantity,
        quantityReceived: 0,
        closedComplete: false
      }))
    );

    await trx
      .updateTable("salesReturnOrder")
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
 * Cancel an RMA. THROWS. A Kysely transaction that locks the order row first —
 * post-receipt re-checks the order status under the same lock, so a receipt
 * posting racing this cancel serializes: whichever commits first wins, and the
 * loser sees the new state instead of producing a Cancelled order with
 * received stock (whose caps a fresh RMA would then double-authorize).
 */
/**
 * Reopen an RMA to Draft so its lines can be edited again. THROWS. Row-locks the
 * order (serializes against a concurrent receipt posting). To Receive → Draft
 * (un-confirm) and Cancelled → Draft (revive; the cancel guard enforces no
 * receipt exists and nothing received, so reviving is safe). "To Receive" no
 * longer implies nothing received (it also covers partially received), so the
 * nothing-received invariant is enforced on the line quantities directly.
 */
export async function reopenSalesReturnOrder(
  db: Kysely<KyselyDatabase>,
  { id, companyId, userId }: { id: string; companyId: string; userId: string }
) {
  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("salesReturnOrder")
      .select(["id", "status"])
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();

    if (!order) throw new Error("Return order not found");
    if (!["To Receive", "Cancelled"].includes(order.status)) {
      throw new Error(
        `Only a to-receive or cancelled return can be reopened — this one is ${order.status}`
      );
    }

    // "To Receive" can be partially received; reopening one that has received
    // stock would strand it. Refuse unless nothing has been received yet.
    if (order.status === "To Receive") {
      const receivedLines = await trx
        .selectFrom("salesReturnOrderLine")
        .select(["quantityReceived"])
        .where("salesReturnOrderId", "=", id)
        .where("companyId", "=", companyId)
        .execute();
      if (receivedLines.some((l) => Number(l.quantityReceived) > EPSILON)) {
        throw new Error(
          "Cannot reopen: quantity has already been received. Void the receipt first."
        );
      }
    }

    await trx
      .updateTable("salesReturnOrder")
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

export async function cancelSalesReturnOrder(
  db: Kysely<KyselyDatabase>,
  { id, companyId, userId }: { id: string; companyId: string; userId: string }
) {
  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("salesReturnOrder")
      .select(["status"])
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Return order not found");
    if (["Completed", "Cancelled"].includes(order.status)) {
      throw new Error(`Cannot cancel a return order in ${order.status} status`);
    }

    const [receipts, lines] = await Promise.all([
      trx
        .selectFrom("receipt")
        .select(["id"])
        .where("sourceDocumentId", "=", id)
        .where("sourceDocument", "=", "Sales Return Order")
        .where("companyId", "=", companyId)
        .where("status", "!=", "Voided")
        .execute(),
      trx
        .selectFrom("salesReturnOrderLine")
        .select(["quantityReceived"])
        .where("salesReturnOrderId", "=", id)
        .where("companyId", "=", companyId)
        .execute()
    ]);

    if (receipts.length > 0) {
      throw new Error(
        "Cannot cancel: a receipt exists for this return order. Delete or void it first."
      );
    }
    if (lines.some((l) => Number(l.quantityReceived) > 0)) {
      throw new Error("Cannot cancel: quantity has already been received");
    }

    await trx
      .updateTable("salesReturnOrder")
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
 * Short-close ("stop expecting") an RMA line — the shortClosePurchaseOrderLine
 * mechanic. The header status is derived from the lines afterwards, so
 * short-closing the last open line completes the RMA (there is no separate
 * manual Complete action, mirroring the Purchase Order). Disposition is tracked
 * independently and does not gate completion.
 */
export async function shortCloseSalesReturnOrderLine(
  db: Kysely<KyselyDatabase>,
  {
    lineId,
    salesReturnOrderId,
    companyId,
    userId,
    intent
  }: {
    lineId: string;
    salesReturnOrderId: string;
    companyId: string;
    userId: string;
    intent: "close" | "reopen";
  }
) {
  return db.transaction().execute(async (trx) => {
    const line = await trx
      .selectFrom("salesReturnOrderLine")
      .select(["id"])
      .where("id", "=", lineId)
      .where("salesReturnOrderId", "=", salesReturnOrderId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    if (!line) throw new Error("Return order line not found");

    await trx
      .updateTable("salesReturnOrderLine")
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
        .selectFrom("salesReturnOrder")
        .select(["status"])
        .where("id", "=", salesReturnOrderId)
        .where("companyId", "=", companyId)
        .executeTakeFirst(),
      trx
        .selectFrom("salesReturnOrderLine")
        .select(["quantity", "quantityReceived", "closedComplete"])
        .where("salesReturnOrderId", "=", salesReturnOrderId)
        .where("companyId", "=", companyId)
        .execute()
    ]);

    // Recompute in both the To Receive and Completed working states: short-closing
    // the last open line completes the RMA, and reopening a line on a completed
    // RMA drops it back to To Receive.
    if (!order || !["To Receive", "Completed"].includes(order.status)) {
      return;
    }

    const { status } = getSalesReturnOrderStatus(lines);

    if (status !== order.status) {
      await trx
        .updateTable("salesReturnOrder")
        .set({
          status,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", salesReturnOrderId)
        .where("companyId", "=", companyId)
        .execute();
    }
  });
}

/**
 * "From document" picker source: posted shipment lines for the customer with
 * their reversible remainders (shipped − already authorized on non-cancelled
 * RMAs). BC's "Show Reversible Lines Only".
 */
/**
 * Returnable shipment lines for a customer, searched + paginated in the database
 * via the get_returnable_shipment_lines RPC. The `shipped − already-authorized
 * > 0` filter, the text search (shipment #, sales order #, item readable id,
 * item name), the recency ordering, and pagination all run in SQL so the "Add
 * lines from shipment" modal stays responsive when a customer has thousands of
 * shipment lines. Each row carries `totalCount` — the size of the full
 * returnable set before limit/offset — so the UI can page through the rest.
 */
export async function getReturnableLinesForCustomer(
  client: SupabaseClient<Database>,
  companyId: string,
  customerId: string,
  args?: {
    salesOrderId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }
) {
  return client.rpc("get_returnable_shipment_lines", {
    company_id: companyId,
    customer_id: customerId,
    sales_order_id: args?.salesOrderId || undefined,
    search: args?.search?.trim() || undefined,
    limit_count: args?.limit ?? 5,
    offset_count: args?.offset ?? 0
  });
}

/**
 * Entity picker source for RMA lines: serials/batches shipped to this
 * customer (Consumed entities tagged with a posted shipment's id — the
 * attributes->>X query pattern from getTrackedEntitiesByMakeMethodId).
 */
export async function getShippedTrackedEntitiesForCustomer(
  client: SupabaseClient<Database>,
  companyId: string,
  customerId: string,
  itemId: string
) {
  // Entity-first, then verify the shipments: the old shape fetched EVERY
  // posted shipment id for the customer unpaged (PostgREST silently caps at
  // 1000 rows, and the .in() list has a URL-length ceiling), so a high-volume
  // customer's picker silently missed candidates. The item's Consumed
  // entities are the small, relevant set; their shipment ids are verified in
  // chunks.
  const entities = await fetchAllFromTable<{
    id: string;
    readableId: string | null;
    quantity: number;
    status: Database["public"]["Enums"]["trackedEntityStatus"];
    attributes: Json;
  }>(
    client,
    "trackedEntity",
    "id, readableId, quantity, status, attributes",
    (query) =>
      query
        .eq("companyId", companyId)
        .eq("itemId", itemId)
        .eq("status", "Consumed")
  );
  if (entities.error) return { data: null, error: entities.error };

  const entityShipmentIds = [
    ...new Set(
      (entities.data ?? [])
        .map(
          (entity) =>
            (entity.attributes as Record<string, unknown> | null)?.Shipment
        )
        .filter((value): value is string => typeof value === "string")
    )
  ];
  if (entityShipmentIds.length === 0) return { data: [], error: null };

  const customerShipmentIds = new Set<string>();
  const CHUNK = 300;
  for (let i = 0; i < entityShipmentIds.length; i += CHUNK) {
    const chunk = entityShipmentIds.slice(i, i + CHUNK);
    const shipments = await client
      .from("shipment")
      .select("id")
      .in("id", chunk)
      .eq("companyId", companyId)
      .eq("customerId", customerId)
      .eq("status", "Posted");
    if (shipments.error) return { data: null, error: shipments.error };
    for (const shipment of shipments.data ?? []) {
      customerShipmentIds.add(shipment.id);
    }
  }

  return {
    data: (entities.data ?? []).filter((entity) => {
      const shipmentId = (entity.attributes as Record<string, unknown> | null)
        ?.Shipment;
      return (
        typeof shipmentId === "string" && customerShipmentIds.has(shipmentId)
      );
    }),
    error: null
  };
}

/**
 * Per-line creditable pool = received − already credited. Draft memos count
 * against the pool (two Drafts must not double-credit); the VIEW's displayed
 * quantityCredited still derives from Posted memos only.
 */
export async function getCreditableQuantities(
  client: SupabaseClient<Database>,
  salesReturnOrderId: string,
  companyId: string
) {
  const lines = await client
    .from("salesReturnOrderLine")
    .select("id, lineNumber, quantityReceived, unitPrice, restockFeePercent")
    .eq("salesReturnOrderId", salesReturnOrderId)
    .eq("companyId", companyId)
    .order("lineNumber");
  if (lines.error) return { data: null, error: lines.error };
  const lineIds = (lines.data ?? []).map((l) => l.id);
  if (lineIds.length === 0) return { data: [], error: null };

  const credits = await client
    .from("salesReturnOrderCreditLine")
    .select("salesReturnOrderLineId, quantity, memo!inner(status)")
    .in("salesReturnOrderLineId", lineIds)
    .eq("companyId", companyId)
    .neq("memo.status", "Voided");
  if (credits.error) return { data: null, error: credits.error };

  const creditedByLine = new Map<string, number>();
  for (const row of credits.data ?? []) {
    creditedByLine.set(
      row.salesReturnOrderLineId,
      (creditedByLine.get(row.salesReturnOrderLineId) ?? 0) +
        Number(row.quantity)
    );
  }

  return {
    data: (lines.data ?? []).map((line) => {
      const received = Number(line.quantityReceived);
      const credited = creditedByLine.get(line.id) ?? 0;
      return {
        salesReturnOrderLineId: line.id,
        lineNumber: line.lineNumber,
        quantityReceived: received,
        quantityCredited: credited,
        creditableQuantity: Math.max(0, received - credited),
        unitPrice: Number(line.unitPrice),
        restockFeePercent: Number(line.restockFeePercent)
      };
    }),
    error: null
  };
}

/**
 * Issue Credit: one AR memo (direction Credit, linked via
 * memo.salesReturnOrderId) + per-line salesReturnOrderCreditLine breakdown.
 * The creditable cap (received − already credited over NON-VOIDED memos —
 * Drafts count so two drafts can't double-credit) is validated inside the
 * transaction under a row lock on the RMA lines. Amount is rounded ONCE at
 * the currency's decimals (settlement boundary). Returns the memo id.
 */
export async function createSalesReturnOrderCredit(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    salesReturnOrderId,
    companyId,
    companyGroupId,
    userId,
    memoDate,
    lines
  }: {
    salesReturnOrderId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
    memoDate: string;
    lines: { salesReturnOrderLineId: string; quantity: number }[];
  }
) {
  const order = await client
    .from("salesReturnOrder")
    .select(
      "id, status, customerId, currencyCode, exchangeRate, salesReturnOrderId"
    )
    .eq("id", salesReturnOrderId)
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
    sequence_name: "creditMemo",
    company_id: companyId
  });
  if (seq.error || !seq.data) {
    throw new Error("Failed to allocate credit memo number");
  }
  const memoId = seq.data;

  const requested = new Map(
    lines
      .filter((l) => l.quantity > 0)
      .map((l) => [l.salesReturnOrderLineId, l.quantity])
  );
  if (requested.size === 0) {
    throw new Error("Nothing to credit");
  }

  return db.transaction().execute(async (trx) => {
    const orderLines = await trx
      .selectFrom("salesReturnOrderLine")
      .select([
        "id",
        "lineNumber",
        "quantityReceived",
        "unitPrice",
        "restockFeePercent"
      ])
      .where("salesReturnOrderId", "=", salesReturnOrderId)
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
      .selectFrom("salesReturnOrderCreditLine")
      .innerJoin("memo", "memo.id", "salesReturnOrderCreditLine.memoId")
      .select(({ fn }) => [
        "salesReturnOrderCreditLine.salesReturnOrderLineId",
        fn
          .coalesce(
            fn.sum("salesReturnOrderCreditLine.quantity"),
            sql<number>`0`
          )
          .as("credited")
      ])
      .where("salesReturnOrderCreditLine.salesReturnOrderLineId", "in", [
        ...requested.keys()
      ])
      .where("salesReturnOrderCreditLine.companyId", "=", companyId)
      .where("memo.status", "!=", "Voided")
      .groupBy("salesReturnOrderCreditLine.salesReturnOrderLineId")
      .execute();
    const creditedByLine = new Map(
      credited.map((row) => [row.salesReturnOrderLineId, Number(row.credited)])
    );

    let total = 0;
    const creditLineValues: {
      memoId: string;
      salesReturnOrderLineId: string;
      quantity: number;
      unitPrice: number;
      restockFee: number;
      companyId: string;
      createdBy: string;
    }[] = [];

    for (const line of orderLines) {
      const quantity = requested.get(line.id)!;
      const received = Number(line.quantityReceived ?? 0);
      const alreadyCredited = creditedByLine.get(line.id) ?? 0;
      const creditable = received - alreadyCredited;
      if (quantity > creditable + EPSILON) {
        throw new Error(
          `Line ${line.lineNumber}: cannot credit ${quantity} — only ${Math.max(
            0,
            creditable
          )} of ${received} received remains creditable`
        );
      }
      const unitPrice = Number(line.unitPrice ?? 0);
      const feePercent = Number(line.restockFeePercent ?? 0);
      const gross = quantity * unitPrice;
      const restockFee = gross * feePercent;
      total += gross - restockFee;
      creditLineValues.push({
        memoId: "", // filled after the memo insert
        salesReturnOrderLineId: line.id,
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
        direction: "Credit",
        status: "Draft",
        customerId: order.data.customerId,
        memoDate,
        currencyCode: order.data.currencyCode,
        exchangeRate: order.data.exchangeRate ?? 1,
        amount: round(total, decimalPlaces),
        reference: order.data.salesReturnOrderId,
        salesReturnOrderId,
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("salesReturnOrderCreditLine")
      .values(creditLineValues.map((v) => ({ ...v, memoId: memo.id })))
      .execute();

    return memo.id;
  });
}

/**
 * Create Replacement Order: a draft sales order pre-filled from the RMA
 * lines, priced via resolvePrice (user adjusts on the draft — e.g. to zero
 * for warranty). One replacement per RMA; re-invoking returns the existing
 * link. Rollback-by-delete on line failure (the insertSalesOrder pattern).
 */
export async function createReplacementSalesOrder(
  client: SupabaseClient<Database>,
  {
    salesReturnOrderId,
    companyId,
    companyGroupId,
    userId
  }: {
    salesReturnOrderId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: PostgrestError | null }> {
  const order = await client
    .from("salesReturnOrder")
    .select("*")
    .eq("id", salesReturnOrderId)
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
  if (order.data.replacementSalesOrderId) {
    return { data: { id: order.data.replacementSalesOrderId }, error: null };
  }

  const lines = await client
    .from("salesReturnOrderLine")
    .select("*, item(type)")
    .eq("salesReturnOrderId", salesReturnOrderId)
    .eq("companyId", companyId);
  if (lines.error) return { data: null, error: lines.error };
  if ((lines.data ?? []).length === 0) {
    return {
      data: null,
      error: { message: "Return order has no lines" } as PostgrestError
    };
  }

  const salesOrder = await insertSalesOrder(client, {
    customerId: order.data.customerId,
    companyId,
    companyGroupId,
    createdBy: userId,
    currencyCode: order.data.currencyCode,
    customerContactId: order.data.customerContactId ?? undefined,
    customerLocationId: order.data.customerLocationId ?? undefined,
    locationId: order.data.locationId ?? undefined,
    customerReference: order.data.salesReturnOrderId
  });
  if (salesOrder.error || !salesOrder.data) {
    return { data: null, error: salesOrder.error };
  }
  const salesOrderId = salesOrder.data.id;

  const lineTypeFor = (
    itemType: string | null | undefined
  ): Database["public"]["Enums"]["salesOrderLineType"] => {
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

  for (const line of lines.data ?? []) {
    const price = await resolvePrice(client, companyId, {
      customerId: order.data.customerId,
      itemId: line.itemId,
      quantity: Number(line.quantity)
    });

    const insertLine = await client.from("salesOrderLine").insert({
      salesOrderId,
      salesOrderLineType: lineTypeFor(line.item?.type),
      itemId: line.itemId,
      saleQuantity: Number(line.quantity),
      unitPrice: price.finalPrice,
      priceTrace: price.trace,
      unitOfMeasureCode: line.unitOfMeasureCode,
      companyId,
      createdBy: userId
    });

    if (insertLine.error) {
      await deleteSalesOrder(client, salesOrderId);
      return { data: null, error: insertLine.error };
    }
  }

  const link = await client
    .from("salesReturnOrder")
    .update({
      replacementSalesOrderId: salesOrderId,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", salesReturnOrderId)
    .eq("companyId", companyId);
  if (link.error) return { data: null, error: link.error };

  return { data: { id: salesOrderId }, error: null };
}

/**
 * Set an RMA line's disposition. "Use As Is" additionally releases the line's
 * returned (On Hold) tracked entities to Available and records one
 * `trackedActivity` (+ one input per entity) for the genealogy — the same
 * shape the NCR disposition writes. Scrap/Rework are set via Issue escalation
 * (the line's issue route), not through this function's callers' UI, but the
 * write itself is shared: those dispositions have no entity side effects here.
 */
export async function setSalesReturnOrderLineDisposition(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    lineId,
    companyId,
    disposition,
    userId
  }: {
    lineId: string;
    companyId: string;
    disposition: Database["public"]["Enums"]["disposition"];
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: PostgrestError | null }> {
  const line = await client
    .from("salesReturnOrderLine")
    .select(
      "id, salesReturnOrderId, quantityReceived, salesReturnOrder(status)"
    )
    .eq("id", lineId)
    .eq("companyId", companyId)
    .single();
  if (line.error) return { data: null, error: line.error };

  const orderStatus = (line.data.salesReturnOrder as { status: string } | null)
    ?.status;
  // Only Cancelled blocks. Completed must not: post-receipt auto-completes
  // the RMA on full receipt, and disposition is a post-receipt decision —
  // blocking Completed left entities stuck On Hold forever.
  if (orderStatus === "Cancelled") {
    return {
      data: null,
      error: {
        message: `Cannot change disposition on a ${orderStatus} return order`
      } as PostgrestError
    };
  }

  if (
    disposition !== "Pending" &&
    Number(line.data.quantityReceived ?? 0) <= 0
  ) {
    return {
      data: null,
      error: {
        message: "Cannot set a disposition before any quantity is received"
      } as PostgrestError
    };
  }

  if (disposition !== "Use As Is") {
    const update = await client
      .from("salesReturnOrderLine")
      .update({
        disposition,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", lineId)
      .eq("companyId", companyId)
      .select("id")
      .single();
    if (update.error) return { data: null, error: update.error };
    return { data: { id: lineId }, error: null };
  }

  const order = await client
    .from("salesReturnOrder")
    .select("id, salesReturnOrderId")
    .eq("id", line.data.salesReturnOrderId)
    .eq("companyId", companyId)
    .single();
  if (order.error) return { data: null, error: order.error };

  // The line's returned entities: expected serials/batches linked to the line
  // that are still On Hold from receipt...
  const linked = await client
    .from("salesReturnOrderLineTrackedEntity")
    .select("trackedEntityId, trackedEntity(status)")
    .eq("salesReturnOrderLineId", lineId)
    .eq("companyId", companyId);
  if (linked.error) return { data: null, error: linked.error };

  const linkedOnHoldIds = (linked.data ?? [])
    .filter((row) => row.trackedEntity?.status === "On Hold")
    .map((row) => row.trackedEntityId);

  // ...plus blind returns: On Hold entities created at receipt against this
  // RMA line's receipt lines, which have no salesReturnOrderLineTrackedEntity
  // row because the customer never declared them up front.
  const receipts = await client
    .from("receipt")
    .select("id")
    .eq("sourceDocument", "Sales Return Order")
    .eq("sourceDocumentId", line.data.salesReturnOrderId)
    .eq("companyId", companyId);
  if (receipts.error) return { data: null, error: receipts.error };

  let blindOnHoldIds: string[] = [];
  const receiptIds = (receipts.data ?? []).map((receipt) => receipt.id);
  if (receiptIds.length > 0) {
    const receiptLines = await client
      .from("receiptLine")
      .select("id")
      .in("receiptId", receiptIds)
      .eq("lineId", lineId)
      .eq("companyId", companyId);
    if (receiptLines.error) return { data: null, error: receiptLines.error };

    const receiptLineIds = (receiptLines.data ?? []).map((row) => row.id);
    if (receiptLineIds.length > 0) {
      const blind = await client
        .from("trackedEntity")
        .select("id")
        .eq("companyId", companyId)
        .eq("status", "On Hold")
        .in("attributes ->> Receipt Line", receiptLineIds);
      if (blind.error) return { data: null, error: blind.error };
      blindOnHoldIds = (blind.data ?? []).map((entity) => entity.id);
    }
  }

  const entityIds = Array.from(
    new Set([...linkedOnHoldIds, ...blindOnHoldIds])
  );

  const entities =
    entityIds.length > 0
      ? await client
          .from("trackedEntity")
          .select("id, quantity")
          .in("id", entityIds)
          .eq("companyId", companyId)
      : { data: [], error: null };
  if (entities.error) return { data: null, error: entities.error };

  // One transaction: a partially-applied release (entities Available with no
  // genealogy record, or a flipped entity on a still-Pending line) is a bug.
  try {
    await db.transaction().execute(async (trx) => {
      // The gathering reads above ran unlocked — re-check the order under a
      // row lock so a Complete/Cancel that landed in between cannot be
      // dispositioned over.
      const lockedOrder = await trx
        .selectFrom("salesReturnOrder")
        .select(["status"])
        .where("id", "=", line.data.salesReturnOrderId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      // Mirrors the pre-check: only Cancelled blocks disposition.
      if (lockedOrder.status === "Cancelled") {
        throw new Error(
          `Cannot change disposition on a ${lockedOrder.status} return order`
        );
      }

      await trx
        .updateTable("salesReturnOrderLine")
        .set({
          disposition,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", lineId)
        .where("companyId", "=", companyId)
        .execute();

      if (entityIds.length === 0) return;

      // Flip only entities STILL On Hold — the condition re-checks inside the
      // write itself, so an entity consumed or shipped elsewhere between the
      // unlocked read and this transaction is never forced back to Available.
      const flipped = await trx
        .updateTable("trackedEntity")
        .set({ status: "Available" })
        .where("id", "in", entityIds)
        .where("companyId", "=", companyId)
        .where("status", "=", "On Hold")
        .returning(["id"])
        .execute();
      const flippedIds = new Set(flipped.map((row) => row.id));
      if (flippedIds.size === 0) return;

      const activity = await trx
        .insertInto("trackedActivity")
        .values({
          type: "Disposition",
          sourceDocument: "Sales Return Order",
          sourceDocumentId: order.data.id,
          sourceDocumentReadableId: order.data.salesReturnOrderId,
          attributes: JSON.stringify({
            "Sales Return Order": order.data.id,
            Disposition: disposition,
            Employee: userId
          }),
          companyId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto("trackedActivityInput")
        .values(
          (entities.data ?? [])
            .filter((entity) => flippedIds.has(entity.id))
            .map((entity) => ({
              trackedActivityId: activity.id,
              trackedEntityId: entity.id,
              quantity: Number(entity.quantity ?? 1),
              companyId,
              createdBy: userId
            }))
        )
        .execute();
    });
  } catch (err) {
    return {
      data: null,
      error: { message: (err as Error).message } as PostgrestError
    };
  }

  return { data: { id: lineId }, error: null };
}

/**
 * Create a presigned upload URL for an opportunity (quote/sales order/RFQ/sales
 * invoice) document. First step of the two-step upload flow: PUT the file bytes to
 * the returned `signedUrl`, then call `documents_insertUploadedDocument` with the
 * returned `path`, the document type as `sourceDocument`, and the quote/order id as
 * `sourceDocumentId`. The storage folder is scoped by `opportunityId`, which is a
 * different id from `sourceDocumentId`.
 *       (packages/files/AGENTS.md): a non-browser caller mints a staged
 *       upload URL, then insertUploadedDocument converts and lands it.
 */
export async function createOpportunityDocumentUploadUrl(
  client: SupabaseClient<Database>,
  args: { companyId: string; opportunityId: string; name: string }
) {
  return createDocumentUploadUrl(client, {
    companyId: args.companyId,
    folder: "opportunity",
    entityId: args.opportunityId,
    name: args.name
  });
}

/**
 * Create a presigned upload URL for an opportunity LINE document. First step of the
 * two-step upload flow: PUT the file bytes to the returned `signedUrl`, then call
 * `documents_insertUploadedDocument` with the returned `path`, the line's document
 * type as `sourceDocument`, and the line id as `sourceDocumentId`.
 *       (packages/files/AGENTS.md): a non-browser caller mints a staged
 *       upload URL, then insertUploadedDocument converts and lands it.
 */
export async function createOpportunityLineDocumentUploadUrl(
  client: SupabaseClient<Database>,
  args: { companyId: string; lineId: string; name: string }
) {
  return createDocumentUploadUrl(client, {
    companyId: args.companyId,
    folder: "opportunity-line",
    entityId: args.lineId,
    name: args.name
  });
}

// ----------------------------------------------------------------------
// Rental agreements (spec §3). Lifecycle changes — activate, return, close,
// cancel — go through the post-rental-agreement edge function; invoices are
// generated by the `create-rental-invoices` server function. These are the plain reads and
// the Draft-stage writes.
// ----------------------------------------------------------------------

export async function getRentalAgreements(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("rentalAgreements")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      searchFilter(["rentalAgreementId", "customerName"], args.search)
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);

  return query;
}

export async function getRentalAgreement(
  client: SupabaseClient<Database>,
  rentalAgreementId: string,
  companyId: string
) {
  return client
    .from("rentalAgreements")
    .select("*")
    .eq("id", rentalAgreementId)
    .eq("companyId", companyId)
    .single();
}

/** `rentalAgreementId` (the readable RA number) comes from the caller —
 *  the table has no default, so the route draws it from the sequence. */
/** The terms a caller may write — never `status`, `activatedAt`, `closedAt`
 *  or anything the lifecycle (post-rental-agreement) owns. These writers are
 *  also MCP tools, whose inputs reach them unfiltered, so the fields are
 *  picked rather than spread. */
function rentalAgreementTerms(
  terms: Omit<
    z.infer<typeof rentalAgreementValidator>,
    "id" | "rentalAgreementId"
  >
) {
  return {
    customerId: terms.customerId,
    customerLocationId: terms.customerLocationId,
    customerContactId: terms.customerContactId,
    salesPersonId: terms.salesPersonId,
    locationId: terms.locationId,
    startDate: terms.startDate,
    // A cleared DatePicker posts "", which a DATE column rejects.
    endDate: terms.endDate || null,
    billingCycle: terms.billingCycle,
    billingTiming: terms.billingTiming,
    paymentTermId: terms.paymentTermId,
    currencyCode: terms.currencyCode,
    // NOT NULL DEFAULT 1 and not on the form: only a caller that sends a rate
    // writes one, or an explicit null would override the default.
    ...(terms.exchangeRate !== undefined
      ? { exchangeRate: terms.exchangeRate }
      : {}),
    depositAmount: terms.depositAmount,
    taxPercent: terms.taxPercent,
    discountRate: terms.discountRate,
    ownershipTransfers: terms.ownershipTransfers,
    specializedAsset: terms.specializedAsset,
    purchaseOptionAmount: terms.purchaseOptionAmount,
    purchaseOptionReasonablyCertain: terms.purchaseOptionReasonablyCertain,
    notes: terms.notes
  };
}

/** Not published: `sales.rentalAgreement.create` numbers it. */
export async function insertRentalAgreement(
  client: SupabaseClient<Database>,
  rentalAgreement: Omit<z.infer<typeof rentalAgreementValidator>, "id"> & {
    rentalAgreementId: string;
    companyId: string;
    createdBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("rentalAgreement")
    .insert([
      {
        ...sanitize(rentalAgreementTerms(rentalAgreement)),
        endDate: rentalAgreement.endDate || null,
        rentalAgreementId: rentalAgreement.rentalAgreementId,
        companyId: rentalAgreement.companyId,
        createdBy: rentalAgreement.createdBy,
        customFields: rentalAgreement.customFields
      }
    ])
    .select("id, rentalAgreementId")
    .single();
}

/** A refusal shaped like a PostgREST error, so every caller's existing
 *  `result.error` handling (routes, MCP dispatch) reports it unchanged. */
function rentalRefusal(code: string, message: string) {
  return {
    data: null,
    error: { message, details: "", hint: "", code } as PostgrestError
  };
}

/** Billing periods and the lease classification are cut from the terms at
 *  activation, so only a Draft agreement's terms can change.
 * Not published: `sales.rentalAgreement.setTerm` brings the rate and checks the whole terms.
 */
export async function updateRentalAgreement(
  client: SupabaseClient<Database>,
  rentalAgreement: Omit<
    z.infer<typeof rentalAgreementValidator>,
    "id" | "rentalAgreementId"
  > & {
    id: string;
    companyId: string;
    updatedBy: string;
    customFields?: Json;
  }
) {
  const current = await client
    .from("rentalAgreement")
    .select("status")
    .eq("id", rentalAgreement.id)
    .eq("companyId", rentalAgreement.companyId)
    .single();
  if (current.error) return current;
  if (current.data.status !== "Draft") {
    return rentalRefusal(
      "RENTAL_AGREEMENT_NOT_DRAFT",
      "Only a Draft rental agreement's terms can be edited"
    );
  }

  return client
    .from("rentalAgreement")
    .update(
      sanitize({
        ...rentalAgreementTerms(rentalAgreement),
        endDate: rentalAgreement.endDate || null,
        customFields: rentalAgreement.customFields,
        updatedBy: rentalAgreement.updatedBy,
        updatedAt: datetime.timestamp()
      })
    )
    .eq("id", rentalAgreement.id)
    .eq("companyId", rentalAgreement.companyId)
    .eq("status", "Draft")
    .select("id")
    .single();
}

/** How the daily run's invoices are handled for one agreement — an
 *  operational preference, not a term, so it stays editable while Active.
 *  Null falls back to the company's setting. Sending needs an email to send
 *  to, so `Post and Email` is refused when the contact has none.
 */
export async function updateRentalAgreementInvoiceAutomation(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    invoiceAutomation: z.infer<
      typeof rentalAgreementInvoiceAutomationValidator
    >["invoiceAutomation"];
    updatedBy: string;
  }
) {
  const current = await client
    .from("rentalAgreement")
    .select("status, customerContactId")
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .single();
  if (current.error) return current;
  if (current.data.status !== "Draft" && current.data.status !== "Active") {
    return rentalRefusal(
      "RENTAL_AGREEMENT_CLOSED",
      "Invoicing can only be changed on a Draft or Active agreement"
    );
  }

  if (args.invoiceAutomation === "Post and Email") {
    const contact = current.data.customerContactId
      ? await client
          .from("customerContact")
          .select("contact(email)")
          .eq("id", current.data.customerContactId)
          .eq("companyId", args.companyId)
          .maybeSingle()
      : null;
    if (contact?.error) return contact;
    if (!contact?.data?.contact?.email) {
      return rentalRefusal(
        "RENTAL_INVOICE_EMAIL_NO_CONTACT",
        "Add a contact with an email to send invoices"
      );
    }
  }

  return client
    .from("rentalAgreement")
    .update(
      sanitize({
        invoiceAutomation: args.invoiceAutomation,
        updatedBy: args.updatedBy,
        updatedAt: datetime.timestamp()
      })
    )
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

/** Only a Draft agreement can be deleted — an activated one has billing
 *  periods and possibly invoices; it is cancelled or closed instead.
 */
export async function deleteRentalAgreement(
  client: SupabaseClient<Database>,
  rentalAgreementId: string,
  companyId: string
) {
  return client
    .from("rentalAgreement")
    .delete()
    .eq("id", rentalAgreementId)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .select("id")
    .single();
}

export async function getRentalAgreementLines(
  client: SupabaseClient<Database>,
  rentalAgreementId: string,
  companyId: string
) {
  return client
    .from("rentalAgreementLine")
    .select(
      "*, fixedAsset(id, fixedAssetId, name, serialNumber), item(readableIdWithRevision, name, thumbnailPath)"
    )
    .eq("rentalAgreementId", rentalAgreementId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

export async function getRentalAgreementLine(
  client: SupabaseClient<Database>,
  rentalAgreementLineId: string,
  companyId: string
) {
  return client
    .from("rentalAgreementLine")
    .select(
      "*, fixedAsset(id, fixedAssetId, name, serialNumber), item(readableIdWithRevision, name, thumbnailPath)"
    )
    .eq("id", rentalAgreementLineId)
    .eq("companyId", companyId)
    .single();
}

/** The line's item and serial always come from its fleet unit, never the
 *  form, so a line cannot name one unit and bill another's rates. Units are
 *  added, changed and removed only while the agreement is Draft — activation
 *  cuts billing periods from them — and a line never moves between
 *  agreements.
 */
export async function upsertRentalAgreementLine(
  client: SupabaseClient<Database>,
  line:
    | (Omit<z.infer<typeof rentalAgreementLineValidator>, "id" | "itemId"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof rentalAgreementLineValidator>, "id" | "itemId"> & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  const { companyId } = line;
  if ("id" in line) {
    const existing = await client
      .from("rentalAgreementLine")
      .select("rentalAgreementId")
      .eq("id", line.id)
      .eq("companyId", companyId)
      .single();
    if (existing.error) return existing;
    if (existing.data.rentalAgreementId !== line.rentalAgreementId) {
      return rentalRefusal(
        "RENTAL_LINE_WRONG_AGREEMENT",
        "This unit does not belong to this rental agreement"
      );
    }
  }

  const agreement = await client
    .from("rentalAgreement")
    .select("status, customerId, currencyCode, startDate")
    .eq("id", line.rentalAgreementId)
    .eq("companyId", companyId)
    .single();
  if (agreement.error) return agreement;
  if (agreement.data.status !== "Draft") {
    return rentalRefusal(
      "RENTAL_AGREEMENT_NOT_DRAFT",
      "Units can only be added or changed on a Draft rental agreement"
    );
  }

  const asset = await client
    .from("fixedAsset")
    .select("id, itemId, trackedEntityId")
    .eq("id", line.fixedAssetId)
    .eq("companyId", companyId)
    .single();
  if (asset.error) return asset;
  if (!asset.data.itemId) {
    return rentalRefusal("RENTAL_ASSET_NO_ITEM", "The fleet unit has no item");
  }

  // The unit's own rate. An API caller may leave it out and get the rate
  // the form would have started from: the customer's, its type's, else the
  // item's, for this frequency.
  let rate = line.rate;
  if (rate === undefined) {
    const defaults = await getDefaultRentalRates(client, {
      companyId,
      customerId: agreement.data.customerId,
      currencyCode: agreement.data.currencyCode,
      asOf: agreement.data.startDate,
      itemIds: [asset.data.itemId]
    });
    if (defaults.error) return defaults;
    rate = defaults.data[asset.data.itemId]?.[line.rateUnit]?.rate;
    if (rate === undefined) {
      return rentalRefusal(
        "RENTAL_LINE_NO_RATE",
        `No ${line.rateUnit.toLowerCase()} rate is set for this item; enter the rate`
      );
    }
  }

  // Picked, not spread: this writer is also an MCP tool, and `status` and
  // the classification columns belong to activation.
  const values = {
    rentalAgreementId: line.rentalAgreementId,
    fixedAssetId: line.fixedAssetId,
    itemId: asset.data.itemId,
    trackedEntityId: asset.data.trackedEntityId,
    rateUnit: line.rateUnit,
    rate,
    fairValue: line.fairValue ?? null,
    economicLifeMonths: line.economicLifeMonths ?? null,
    guaranteedResidualValue: line.guaranteedResidualValue ?? 0,
    unguaranteedResidualValue: line.unguaranteedResidualValue ?? 0
  };

  if ("id" in line) {
    return client
      .from("rentalAgreementLine")
      .update({
        ...values,
        updatedBy: line.updatedBy,
        updatedAt: datetime.timestamp()
      })
      .eq("id", line.id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("rentalAgreementLine")
    .insert([{ ...values, companyId, createdBy: line.createdBy }])
    .select("id")
    .single();
}

/** Adds several fleet units to a Draft agreement at once (the setup wizard's
 *  Add Units), each at its rate on file for the frequency — the customer's,
 *  its type's, else the item's — or 0 when there is none, to be priced in
 *  the grid. One read of the agreement, one of the units, one of the rates,
 *  one insert. Not an MCP tool: `upsertRentalAgreementLine` covers a single
 *  unit. */
export async function insertRentalAgreementLines(
  client: SupabaseClient<Database>,
  args: {
    rentalAgreementId: string;
    companyId: string;
    createdBy: string;
    fixedAssetIds: string[];
    rateUnit: z.infer<typeof rentalAgreementLineValidator>["rateUnit"];
  }
) {
  const { rentalAgreementId, companyId, createdBy, rateUnit } = args;
  const fixedAssetIds = [...new Set(args.fixedAssetIds)];

  const agreement = await client
    .from("rentalAgreement")
    .select("status, customerId, currencyCode, startDate")
    .eq("id", rentalAgreementId)
    .eq("companyId", companyId)
    .single();
  if (agreement.error) return agreement;
  if (agreement.data.status !== "Draft") {
    return rentalRefusal(
      "RENTAL_AGREEMENT_NOT_DRAFT",
      "Units can only be added or changed on a Draft rental agreement"
    );
  }

  const assets = await client
    .from("fixedAsset")
    .select("id, itemId, trackedEntityId")
    .eq("companyId", companyId)
    .in("id", fixedAssetIds);
  if (assets.error) return assets;
  if (assets.data.length !== fixedAssetIds.length) {
    return rentalRefusal(
      "RENTAL_ASSET_NOT_FOUND",
      "A fleet unit could not be found"
    );
  }
  if (assets.data.some((asset) => !asset.itemId)) {
    return rentalRefusal("RENTAL_ASSET_NO_ITEM", "The fleet unit has no item");
  }

  const itemIds = [
    ...new Set(assets.data.map((asset) => asset.itemId as string))
  ];
  const defaults = await getDefaultRentalRates(client, {
    companyId,
    customerId: agreement.data.customerId,
    currencyCode: agreement.data.currencyCode,
    asOf: agreement.data.startDate,
    itemIds
  });
  if (defaults.error) return defaults;

  return client
    .from("rentalAgreementLine")
    .insert(
      assets.data.map((asset) => ({
        rentalAgreementId,
        fixedAssetId: asset.id,
        itemId: asset.itemId as string,
        trackedEntityId: asset.trackedEntityId,
        rateUnit,
        rate: defaults.data[asset.itemId as string]?.[rateUnit]?.rate ?? 0,
        companyId,
        createdBy
      }))
    )
    .select("id");
}

/** Only from a Draft agreement — an activated line has billing periods
 *  behind it; return the unit or cancel the agreement instead.
 */
export async function deleteRentalAgreementLine(
  client: SupabaseClient<Database>,
  rentalAgreementLineId: string,
  companyId: string
) {
  const line = await client
    .from("rentalAgreementLine")
    .select("id, rentalAgreement!inner(status)")
    .eq("id", rentalAgreementLineId)
    .eq("companyId", companyId)
    .single();
  if (line.error) return line;
  if (line.data.rentalAgreement.status !== "Draft") {
    return rentalRefusal(
      "RENTAL_AGREEMENT_NOT_DRAFT",
      "Units can only be removed from a Draft rental agreement"
    );
  }

  return client
    .from("rentalAgreementLine")
    .delete()
    .eq("id", rentalAgreementLineId)
    .eq("companyId", companyId);
}

/**
 * Every charge on the agreement's lines, with the line's fleet unit.
 */
export async function getRentalAgreementCharges(
  client: SupabaseClient<Database>,
  rentalAgreementId: string,
  companyId: string
) {
  return client
    .from("rentalAgreementCharge")
    .select(
      "*, rentalAgreementLine!inner(id, rentalAgreementId, fixedAsset(fixedAssetId, name))"
    )
    .eq("rentalAgreementLine.rentalAgreementId", rentalAgreementId)
    .eq("companyId", companyId)
    .order("chargeDate", { ascending: true });
}

/**
 * A variable charge (damage, delivery, overage) on one unit of an open
 * agreement. Always written as charge type `Charge`: `Rent` is billed only from the
 * schedule and `Purchase Option` only by Sell to Customer
 * (`insertRentalPurchaseOptionCharge`, `sales.server.ts`), whose guards a
 * caller-chosen type would skip. Fields are listed rather than spread so a
 * payload cannot set the charge type or the billing stamp either.
 */
export async function upsertRentalAgreementCharge(
  client: SupabaseClient<Database>,
  charge:
    | (Omit<z.infer<typeof rentalAgreementChargeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof rentalAgreementChargeValidator>, "id"> & {
        id: string;
        companyId: string;
        updatedBy: string;
      })
) {
  const fields = {
    rentalAgreementLineId: charge.rentalAgreementLineId,
    chargeDate: charge.chargeDate,
    description: charge.description,
    amount: charge.amount,
    taxPercent: charge.taxPercent,
    invoiceSeparately: charge.invoiceSeparately
  };

  // The agreement is the line's own, read under the caller's company.
  const line = await client
    .from("rentalAgreementLine")
    .select("id, rentalAgreementId, rentalAgreement!inner(status)")
    .eq("id", charge.rentalAgreementLineId)
    .eq("companyId", charge.companyId)
    .single();
  if (line.error) return line;
  const status = line.data.rentalAgreement.status;
  if (status !== "Draft" && status !== "Active") {
    return rentalRefusal(
      "RENTAL_AGREEMENT_NOT_OPEN",
      "Charges can only be added to or changed on an open rental agreement"
    );
  }

  if ("id" in charge) {
    // A charge moves only between units of its own agreement.
    const existing = await client
      .from("rentalAgreementCharge")
      .select("rentalAgreementLine!inner(rentalAgreementId)")
      .eq("id", charge.id)
      .eq("companyId", charge.companyId)
      .single();
    if (existing.error) return existing;
    if (
      existing.data.rentalAgreementLine.rentalAgreementId !==
      line.data.rentalAgreementId
    ) {
      return rentalRefusal(
        "RENTAL_CHARGE_WRONG_AGREEMENT",
        "A charge can only move to a unit on its own rental agreement"
      );
    }

    // A charge already on an invoice is fixed; the invoice line is the
    // record. Only a `Charge` is edited here — a Purchase Option charge is
    // written by Sell to Customer alone.
    return client
      .from("rentalAgreementCharge")
      .update(
        sanitize({
          ...fields,
          updatedBy: charge.updatedBy,
          updatedAt: datetime.timestamp()
        })
      )
      .eq("id", charge.id)
      .eq("companyId", charge.companyId)
      .eq("chargeType", "Charge")
      .is("salesInvoiceLineId", null)
      .select("id")
      .single();
  }

  return client
    .from("rentalAgreementCharge")
    .insert([
      {
        ...fields,
        chargeType: "Charge" as const,
        companyId: charge.companyId,
        createdBy: charge.createdBy
      }
    ])
    .select("id")
    .single();
}

/**
 * A charge that has been invoiced stays — void or delete the invoice first —
 * and only an open (Draft or Active) agreement's charges can be removed.
 */
export async function deleteRentalAgreementCharge(
  client: SupabaseClient<Database>,
  rentalAgreementChargeId: string,
  companyId: string
) {
  const charge = await client
    .from("rentalAgreementCharge")
    .select("id, rentalAgreementLine!inner(rentalAgreement!inner(status))")
    .eq("id", rentalAgreementChargeId)
    .eq("companyId", companyId)
    .single();
  if (charge.error) return charge;
  const status = charge.data.rentalAgreementLine.rentalAgreement.status;
  if (status !== "Draft" && status !== "Active") {
    return rentalRefusal(
      "RENTAL_AGREEMENT_NOT_OPEN",
      "Charges can only be removed from an open rental agreement"
    );
  }

  return client
    .from("rentalAgreementCharge")
    .delete()
    .eq("id", rentalAgreementChargeId)
    .eq("companyId", companyId)
    .is("salesInvoiceLineId", null)
    .select("id")
    .single();
}

/**
 * Every billing period of the agreement's lines, oldest first.
 */
export async function getRentalBillingPeriods(
  client: SupabaseClient<Database>,
  rentalAgreementId: string,
  companyId: string
) {
  return client
    .from("rentalBillingPeriod")
    .select(
      "*, rentalAgreementLine!inner(id, rentalAgreementId, fixedAsset(fixedAssetId, name)), memo(id, memoId, status)"
    )
    .eq("rentalAgreementLine.rentalAgreementId", rentalAgreementId)
    .eq("companyId", companyId)
    .order("periodStart", { ascending: true })
    .order("isAdjustment", { ascending: true });
}

/**
 * Fleet units free to put on a new line.
 */
export async function getRentableFleetAssets(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("fleetAssets")
    .select(
      "id, fixedAssetId, name, serialNumber, itemId, itemReadableId, itemName, className"
    )
    .eq("companyId", companyId)
    .eq("fleetStatus", "Available")
    .order("fixedAssetId");
}

export async function getItemRentalRate(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string,
  currencyCode: string
) {
  return client
    .from("itemRentalRate")
    .select("*")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("currencyCode", currencyCode)
    .maybeSingle();
}

/**
 * One ladder per item and currency: an existing row is replaced in place.
 */
export async function upsertItemRentalRate(
  client: SupabaseClient<Database>,
  rate: Omit<z.infer<typeof itemRentalRateValidator>, "id"> & {
    companyId: string;
    userId: string;
  }
) {
  const { userId, ...values } = rate;
  const tiers = {
    dayRate: values.dayRate ?? null,
    weekRate: values.weekRate ?? null,
    monthRate: values.monthRate ?? null
  };
  return client
    .from("itemRentalRate")
    .upsert(
      [
        {
          itemId: values.itemId,
          currencyCode: values.currencyCode,
          companyId: values.companyId,
          ...tiers,
          createdBy: userId,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        }
      ],
      { onConflict: "companyId,itemId,currencyCode" }
    )
    .select("id")
    .single();
}

export async function deleteItemRentalRate(
  client: SupabaseClient<Database>,
  itemRentalRateId: string,
  companyId: string
) {
  return client
    .from("itemRentalRate")
    .delete()
    .eq("id", itemRentalRateId)
    .eq("companyId", companyId);
}

export async function getCustomerItemRentalRates(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("customerItemRentalRate")
    .select("*, customer(id, name), customerType(id, name)")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

export async function getCustomerItemRentalRate(
  client: SupabaseClient<Database>,
  customerItemRentalRateId: string,
  companyId: string
) {
  return client
    .from("customerItemRentalRate")
    .select("*")
    .eq("id", customerItemRentalRateId)
    .eq("companyId", companyId)
    .single();
}

/** One row per customer (or customer type), item and currency — a second
 *  row for the same scope is refused by the unique index (23505).
 */
export async function upsertCustomerItemRentalRate(
  client: SupabaseClient<Database>,
  rate: z.infer<typeof customerItemRentalRateValidator> & {
    companyId: string;
    userId: string;
  }
) {
  const values = {
    itemId: rate.itemId,
    currencyCode: rate.currencyCode,
    customerId: rate.customerId || null,
    customerTypeId: rate.customerId ? null : rate.customerTypeId || null,
    dayRate: rate.dayRate ?? null,
    weekRate: rate.weekRate ?? null,
    monthRate: rate.monthRate ?? null,
    validFrom: rate.validFrom || null,
    validTo: rate.validTo || null,
    notes: rate.notes || null
  };
  if (rate.id) {
    return client
      .from("customerItemRentalRate")
      .update({
        ...values,
        updatedBy: rate.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", rate.id)
      .eq("companyId", rate.companyId)
      .select("id")
      .single();
  }
  return client
    .from("customerItemRentalRate")
    .insert([{ ...values, companyId: rate.companyId, createdBy: rate.userId }])
    .select("id")
    .single();
}

export async function deleteCustomerItemRentalRate(
  client: SupabaseClient<Database>,
  customerItemRentalRateId: string,
  companyId: string
) {
  return client
    .from("customerItemRentalRate")
    .delete()
    .eq("id", customerItemRentalRateId)
    .eq("companyId", companyId);
}

/** The live rental line a fleet unit is on rent under, if any — a unit on
 *  rent cannot be taken out of service; return it from the agreement first. */
export async function getOnRentLineForAsset(
  client: SupabaseClient<Database>,
  fixedAssetId: string,
  companyId: string
) {
  return client
    .from("rentalAgreementLine")
    .select("id, rentalAgreement(id, rentalAgreementId)")
    .eq("fixedAssetId", fixedAssetId)
    .eq("companyId", companyId)
    .eq("status", "On Rent")
    .limit(1)
    .maybeSingle();
}

/**
 * Customer payments held against the agreement — deposits and refunds.
 */
export async function getRentalAgreementDeposits(
  client: SupabaseClient<Database>,
  rentalAgreementId: string,
  companyId: string
) {
  return client
    .from("payment")
    .select(
      "id, paymentId, paymentType, status, paymentDate, totalAmount, currencyCode"
    )
    .eq("rentalAgreementId", rentalAgreementId)
    .eq("companyId", companyId)
    .order("paymentDate", { ascending: true });
}

export async function getRentalAgreementRelatedDocuments(
  client: SupabaseClient<Database>,
  rentalAgreementId: string,
  companyId: string
) {
  const [shipments, receipts] = await Promise.all([
    client
      .from("shipment")
      .select(
        "id, shipmentId, status, postingDate, shipmentFixedAssetLine(rentalAgreementLineId, shipped)"
      )
      .eq("sourceDocument", "Rental Agreement")
      .eq("sourceDocumentId", rentalAgreementId)
      .eq("companyId", companyId)
      .order("createdAt"),
    client
      .from("receipt")
      .select(
        "id, receiptId, status, postingDate, receiptFixedAssetLine(rentalAgreementLineId, received)"
      )
      .eq("sourceDocument", "Rental Agreement")
      .eq("sourceDocumentId", rentalAgreementId)
      .eq("companyId", companyId)
      .order("createdAt")
  ]);
  return {
    data: { shipments: shipments.data ?? [], receipts: receipts.data ?? [] },
    error: shipments.error ?? receipts.error
  };
}

// ----------------------------------------------------------------------
// Customer contracts (`.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III). Confirm, schedule
// edits, amend, cancel and revert go through the `post-customer-contract`
// server function; invoices are drafted by `create-contract-invoices`. These
// are the plain reads and the Draft-stage writes. They are MCP tools, so they
// carry their own guards and build every row from an explicit field picker.
// ----------------------------------------------------------------------

/**
 * Lists contracts with their customer, value invoiced to date and next invoice date.
 */
export async function getContracts(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("customerContracts")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      searchFilter(["customerContractId", "name", "customerName"], args.search)
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);

  return query;
}

/**
 * Gets one contract with its customer, value invoiced to date and next invoice date.
 */
export async function getContract(
  client: SupabaseClient<Database>,
  customerContractId: string,
  companyId: string
) {
  return client
    .from("customerContracts")
    .select("*")
    .eq("id", customerContractId)
    .eq("companyId", companyId)
    .single();
}

/**
 * Lists a contract's lines with their service items.
 */
export async function getContractLines(
  client: SupabaseClient<Database>,
  customerContractId: string,
  companyId: string
) {
  return client
    .from("customerContractLine")
    .select("*, item(name, readableIdWithRevision, type)")
    .eq("customerContractId", customerContractId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true, nullsFirst: false })
    .order("startDate", { ascending: true });
}

/**
 * Gets one contract line with its service item.
 */
export async function getContractLine(
  client: SupabaseClient<Database>,
  customerContractLineId: string,
  companyId: string
) {
  return client
    .from("customerContractLine")
    .select("*, item(name, readableIdWithRevision, type)")
    .eq("id", customerContractLineId)
    .eq("companyId", companyId)
    .single();
}

/**
 * Gets a contract's persisted invoice schedule: planned invoices with their lines, and the cancellation credits that sit on a memo instead of an invoice.
 * An unedited Draft has none — its schedule is computed from the lines.
 */
export async function getContractInvoiceSchedule(
  client: SupabaseClient<Database>,
  customerContractId: string,
  companyId: string
) {
  const [invoices, credits] = await Promise.all([
    client
      .from("customerContractInvoice")
      .select("*, customerContractInvoiceLine(*)")
      .eq("customerContractId", customerContractId)
      .eq("companyId", companyId)
      .order("invoiceDate", { ascending: true })
      .order("periodStart", {
        ascending: true,
        referencedTable: "customerContractInvoiceLine"
      }),
    client
      .from("customerContractInvoiceLine")
      .select("*")
      .eq("customerContractId", customerContractId)
      .eq("companyId", companyId)
      .is("customerContractInvoiceId", null)
      .order("periodStart", { ascending: true })
  ]);

  if (invoices.error) return { data: null, error: invoices.error };
  if (credits.error) return { data: null, error: credits.error };
  return {
    data: { invoices: invoices.data, credits: credits.data },
    error: null
  };
}

/**
 * Lists a contract's amendments, oldest first, with the lines each one added or replaced.
 */
export async function getContractAmendments(
  client: SupabaseClient<Database>,
  customerContractId: string,
  companyId: string
) {
  return client
    .from("customerContractAmendment")
    .select(
      "*, customerContractLine(id, revenueType, itemId, description, quantity, rate, rateUnit, startDate, endDate, amendsLineId)"
    )
    .eq("customerContractId", customerContractId)
    .eq("companyId", companyId)
    .order("amendmentDate", { ascending: true })
    .order("createdAt", { ascending: true });
}

/**
 * Lists the statuses of a customer's contracts, from which a new contract's type is suggested.
 */
export async function getCustomerContractStatuses(
  client: SupabaseClient<Database>,
  companyId: string,
  customerId: string
) {
  return client
    .from("customerContract")
    .select("status")
    .eq("companyId", companyId)
    .eq("customerId", customerId);
}

/** A refusal shaped like a PostgREST error, so every caller's existing
 *  `result.error` handling (routes, MCP dispatch) reports it unchanged. */
function contractRefusal(code: string, message: string) {
  return {
    data: null,
    error: { message, details: "", hint: "", code } as PostgrestError
  };
}

/** Percent points (10) to the 0–1 fraction the columns hold, at internal
 *  scale so 14.3 does not store as 0.14300000000000002. */
function percentToFraction(points: number) {
  return round(points / 100);
}

/** The terms a caller may write — never `status`, the confirm / cancel / end
 *  stamps or `salesOrderId`, which the lifecycle owns. Picked rather than
 *  spread, since MCP inputs reach these writers unfiltered. `endDate` and
 *  `termMonths` come from the duration. */
function customerContractTerms(
  terms: Omit<
    z.infer<typeof customerContractValidator>,
    "id" | "customerContractId"
  >
) {
  const { endDate, termMonths } = contractEndDate(
    terms.startDate,
    terms.duration,
    terms.endDate
  );
  return {
    name: terms.name,
    // NOT NULL with a default: an omitted type leaves the column alone
    // rather than writing the null `sanitize` turns undefined into.
    ...(terms.contractType ? { contractType: terms.contractType } : {}),
    customerId: terms.customerId,
    invoiceCustomerId: terms.invoiceCustomerId,
    invoiceCustomerContactId: terms.invoiceCustomerContactId,
    invoiceCustomerLocationId: terms.invoiceCustomerLocationId,
    shipToCustomerLocationId: terms.shipToCustomerLocationId,
    salesPersonId: terms.salesPersonId,
    projectId: terms.projectId,
    customerReference: terms.customerReference,
    closeDate: terms.closeDate,
    startDate: terms.startDate,
    endDate,
    termMonths,
    renewal: terms.renewal,
    renewalUplift: percentToFraction(terms.renewalUplift),
    billingFrequency: terms.billingFrequency,
    billingAlignment: terms.billingAlignment,
    billingTiming: terms.billingTiming,
    // A cleared DatePicker posts "", which a DATE column rejects.
    firstInvoiceDate: terms.firstInvoiceDate || null,
    billedThrough: terms.billedThrough || null,
    recognizeRevenueFrom: terms.recognizeRevenueFrom || null,
    // Empty is the company default.
    invoiceAutomation: terms.invoiceAutomation || null,
    paymentTermId: terms.paymentTermId,
    currencyCode: terms.currencyCode,
    // NOT NULL DEFAULT 1 and not on the form: only a caller that sends a rate
    // writes one.
    ...(terms.exchangeRate !== undefined
      ? { exchangeRate: terms.exchangeRate }
      : {}),
    notes: terms.notes
  };
}

/**
 * Creates a Draft contract; its end date and term come from the duration.
 * `customerContractId` (the readable CON number) comes from the caller.
 * Not published: `sales.contract.create` draws the number and fills the
 * invoicing defaults.
 */
export async function insertContract(
  client: SupabaseClient<Database>,
  contract: Omit<z.infer<typeof customerContractValidator>, "id"> & {
    customerContractId: string;
    companyId: string;
    createdBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("customerContract")
    .insert([
      {
        ...sanitize(customerContractTerms(contract)),
        customerContractId: contract.customerContractId,
        companyId: contract.companyId,
        createdBy: contract.createdBy,
        customFields: contract.customFields
      }
    ])
    .select("id, customerContractId")
    .single();
}

/**
 * Updates a Draft contract's terms; an Active contract is changed with Amend.
 * Not published: `sales.contract.updateTerms` / `setTerm` bring the customer defaults and rate.
 */
export async function updateContract(
  client: SupabaseClient<Database>,
  contract: Omit<
    z.infer<typeof customerContractValidator>,
    "id" | "customerContractId"
  > & {
    id: string;
    updatedBy: string;
    customFields?: Json;
  }
) {
  const current = await client
    .from("customerContract")
    .select("status")
    .eq("id", contract.id)
    .single();
  if (current.error) return current;
  if (current.data.status !== "Draft") {
    return contractRefusal(
      "CONTRACT_NOT_DRAFT",
      "Only a Draft contract can be edited — use Amend"
    );
  }

  return client
    .from("customerContract")
    .update(
      sanitize({
        ...customerContractTerms(contract),
        customFields: contract.customFields,
        updatedBy: contract.updatedBy,
        updatedAt: datetime.timestamp()
      })
    )
    .eq("id", contract.id)
    .eq("status", "Draft")
    .select("id")
    .single();
}

/**
 * Sets a contract's type (New Sales, Expansion, …) in any status — a reporting classification, not a term.
 * Not published: `sales.contract.setType` is the same write.
 */
export async function updateContractType(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    contractType: Database["public"]["Enums"]["customerContractType"];
    updatedBy: string;
  }
) {
  return client
    .from("customerContract")
    .update({
      contractType: args.contractType,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

/**
 * Sets a contract's notes in any status: notes are not a term, so they stay
 * editable after Confirm.
 * Not published: `sales.contract.setTerm` writes notes on any contract.
 */
export async function updateContractNotes(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    notes: Json | null;
    updatedBy: string;
  }
) {
  return client
    .from("customerContract")
    .update({
      notes: args.notes,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

/**
 * Sets how the daily run handles one contract's invoices, in any status; null falls back to the company's setting.
 * Sending needs an email to send to, so `Post and Email` is refused when the
 * invoice contact has none. `Post and Send via Stripe` is accepted here;
 * Confirm and the job check the customer's Stripe link.
 *
 * Not an MCP tool: switching a live contract to a posting mode needs
 * `create: invoicing`, and Stripe mode needs Stripe connected — checks the
 * route (`contract+/update.tsx`) makes and an MCP `update` tool would skip.
 */
export async function updateContractInvoiceAutomation(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    invoiceAutomation: z.infer<
      typeof customerContractInvoiceAutomationValidator
    >["invoiceAutomation"];
    updatedBy: string;
  }
) {
  if (args.invoiceAutomation === "Post and Email") {
    const current = await client
      .from("customerContract")
      .select("invoiceCustomerContactId")
      .eq("id", args.id)
      .eq("companyId", args.companyId)
      .single();
    if (current.error) return current;

    const contact = current.data.invoiceCustomerContactId
      ? await client
          .from("customerContact")
          .select("contact(email)")
          .eq("id", current.data.invoiceCustomerContactId)
          .eq("companyId", args.companyId)
          .maybeSingle()
      : null;
    if (contact?.error) return contact;
    if (!contact?.data?.contact?.email) {
      return contractRefusal(
        "CONTRACT_INVOICE_EMAIL_NO_CONTACT",
        "Add an invoice contact with an email to send invoices"
      );
    }
  }

  return client
    .from("customerContract")
    .update({
      invoiceAutomation: args.invoiceAutomation,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

/**
 * Adds or changes a line on a Draft contract; the item must be a Service item.
 * Lines on an Active contract change through Amend, and a line never moves
 * between contracts.
 */
export async function upsertContractLine(
  client: SupabaseClient<Database>,
  line:
    | (Omit<z.infer<typeof customerContractLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof customerContractLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  let companyId: string;
  if ("id" in line) {
    const existing = await client
      .from("customerContractLine")
      .select("companyId, customerContractId")
      .eq("id", line.id)
      .single();
    if (existing.error) return existing;
    if (existing.data.customerContractId !== line.customerContractId) {
      return contractRefusal(
        "CONTRACT_LINE_WRONG_CONTRACT",
        "This line does not belong to this contract"
      );
    }
    companyId = existing.data.companyId;
  } else {
    companyId = line.companyId;
  }

  const contract = await client
    .from("customerContract")
    .select("status")
    .eq("id", line.customerContractId)
    .eq("companyId", companyId)
    .single();
  if (contract.error) return contract;
  if (contract.data.status !== "Draft") {
    return contractRefusal(
      "CONTRACT_NOT_DRAFT",
      "Lines can only be added or changed on a Draft contract — use Amend"
    );
  }

  const item = await client
    .from("item")
    .select("type")
    .eq("id", line.itemId)
    .eq("companyId", companyId)
    .single();
  if (item.error) return item;
  if (item.data.type !== "Service") {
    return contractRefusal(
      "CONTRACT_LINE_NOT_SERVICE",
      "A contract line must be a Service item"
    );
  }

  // Picked, not spread: amendment and sales-order provenance and the sort
  // order belong to the server functions.
  const values = {
    customerContractId: line.customerContractId,
    revenueType: line.revenueType,
    itemId: line.itemId,
    description: line.description ?? null,
    quantity: line.quantity,
    rate: line.rate,
    rateUnit: line.revenueType === "Recurring" ? (line.rateUnit ?? null) : null,
    discountPercent: percentToFraction(line.discountPercent),
    discountEndsOn: line.discountEndsOn || null,
    taxPercent: percentToFraction(line.taxPercent),
    startDate: line.startDate,
    endDate: line.endDate || null,
    goLiveDate: line.goLiveDate || null,
    revenueMethod: line.revenueMethod,
    revenueStartDate: line.revenueStartDate || null,
    revenueEndDate: line.revenueEndDate || null,
    projectId: line.projectId || null
  };

  if ("id" in line) {
    return client
      .from("customerContractLine")
      .update({
        ...values,
        updatedBy: line.updatedBy,
        updatedAt: datetime.timestamp()
      })
      .eq("id", line.id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("customerContractLine")
    .insert([{ ...values, companyId, createdBy: line.createdBy }])
    .select("id")
    .single();
}

/** Adds several Service items to a Draft contract at once, each as a line
 *  with the defaults a new line gets (the setup wizard's Add Products).
 *  One read of the contract, one of the items, one insert. Not an MCP tool:
 *  `upsertContractLine` covers a single line. */
export async function insertContractLines(
  client: SupabaseClient<Database>,
  args: {
    customerContractId: string;
    companyId: string;
    createdBy: string;
    itemIds: string[];
    revenueType: Database["public"]["Enums"]["contractRevenueType"];
    rateUnit: Database["public"]["Enums"]["contractRateUnit"] | null;
    startDate: string;
    projectId: string | null;
  }
) {
  const contract = await client
    .from("customerContract")
    .select("status")
    .eq("id", args.customerContractId)
    .eq("companyId", args.companyId)
    .single();
  if (contract.error) return contract;
  if (contract.data.status !== "Draft") {
    return contractRefusal(
      "CONTRACT_NOT_DRAFT",
      "Lines can only be added or changed on a Draft contract — use Amend"
    );
  }

  const itemIds = [...new Set(args.itemIds)];
  const items = await client
    .from("item")
    .select("id, type")
    .eq("companyId", args.companyId)
    .in("id", itemIds);
  if (items.error) return items;
  if (
    items.data.length !== itemIds.length ||
    items.data.some((item) => item.type !== "Service")
  ) {
    return contractRefusal(
      "CONTRACT_LINE_NOT_SERVICE",
      "A contract line must be a Service item"
    );
  }

  const order = new Map(itemIds.map((id, index) => [id, index]));
  const rows = [...items.data]
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((item) => ({
      customerContractId: args.customerContractId,
      companyId: args.companyId,
      createdBy: args.createdBy,
      revenueType: args.revenueType,
      itemId: item.id,
      quantity: 1,
      // As a line added one at a time: the rate is the user's to set (an
      // item's sale price is in the company currency, not the contract's).
      rate: 0,
      rateUnit: args.revenueType === "Recurring" ? args.rateUnit : null,
      discountPercent: 0,
      taxPercent: 0,
      startDate: args.startDate,
      revenueMethod: "Daily" as const,
      projectId: args.projectId
    }));

  return client.from("customerContractLine").insert(rows).select("id");
}
// App-side bulk quote importer. Unlike the master-data imports (which run in the
// `import-csv` server function with direct Kysely writes), quotes are created
// through the real sales services so their side effects — opportunity,
// quotePayment, quoteShipment, external portal link, sequence number — are
// preserved (see `.ai/specs/2026-07-28-quote-bulk-import.md`, Option B).
//
// Three modes, discriminated by the `table` arg:
//   - `quote`          header rows only (one quote per row)
//   - `quoteLine`      lines + pricing appended to existing quotes (by Quote Number)
//   - `quoteWithLines` combined: header + line rows grouped by Quote Group
//
// Idempotency is create-only: a Quote Group whose external id was already
// imported (recorded in `externalIntegrationMapping`, integration `csv`) is
// skipped rather than duplicated. Within a file, a repeated (Part Number,
// Quantity) line is skipped too.

const QUOTE_IMPORT_TABLES = ["quote", "quoteLine", "quoteWithLines"] as const;

export type QuoteImportTable = (typeof QUOTE_IMPORT_TABLES)[number];

export function isQuoteImportTable(table: string): table is QuoteImportTable {
  return (QUOTE_IMPORT_TABLES as readonly string[]).includes(table);
}

const EXTERNAL_INTEGRATION = "csv";

const QUOTE_ENTITY_TYPE = "quote";

const METHOD_TYPES = [
  "Purchase to Order",
  "Pull from Inventory",
  "Make to Order"
] as const;

type MethodType = (typeof METHOD_TYPES)[number];

const LINE_STATUSES = [
  "Not Started",
  "In Progress",
  "Complete",
  "No Quote"
] as const;

type LineStatus = (typeof LINE_STATUSES)[number];

const QUOTE_STATUSES = [
  "Draft",
  "Sent",
  "Ordered",
  "Partial",
  "Lost",
  "Cancelled",
  "Expired"
] as const;

type QuoteStatus = (typeof QUOTE_STATUSES)[number];

// Legacy Buy/Pick/Make → current method-type names.
const LEGACY_METHOD_TYPE: Record<string, MethodType> = {
  buy: "Purchase to Order",
  pick: "Pull from Inventory",
  make: "Make to Order"
};

type Rec = Record<string, string>;

type RowIssue = { row: number; reason: string; values: Rec };

type Summary = {
  inserted: number;
  updated: number;
  errors: RowIssue[];
  skipped: RowIssue[];
};

type ImportQuotesArgs = {
  // `upsertQuoteLinePrices` runs a Kysely transaction, so the importer needs the
  // Kysely handle alongside the Supabase client. Built by the route action
  // (`getDatabaseClient()`) and passed in, per the `no-db-client-in-service` seam.
  db: Kysely<KyselyDatabase>;
  table: QuoteImportTable;
  filePath: string;
  columnMappings: Record<string, string>;
  enumMappings?: Record<string, Record<string, string>>;
  companyId: string;
  companyGroupId: string;
  userId: string;
};

type ImportQuotesResult = {
  data: Summary | null;
  error: { message: string } | null;
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

// PostgREST caps a single `.in(...)` list; chunk large id sets so a big file
// can't blow the request size limit.
const LOOKUP_CHUNK = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

const text = (value: string | null | undefined): string => (value ?? "").trim();

const num = (value: string | null | undefined): number | undefined => {
  const t = text(value);
  if (!t) return undefined;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

function normalizeMethodType(raw: string | undefined): MethodType | null {
  const t = text(raw);
  if (!t) return null;
  const lower = t.toLowerCase();
  if (LEGACY_METHOD_TYPE[lower]) return LEGACY_METHOD_TYPE[lower];
  const match = METHOD_TYPES.find((m) => m.toLowerCase() === lower);
  return match ?? null;
}

function normalizeLineStatus(raw: string | undefined): LineStatus {
  const t = text(raw).toLowerCase();
  return LINE_STATUSES.find((s) => s.toLowerCase() === t) ?? "Not Started";
}

function normalizeQuoteStatus(
  raw: string | undefined
): QuoteStatus | undefined {
  const t = text(raw).toLowerCase();
  return QUOTE_STATUSES.find((s) => s.toLowerCase() === t);
}

// discountPercent is stored as a fraction 0..1. To remove the ambiguity at 1
// (100% or 1%?), the format decides: a decimal-formatted value (contains ".") is
// a fraction and must be 0..1; a whole number is a percent and must be 0..100
// (e.g. "0.10" → 0.10, "10" → 0.10, "1" → 0.01). Reject out-of-range / negative.
function normalizeDiscount(raw: string | undefined): number | "invalid" {
  const t = text(raw);
  if (!t) return 0;
  const n = num(t);
  if (n === undefined || n < 0) return "invalid";
  if (t.includes(".")) return n <= 1 ? n : "invalid";
  return n <= 100 ? n / 100 : "invalid";
}

type RowType = "QUOTE" | "LINE";

function resolveRowType(record: Rec, table: QuoteImportTable): RowType {
  if (table === "quote") return "QUOTE";
  if (table === "quoteLine") return "LINE";
  const explicit = text(record.rowType).toUpperCase();
  if (explicit === "QUOTE") return "QUOTE";
  if (explicit === "LINE") return "LINE";
  // Blank Row Type: a Part Number means it's a line, otherwise a header.
  return text(record.itemReadableId) ? "LINE" : "QUOTE";
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export async function importQuotes(
  client: SupabaseClient<Database>,
  args: ImportQuotesArgs
): Promise<ImportQuotesResult> {
  const {
    db,
    table,
    filePath,
    columnMappings,
    companyId,
    companyGroupId,
    userId
  } = args;

  const summary: Summary = {
    inserted: 0,
    updated: 0,
    errors: [],
    skipped: []
  };

  // 1. download + parse ----------------------------------------------------
  const download = await storage(client).company(companyId).download(filePath);
  if (!download.data) {
    return {
      data: null,
      error: {
        message: download.error.message || "Failed to download file"
      }
    };
  }

  const csvText = await download.data.text();
  const rawRows = parseCsv<Rec>(csvText).rows;

  // 2. apply column (and any enum) mappings → per-field records ------------
  const records: Rec[] = rawRows.map((raw) => {
    const mapped: Rec = {};
    for (const [field, header] of Object.entries(columnMappings)) {
      if (!header || header === "N/A") continue;
      // parseCsv trims header names; mappings saved before that change may
      // hold padded ones, so match on the trimmed form.
      const value = text(raw[header.trim()]);
      const enumMap = args.enumMappings?.[field];
      mapped[field] = enumMap
        ? (enumMap[value] ?? enumMap.Default ?? value)
        : value;
    }
    return mapped;
  });

  if (records.length === 0) {
    return { data: summary, error: null };
  }

  // 3. batch-resolve references (customers, items, existing quotes) --------
  const { refs, error: refError } = await loadReferences(
    client,
    companyId,
    records,
    table
  );
  if (refError || !refs) {
    return {
      data: null,
      error: refError ?? { message: "Failed to load import references" }
    };
  }

  // 4. process by mode -----------------------------------------------------
  if (table === "quoteLine") {
    await importLinesIntoExistingQuotes(client, {
      db,
      records,
      raws: rawRows,
      refs,
      companyId,
      userId,
      summary
    });
  } else {
    await importQuoteGroups(client, {
      db,
      table,
      records,
      raws: rawRows,
      refs,
      companyId,
      companyGroupId,
      userId,
      summary
    });
  }

  return { data: summary, error: null };
}

// ---------------------------------------------------------------------------
// reference resolution
// ---------------------------------------------------------------------------

// `type` is narrowed to the item table's own enum (not `string`) so the
// quoteLine payload below can be type-checked without a cast.
type ItemType = Database["public"]["Tables"]["item"]["Row"]["type"];

// `item.type` is wider than what may appear on a quote line — a Fixture is
// stocked but never sold (see `itemType` in shared.models). Reject it by name
// instead of sending a value the line validator does not accept.
type SellableItemType = (typeof sellableItemTypes)[number];

function toSellableItemType(value: ItemType): SellableItemType | null {
  return (sellableItemTypes as readonly string[]).includes(value)
    ? (value as SellableItemType)
    : null;
}

type ItemInfo = {
  id: string;
  readableId: string;
  type: ItemType;
  defaultMethodType: string | null;
  unitOfMeasureCode: string | null;
};

type References = {
  customersByKey: Map<string, string>; // lowercased name|readableId → customer.id
  ambiguousCustomers: Set<string>;
  itemsByReadableId: Map<string, ItemInfo>; // exact readableId → item
  quotesByNumber: Map<string, string>; // Quote Number → quote.id
  importedExternalIds: Set<string>;
};

// Resolves every reference the import needs up front. Any DB read failing is a
// hard error (returned, not swallowed) so a lookup failure never masquerades as
// a row-level "not found".
async function loadReferences(
  client: SupabaseClient<Database>,
  companyId: string,
  records: Rec[],
  table: QuoteImportTable
): Promise<{ refs: References | null; error: { message: string } | null }> {
  const refs: References = {
    customersByKey: new Map(),
    ambiguousCustomers: new Set(),
    itemsByReadableId: new Map(),
    quotesByNumber: new Map(),
    importedExternalIds: new Set()
  };

  // Customers — resolve by name or readableId (only for header rows). Name
  // matching is case-insensitive, so fetch all company customers (paged past the
  // 1000-row cap) and compare in memory.
  const hasCustomerKey = records.some((r) => text(r.customerId));
  if (hasCustomerKey && table !== "quoteLine") {
    try {
      const customers = await fetchAllFromTable<{
        id: string;
        name: string | null;
        readableId: string | null;
      }>(client, "customer", "id, name, readableId", (q) =>
        q.eq("companyId", companyId)
      );
      for (const c of customers.data ?? []) {
        for (const raw of [c.name, c.readableId]) {
          const k = text(raw).toLowerCase();
          if (!k) continue;
          if (
            refs.customersByKey.has(k) &&
            refs.customersByKey.get(k) !== c.id
          ) {
            refs.ambiguousCustomers.add(k);
          } else {
            refs.customersByKey.set(k, c.id);
          }
        }
      }
    } catch (err) {
      return {
        refs: null,
        error: {
          message: `Failed to load customers: ${(err as Error).message}`
        }
      };
    }
  }

  // Items — resolve part numbers (exact readableId match), chunked.
  const partNumbers = new Set<string>();
  for (const r of records) {
    const pn = text(r.itemReadableId);
    if (pn) partNumbers.add(pn);
  }
  for (const batch of chunk(Array.from(partNumbers), LOOKUP_CHUNK)) {
    const items = await client
      .from("item")
      .select("id, readableId, type, defaultMethodType, unitOfMeasureCode")
      .eq("companyId", companyId)
      .in("readableId", batch);
    if (items.error) {
      return {
        refs: null,
        error: { message: `Failed to load items: ${items.error.message}` }
      };
    }
    for (const it of items.data ?? []) {
      refs.itemsByReadableId.set(text(it.readableId), {
        id: it.id,
        readableId: it.readableId,
        type: it.type ?? "Part",
        defaultMethodType: it.defaultMethodType ?? null,
        unitOfMeasureCode: it.unitOfMeasureCode ?? null
      });
    }
  }

  // Existing quotes — needed only when appending lines by Quote Number.
  if (table === "quoteLine") {
    const numbers = new Set<string>();
    for (const r of records) {
      const q = text(r.quoteId);
      if (q) numbers.add(q);
    }
    for (const batch of chunk(Array.from(numbers), LOOKUP_CHUNK)) {
      const quotes = await client
        .from("quote")
        .select("id, quoteId")
        .eq("companyId", companyId)
        .in("quoteId", batch);
      if (quotes.error) {
        return {
          refs: null,
          error: { message: `Failed to load quotes: ${quotes.error.message}` }
        };
      }
      for (const q of quotes.data ?? []) {
        refs.quotesByNumber.set(text(q.quoteId), q.id);
      }
    }
  }

  // Already-imported Quote Groups (create-only idempotency) — query only the
  // external ids present in this file, chunked, so a company with many prior
  // imports can't overflow the 1000-row cap and miss an existing mapping.
  if (table !== "quoteLine") {
    const externalIds = new Set<string>();
    for (const r of records) {
      const e = text(r.externalId);
      if (e) externalIds.add(e);
    }
    for (const batch of chunk(Array.from(externalIds), LOOKUP_CHUNK)) {
      const mappings = await client
        .from("externalIntegrationMapping")
        .select("externalId")
        .eq("companyId", companyId)
        .eq("integration", EXTERNAL_INTEGRATION)
        .eq("entityType", QUOTE_ENTITY_TYPE)
        .in("externalId", batch);
      if (mappings.error) {
        return {
          refs: null,
          error: {
            message: `Failed to load import history: ${mappings.error.message}`
          }
        };
      }
      for (const m of mappings.data ?? []) {
        const k = text(m.externalId);
        if (k) refs.importedExternalIds.add(k);
      }
    }
  }

  return { refs, error: null };
}

// ---------------------------------------------------------------------------
// mode: quote / quoteWithLines (grouped by Quote Group)
// ---------------------------------------------------------------------------

// `raw` is the ORIGINAL csv row, keyed by CSV HEADER. The results modal renders
// `values[<csv header>]` (it is handed `fileColumns`), so reporting the mapped
// record instead leaves every data cell blank and makes the "download rows to
// fix" export contain nothing but reasons.
type Entry = { record: Rec; raw: Rec; index: number };

async function importQuoteGroups(
  client: SupabaseClient<Database>,
  ctx: {
    db: Kysely<KyselyDatabase>;
    table: QuoteImportTable;
    records: Rec[];
    raws: Rec[];
    refs: References;
    companyId: string;
    companyGroupId: string;
    userId: string;
    summary: Summary;
  }
): Promise<void> {
  const {
    db,
    table,
    records,
    raws,
    refs,
    companyId,
    companyGroupId,
    userId,
    summary
  } = ctx;

  // Group rows by Quote Group (externalId), preserving order.
  const groups = new Map<
    string,
    { headers: Entry[]; lines: Entry[]; firstIndex: number }
  >();
  const groupOrder: string[] = [];

  records.forEach((record, index) => {
    const raw = raws[index] ?? record;
    const externalId = text(record.externalId);
    const rowType = resolveRowType(record, table);

    if (!externalId) {
      summary.errors.push({
        row: index,
        reason: "Quote Group is required",
        values: raw
      });
      return;
    }

    if (!groups.has(externalId)) {
      groups.set(externalId, { headers: [], lines: [], firstIndex: index });
      groupOrder.push(externalId);
    }
    const group = groups.get(externalId)!;
    if (rowType === "QUOTE") group.headers.push({ record, raw, index });
    else group.lines.push({ record, raw, index });
  });

  for (const externalId of groupOrder) {
    const group = groups.get(externalId)!;

    // Create-only idempotency: skip a Quote Group already imported.
    if (refs.importedExternalIds.has(externalId)) {
      for (const entry of [...group.headers, ...group.lines]) {
        summary.skipped.push({
          row: entry.index,
          reason: `Quote Group "${externalId}" was already imported`,
          values: entry.raw
        });
      }
      continue;
    }

    const header = group.headers[0];
    if (!header) {
      // Lines with no header row in the file (combined mode only).
      for (const entry of group.lines) {
        summary.errors.push({
          row: entry.index,
          reason: `No header (QUOTE) row for Quote Group "${externalId}"`,
          values: entry.raw
        });
      }
      continue;
    }

    // Extra header rows for the same group are duplicates.
    for (const dup of group.headers.slice(1)) {
      summary.skipped.push({
        row: dup.index,
        reason: `Duplicate header for Quote Group "${externalId}"`,
        values: dup.raw
      });
    }

    // Resolve + create the header.
    const customerKey = text(header.record.customerId).toLowerCase();
    if (!customerKey) {
      summary.errors.push({
        row: header.index,
        reason: "Customer is required",
        values: header.raw
      });
      failLines(group.lines, "Parent quote could not be created", summary);
      continue;
    }
    if (refs.ambiguousCustomers.has(customerKey)) {
      summary.errors.push({
        row: header.index,
        reason: `Customer "${text(header.record.customerId)}" is ambiguous`,
        values: header.raw
      });
      failLines(group.lines, "Parent quote could not be created", summary);
      continue;
    }
    const customerId = refs.customersByKey.get(customerKey);
    if (!customerId) {
      summary.errors.push({
        row: header.index,
        reason: `Customer "${text(header.record.customerId)}" not found`,
        values: header.raw
      });
      failLines(group.lines, "Parent quote could not be created", summary);
      continue;
    }

    const created = await insertQuote(client, {
      customerId,
      companyId,
      companyGroupId,
      createdBy: userId,
      customerReference: text(header.record.customerReference) || undefined,
      expirationDate: text(header.record.expirationDate) || undefined,
      dueDate: text(header.record.dueDate) || undefined,
      status: normalizeQuoteStatus(header.record.quoteStatus)
    });

    if (created.error || !created.data) {
      summary.errors.push({
        row: header.index,
        reason: created.error?.message ?? "Failed to create quote",
        values: header.raw
      });
      failLines(group.lines, "Parent quote could not be created", summary);
      continue;
    }

    summary.inserted += 1;
    const quoteInternalId = created.data.id;

    // Record the mapping so a re-import skips this Quote Group. If this write
    // fails the quote still exists, so surface it — a re-import would otherwise
    // create a duplicate quote for this group.
    const mappingInsert = await client
      .from("externalIntegrationMapping")
      .insert({
        entityType: QUOTE_ENTITY_TYPE,
        entityId: quoteInternalId,
        integration: EXTERNAL_INTEGRATION,
        externalId,
        companyId,
        createdBy: userId
      });
    if (mappingInsert.error) {
      summary.errors.push({
        row: header.index,
        reason: `Quote created, but recording its import mapping failed (a re-import may duplicate it): ${mappingInsert.error.message}`,
        values: header.raw
      });
    }

    await createLines(client, {
      db,
      quoteInternalId,
      lines: group.lines,
      refs,
      companyId,
      userId,
      summary
    });
  }
}

// ---------------------------------------------------------------------------
// mode: quoteLine (append to existing quotes by Quote Number)
// ---------------------------------------------------------------------------

async function importLinesIntoExistingQuotes(
  client: SupabaseClient<Database>,
  ctx: {
    db: Kysely<KyselyDatabase>;
    records: Rec[];
    raws: Rec[];
    refs: References;
    companyId: string;
    userId: string;
    summary: Summary;
  }
): Promise<void> {
  const { db, records, raws, refs, companyId, userId, summary } = ctx;

  const byQuote = new Map<string, Entry[]>();
  records.forEach((record, index) => {
    const raw = raws[index] ?? record;
    const quoteNumber = text(record.quoteId);
    if (!quoteNumber) {
      summary.errors.push({
        row: index,
        reason: "Quote Number is required",
        values: raw
      });
      return;
    }
    if (!byQuote.has(quoteNumber)) byQuote.set(quoteNumber, []);
    byQuote.get(quoteNumber)!.push({ record, raw, index });
  });

  for (const [quoteNumber, lines] of byQuote) {
    const quoteInternalId = refs.quotesByNumber.get(quoteNumber);
    if (!quoteInternalId) {
      failLines(lines, `Quote "${quoteNumber}" not found`, summary);
      continue;
    }
    await createLines(client, {
      db,
      quoteInternalId,
      lines,
      refs,
      companyId,
      userId,
      summary
    });
  }
}

// ---------------------------------------------------------------------------
// shared line creation (+ in-file dedup + explicit pricing)
// ---------------------------------------------------------------------------

async function createLines(
  client: SupabaseClient<Database>,
  ctx: {
    db: Kysely<KyselyDatabase>;
    quoteInternalId: string;
    lines: Entry[];
    refs: References;
    companyId: string;
    userId: string;
    summary: Summary;
  }
): Promise<void> {
  const { db, quoteInternalId, lines, refs, companyId, userId, summary } = ctx;
  const seen = new Set<string>(); // `${partNumber}|${quantity}` within this quote

  for (const { record, raw, index } of lines) {
    const partNumber = text(record.itemReadableId);
    if (!partNumber) {
      summary.errors.push({
        row: index,
        reason: "Part Number is required",
        values: raw
      });
      continue;
    }
    const item = refs.itemsByReadableId.get(partNumber);
    if (!item) {
      summary.errors.push({
        row: index,
        reason: `Part "${partNumber}" not found`,
        values: raw
      });
      continue;
    }

    const lineItemType = toSellableItemType(item.type);
    if (!lineItemType) {
      summary.errors.push({
        row: index,
        reason: `Part "${partNumber}" is a ${item.type} and cannot be quoted`,
        values: raw
      });
      continue;
    }

    const description = text(record.description) || item.readableId;
    const quantityRaw = text(record.quantity);
    if (!quantityRaw) {
      summary.errors.push({
        row: index,
        reason: "Quantity is required",
        values: raw
      });
      continue;
    }
    const quantity = num(quantityRaw);
    if (quantity === undefined || quantity < 0.00001) {
      summary.errors.push({
        row: index,
        reason: "Quantity must be a positive number",
        values: raw
      });
      continue;
    }

    const dedupKey = `${item.readableId}|${quantity}`;
    if (seen.has(dedupKey)) {
      summary.skipped.push({
        row: index,
        reason: `Duplicate line (${partNumber} @ qty ${quantity})`,
        values: raw
      });
      continue;
    }
    seen.add(dedupKey);

    const discount = normalizeDiscount(record.discountPercent);
    if (discount === "invalid") {
      summary.errors.push({
        row: index,
        reason:
          "Discount Percent must be a fraction 0–1 (e.g. 0.10) or a whole percent 0–100 (e.g. 10)",
        values: raw
      });
      continue;
    }

    const methodType =
      normalizeMethodType(record.methodType) ??
      normalizeMethodType(item.defaultMethodType ?? undefined) ??
      "Pull from Inventory";

    const unitOfMeasureCode =
      text(record.unitOfMeasureCode) || item.unitOfMeasureCode || "EA";

    // NOTE: `quoteLine` has no `itemReadableId` column — the readable id lives
    // on `item` and is joined in by the `quoteLines` view. Sending it makes
    // PostgREST reject the whole insert ("could not find the column ... in the
    // schema cache"), so every line silently fails while the header succeeds.
    const linePayload = {
      quoteId: quoteInternalId,
      itemId: item.id,
      itemType: lineItemType,
      description,
      methodType,
      unitOfMeasureCode,
      status: normalizeLineStatus(record.lineStatus),
      quantity: [quantity],
      taxPercent: 0,
      customerPartId: text(record.customerPartId) || undefined,
      companyId,
      createdBy: userId
    };

    const line = await upsertQuoteLine(client, linePayload);

    if (line.error || !line.data) {
      summary.errors.push({
        row: index,
        reason: line.error?.message ?? "Failed to create quote line",
        values: raw
      });
      continue;
    }

    summary.inserted += 1;
    const lineId = line.data.id;

    // Explicit quantity-break pricing. Only persist non-negative, valid numbers
    // — a present-but-invalid or negative Unit Price / Lead Time is rejected
    // rather than written to the quote line.
    const unitPriceRaw = text(record.unitPrice);
    if (unitPriceRaw) {
      const unitPrice = num(unitPriceRaw);
      const leadTimeRaw = text(record.leadTime);
      const leadTime = num(leadTimeRaw);

      if (unitPrice === undefined || unitPrice < 0) {
        summary.errors.push({
          row: index,
          reason:
            "Line created but Unit Price must be a number of 0 or greater",
          values: raw
        });
      } else if (leadTimeRaw && (leadTime === undefined || leadTime < 0)) {
        summary.errors.push({
          row: index,
          reason: "Line created but Lead Time must be a number of 0 or greater",
          values: raw
        });
      } else {
        // Kysely transaction — it throws rather than returning an error.
        try {
          await upsertQuoteLinePrices(db, companyId, quoteInternalId, lineId, [
            {
              quoteLineId: lineId,
              unitPrice,
              leadTime: leadTime ?? 0,
              discountPercent: discount,
              quantity,
              createdBy: userId,
              priceSource: "manual"
            }
          ]);
        } catch (err) {
          summary.errors.push({
            row: index,
            reason: `Line created but pricing failed: ${(err as Error).message}`,
            values: raw
          });
        }
      }
    }
  }
}

function failLines(lines: Entry[], reason: string, summary: Summary): void {
  for (const { raw, index } of lines) {
    summary.errors.push({ row: index, reason, values: raw });
  }
}
type BreakRow = { quantity: number; overridePrice: number; active: boolean };

export async function duplicatePriceOverrides(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  source: { customerId?: string; customerTypeId?: string },
  target: { customerId?: string; customerTypeId?: string },
  options?: {
    overrideIds?: string[];
    conflictStrategy?: "skip" | "overwrite";
  }
): Promise<{
  duplicated: number;
  skipped: number;
  overwritten: number;
  error: unknown;
}> {
  let query = client
    .from("customerItemPriceOverride")
    .select(
      "id, itemId, notes, validFrom, validTo, active, applyRulesOnTop, breaks:customerItemPriceOverrideBreak(quantity, overridePrice, active)"
    )
    .eq("companyId", companyId);

  if (source.customerId) {
    query = query.eq("customerId", source.customerId);
  } else if (source.customerTypeId) {
    query = query.eq("customerTypeId", source.customerTypeId);
  } else {
    query = query.is("customerId", null).is("customerTypeId", null);
  }

  if (options?.overrideIds?.length) {
    query = query.in("id", options.overrideIds);
  }

  const { data: sourceOverrides, error: fetchError } = await query;
  if (fetchError || !sourceOverrides) {
    return { duplicated: 0, skipped: 0, overwritten: 0, error: fetchError };
  }

  if (sourceOverrides.length === 0) {
    return { duplicated: 0, skipped: 0, overwritten: 0, error: null };
  }

  const strategy = options?.conflictStrategy ?? "skip";

  let existingLookup = client
    .from("customerItemPriceOverride")
    .select("id, itemId")
    .eq("companyId", companyId)
    .in(
      "itemId",
      sourceOverrides.map((s) => s.itemId)
    );

  existingLookup = target.customerId
    ? existingLookup.eq("customerId", target.customerId)
    : target.customerTypeId
      ? existingLookup.eq("customerTypeId", target.customerTypeId)
      : existingLookup.is("customerId", null).is("customerTypeId", null);

  const { data: existingOverrides } = await existingLookup;
  const existingByItemId = new Map(
    (existingOverrides ?? []).map((e) => [e.itemId, e.id])
  );

  try {
    const result = await db.transaction().execute(async (trx) => {
      let duplicated = 0;
      let skipped = 0;
      let overwritten = 0;

      for (const src of sourceOverrides) {
        const breaks = ((src.breaks as BreakRow[] | null) ?? []).map((b) => ({
          quantity: b.quantity,
          overridePrice: b.overridePrice,
          active: b.active
        }));

        if (breaks.length === 0) {
          skipped++;
          continue;
        }

        const existingId = existingByItemId.get(src.itemId);

        if (existingId && strategy === "skip") {
          skipped++;
          continue;
        }

        let parentId: string;

        if (existingId) {
          await trx
            .updateTable("customerItemPriceOverride")
            .set({
              active: src.active,
              applyRulesOnTop: src.applyRulesOnTop ?? true,
              notes: src.notes ?? null,
              validFrom: src.validFrom ?? null,
              validTo: src.validTo ?? null,
              customerId: target.customerId ?? null,
              customerTypeId: target.customerTypeId ?? null,
              itemId: src.itemId,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", existingId)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .deleteFrom("customerItemPriceOverrideBreak")
            .where("customerItemPriceOverrideId", "=", existingId)
            .where("companyId", "=", companyId)
            .execute();

          parentId = existingId;
          overwritten++;
        } else {
          const [row] = await trx
            .insertInto("customerItemPriceOverride")
            .values({
              companyId,
              createdBy: userId,
              itemId: src.itemId,
              customerId: target.customerId ?? null,
              customerTypeId: target.customerTypeId ?? null,
              active: src.active,
              applyRulesOnTop: src.applyRulesOnTop ?? true,
              notes: src.notes ?? null,
              validFrom: src.validFrom ?? null,
              validTo: src.validTo ?? null
            })
            .returning("id")
            .execute();

          parentId = row.id;
          duplicated++;
        }

        await trx
          .insertInto("customerItemPriceOverrideBreak")
          .values(
            breaks.map((b) => ({
              customerItemPriceOverrideId: parentId,
              companyId,
              createdBy: userId,
              quantity: b.quantity,
              overridePrice: b.overridePrice,
              active: b.active
            }))
          )
          .execute();
      }

      return { duplicated, skipped, overwritten };
    });

    return { ...result, error: null };
  } catch (e) {
    return { duplicated: 0, skipped: 0, overwritten: 0, error: e };
  }
}

/**
 * Save a quote line and reconcile its quantity-break prices atomically.
 *
 * These three writes have to land together. Previously the line update
 * committed first, then the prune, then the seed — so a resolver failure left
 * the line saved with its new breaks unpriced, and a failure after the prune
 * left it short rows it used to have. The user saw a flashed error but the data
 * was already half-applied.
 *
 * Price ROWS are computed by the caller beforehand (the resolvers only read),
 * so a pricing failure aborts before anything is written at all. Those reads
 * are outside the transaction, which is fine: none of them touch the rows being
 * written here.
 */
export async function saveQuoteLineWithPrices(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    quoteId: string;
    lineId: string;
    line: Record<string, unknown>;
    removedQuantities: number[];
    priceRows: Record<string, unknown>[];
  }
): Promise<void> {
  const { companyId, quoteId, lineId, line, removedQuantities, priceRows } =
    args;

  await db.transaction().execute(async (trx) => {
    // Kysely bypasses RLS and lineId/quoteId come from the URL: the line must
    // belong to this company AND to the quote whose lock state the route
    // checked, or nothing is written. The form's own quoteId is overridden so
    // a line can't be re-parented onto another document.
    const result = await trx
      .updateTable("quoteLine")
      .set({ ...line, quoteId } as never)
      .where("id", "=", lineId)
      .where("quoteId", "=", quoteId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) {
      throw new Error(`Quote line ${lineId} not found`);
    }

    if (removedQuantities.length > 0) {
      await trx
        .deleteFrom("quoteLinePrice")
        .where("quoteLineId", "=", lineId)
        .where("companyId", "=", companyId)
        .where("quantity", "in", removedQuantities)
        .execute();
    }

    if (priceRows.length > 0) {
      await trx
        .insertInto("quoteLinePrice")
        .values(
          // Kysely sends a JS array as a Postgres array literal; jsonb needs
          // JSON text.
          priceRows.map((row) => ({
            ...row,
            priceTrace: row.priceTrace ? JSON.stringify(row.priceTrace) : null
          })) as never
        )
        .execute();
    }
  });
}

// ---------------------------------------------------------------------------
// Sales-rule outcome evidence
// ---------------------------------------------------------------------------

/**
 * Persist sales-rule override/block evidence and notify the configured group.
 *
 * One `enforcementRuleAcknowledgment` row per deduped violation, plus one
 * `sales-rule-violation` notification. Both writes are best-effort: evidence
 * or notification failures are logged and must never break the submission
 * they describe. Callers pass the SERVICE-ROLE client — the acknowledgment
 * table's INSERT policy requires `sales_create`, but the documents these
 * gates protect (invoices, shipments) are legitimately posted by users
 * without it.
 *
 * Line actions pass `documentLineId`/`itemId` for the single line they wrote;
 * document gates leave them unset and each violation's own `lineId` (stamped
 * by the document evaluator) attributes the row instead.
 */
export async function recordSalesRuleOutcome(
  serviceRole: SupabaseClient<Database>,
  args: {
    companyId: string;
    userId: string;
    documentType: "quote" | "salesOrder" | "salesInvoice";
    documentId: string;
    outcome: "blocked" | "acknowledged";
    violations: Violation[];
    ruleNames: Record<string, string>;
    documentLineId?: string | null;
    itemId?: string | null;
  }
): Promise<void> {
  const {
    companyId,
    userId,
    documentType,
    documentId,
    outcome,
    violations,
    ruleNames
  } = args;
  if (violations.length === 0) return;

  const acknowledgmentInsert = await serviceRole
    .from("enforcementRuleAcknowledgment")
    .insert(
      violations.map((v) => ({
        companyId,
        ruleId: v.ruleId,
        ruleName: ruleNames[v.ruleId] ?? null,
        documentType,
        documentId,
        // A caller that evaluated a single line knows the real line id (or
        // that none exists yet) and passes the key — the evaluator's stamp is
        // a placeholder ("new") there. Document gates omit the key and the
        // per-violation stamp is the attribution.
        documentLineId:
          "documentLineId" in args
            ? (args.documentLineId ?? null)
            : (v.lineId ?? null),
        itemId: args.itemId ?? null,
        severity: v.severity,
        outcome,
        message: v.message,
        createdBy: userId
      }))
    );
  if (acknowledgmentInsert.error) {
    logger.error("Failed to record sales rule acknowledgments", {
      error: acknowledgmentInsert.error
    });
  }

  try {
    const companySettings = await getCompanySettings(serviceRole, companyId);
    if (companySettings.data?.salesRuleNotificationGroup?.length) {
      await trigger("notify", {
        companyId,
        documentId: `${documentType}:${documentId}:${outcome}`,
        event: NotificationEvent.SalesRuleViolation,
        recipient: {
          type: "group",
          groupIds: companySettings.data.salesRuleNotificationGroup
        },
        from: userId
      });
    }
  } catch (err) {
    logger.error("Failed to trigger sales rule violation notification", {
      error: err
    });
  }
}

// ---------------------------------------------------------------------------
// Rental invoices
// ---------------------------------------------------------------------------

/**
 * The `Purchase Option` charge Sell to Customer bills (`$id.$lineId.sell.tsx`,
 * which checks the agreement is Active, the line is a Sale unit On Rent
 * and the option is not already billed). Server-only on purpose: the
 * `sales.service.ts` charge writer is an MCP tool and only ever writes a
 * `Charge`, so no caller can name this charge type and skip those checks.
 */
export async function insertRentalPurchaseOptionCharge(
  client: SupabaseClient<Database>,
  charge: {
    rentalAgreementLineId: string;
    chargeDate: string;
    description: string;
    amount: number;
    taxPercent: number;
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("rentalAgreementCharge")
    .insert([{ ...charge, chargeType: "Purchase Option" as const }])
    .select("id")
    .single();
}

/** The agreement page's "Invoice" (and Sell to Customer): drafts the
 *  invoices for whatever the agreement has due, exactly as the daily job
 *  would — the `create-rental-invoices` server function. */
export async function generateRentalInvoicesNow(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    /** `YYYY-MM-DD` in the company's timezone. */
    asOf: string;
    rentalAgreementId: string;
  }
): Promise<{
  invoices: DraftedRentalInvoice[];
  invoiceIds: string[];
  /** Draft credit memos for early returns, one per agreement. */
  creditMemos: DraftedRentalCreditMemo[];
}> {
  const { companyId, userId, asOf, rentalAgreementId } = args;
  const drafted = await invokePosting(
    { db, companyId, userId },
    "create-rental-invoices",
    { asOf, rentalAgreementId },
    createRentalInvoices
  );
  if (drafted.error) throw drafted.error;
  const { invoices, invoiceIds, creditMemos, failures } = drafted.data;
  // One agreement is billed here, so its failure is the action's failure.
  if (failures.length > 0) {
    throw new Error(failures.map((f) => f.error).join("; "));
  }
  return { invoices, invoiceIds, creditMemos };
}

/**
 * Releases what a Draft invoice (or some of its lines) billed, so the next
 * generation bills it again: rental billing periods and charges, and contract
 * schedule rows. Called in the same transaction as the delete:
 * `salesInvoiceLineId` has no foreign key, so a delete alone would leave the
 * rows stamped as billed by a line that no longer exists.
 *
 * A contract's planned invoice goes back to Planned only once none of its
 * rows is still stamped — deleting one contract line from a Draft leaves the
 * planned invoice Invoiced while its other lines are still on that Draft.
 * `voidedSalesInvoiceId` is left alone, so a re-bill hold stays (rental
 * decision 8).
 */
async function releaseRecurringInvoiceStamps(
  trx: KyselyTx,
  args: { companyId: string; salesInvoiceLineIds: string[]; userId: string }
): Promise<void> {
  const { companyId, salesInvoiceLineIds, userId } = args;
  if (salesInvoiceLineIds.length === 0) return;

  await trx
    .updateTable("rentalBillingPeriod")
    .set({
      status: "Pending",
      salesInvoiceLineId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("salesInvoiceLineId", "in", salesInvoiceLineIds)
    .execute();

  await trx
    .updateTable("rentalAgreementCharge")
    .set({
      salesInvoiceLineId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("salesInvoiceLineId", "in", salesInvoiceLineIds)
    .execute();

  const releasedRows = await trx
    .updateTable("customerContractInvoiceLine")
    .set({
      salesInvoiceLineId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("salesInvoiceLineId", "in", salesInvoiceLineIds)
    .returning("customerContractInvoiceId")
    .execute();

  const plannedInvoiceIds = [
    ...new Set(
      releasedRows.flatMap((row) =>
        row.customerContractInvoiceId ? [row.customerContractInvoiceId] : []
      )
    )
  ];
  if (plannedInvoiceIds.length === 0) return;

  await trx
    .updateTable("customerContractInvoice")
    .set({
      status: "Planned",
      salesInvoiceId: null,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("id", "in", plannedInvoiceIds)
    .where("status", "=", "Invoiced")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("customerContractInvoiceLine as stamped")
            .select(sql`1`.as("one"))
            .whereRef(
              "stamped.customerContractInvoiceId",
              "=",
              "customerContractInvoice.id"
            )
            .where("stamped.companyId", "=", companyId)
            .where("stamped.salesInvoiceLineId", "is not", null)
        )
      )
    )
    .execute();
}

/**
 * Deletes a Draft sales invoice and, in the same transaction, releases the
 * rental billing periods and charges and the contract schedule rows it
 * billed, so the next generation bills them again. `salesInvoiceLineId` on
 * those rows has no foreign key, so a plain delete would leave them stamped
 * as billed forever. Throws on a missing or non-Draft invoice.
 */
export async function deleteSalesInvoiceReleasingRentals(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; invoiceId: string; userId: string }
): Promise<void> {
  const { companyId, invoiceId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const invoice = await trx
      .selectFrom("salesInvoice")
      .select(["id", "status"])
      .where("id", "=", invoiceId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!invoice) throw new Error("Sales invoice not found");
    if (invoice.status !== "Draft") {
      throw new Error(
        `Cannot delete sales invoice with status "${invoice.status}". Only Draft invoices can be deleted.`
      );
    }

    const lines = await trx
      .selectFrom("salesInvoiceLine")
      .select("id")
      .where("invoiceId", "=", invoiceId)
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("invoiceLineType", "=", "Rental"),
          eb("customerContractInvoiceLineId", "is not", null)
        ])
      )
      .execute();
    await releaseRecurringInvoiceStamps(trx, {
      companyId,
      salesInvoiceLineIds: lines.map((line) => line.id),
      userId
    });

    await trx
      .deleteFrom("salesInvoice")
      .where("id", "=", invoiceId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/**
 * Deletes a Draft rental early-return credit memo and returns the
 * adjustment periods it credits to Pending, in one transaction, so the next
 * invoice run credits them again. `rentalBillingPeriod.memoId` RESTRICTs a
 * plain delete for exactly this reason. Throws on a missing or non-Draft
 * memo, or one that credits no rental agreement.
 */
export async function deleteRentalCreditMemoReleasingPeriods(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; memoId: string; userId: string }
): Promise<void> {
  const { companyId, memoId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const memo = await trx
      .selectFrom("memo")
      .select(["id", "status", "rentalAgreementId"])
      .where("id", "=", memoId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!memo) throw new Error("Memo not found");
    if (!memo.rentalAgreementId) {
      throw new Error("This memo does not credit a rental agreement");
    }
    if (memo.status !== "Draft") {
      throw new Error(
        `Cannot delete a ${memo.status} memo. Only Draft memos can be deleted.`
      );
    }
    await trx
      .updateTable("rentalBillingPeriod")
      .set({
        status: "Pending",
        memoId: null,
        updatedBy: userId,
        updatedAt: sql`now()`
      })
      .where("companyId", "=", companyId)
      .where("memoId", "=", memoId)
      .execute();
    await trx
      .deleteFrom("memo")
      .where("id", "=", memoId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** One line of a Draft invoice, releasing the rental period or charge, or
 *  the contract schedule row, it billed (see
 *  `deleteSalesInvoiceReleasingRentals`). The line must belong
 *  to `invoiceId` and that invoice must be Draft — checked here, under a row
 *  lock, because releasing a POSTED line's stamps would bill its period
 *  again. Throws otherwise. */
export async function deleteSalesInvoiceLineReleasingRentals(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    invoiceId: string;
    salesInvoiceLineId: string;
    userId: string;
  }
): Promise<void> {
  const { companyId, invoiceId, salesInvoiceLineId, userId } = args;
  await db.transaction().execute(async (trx) => {
    const line = await trx
      .selectFrom("salesInvoiceLine")
      .innerJoin("salesInvoice", (join) =>
        join
          .onRef("salesInvoice.id", "=", "salesInvoiceLine.invoiceId")
          .onRef("salesInvoice.companyId", "=", "salesInvoiceLine.companyId")
      )
      .select([
        "salesInvoiceLine.invoiceId as invoiceId",
        "salesInvoice.status as status"
      ])
      .where("salesInvoiceLine.id", "=", salesInvoiceLineId)
      .where("salesInvoiceLine.companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!line || line.invoiceId !== invoiceId) {
      throw new Error("Sales invoice line not found on this invoice");
    }
    if (line.status !== "Draft") {
      throw new Error(
        `Cannot delete a line of a sales invoice with status "${line.status}". Only Draft invoices can be edited.`
      );
    }

    await releaseRecurringInvoiceStamps(trx, {
      companyId,
      salesInvoiceLineIds: [salesInvoiceLineId],
      userId
    });
    await trx
      .deleteFrom("salesInvoiceLine")
      .where("id", "=", salesInvoiceLineId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** The contract page's "Invoice": drafts the invoices the contract has due,
 *  exactly as the daily job would — the `create-contract-invoices` server
 *  function. */
export async function generateContractInvoicesNow(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    /** `YYYY-MM-DD` in the company's timezone. */
    asOf: string;
    customerContractId: string;
  }
): Promise<{ invoices: DraftedContractInvoice[]; invoiceIds: string[] }> {
  const { companyId, userId, asOf, customerContractId } = args;
  const { invoices, invoiceIds, failures } = await invokePostingOrThrow(
    { db, companyId, userId },
    "create-contract-invoices",
    { asOf, customerContractId },
    createContractInvoices
  );
  // One contract is billed here, so its failure is the action's failure.
  if (failures.length > 0) {
    throw new Error(failures.map((f) => f.error).join("; "));
  }
  return { invoices, invoiceIds };
}

/** A new contract's invoicing terms from its customer: the bill-to
 *  customer, invoice contact and address and payment terms (Customer →
 *  Payment), and the ship-to address (Customer → Shipping) when it is one of
 *  the customer's own locations. Each is undefined when the customer has
 *  none, or a read fails — a default left empty is filled on the Invoicing
 *  step. */
export async function contractInvoicingDefaults(
  client: SupabaseClient<Database>,
  companyId: string,
  customerId: string
): Promise<{
  invoiceCustomerId: string | undefined;
  invoiceCustomerContactId: string | undefined;
  invoiceCustomerLocationId: string | undefined;
  paymentTermId: string | undefined;
  shipToCustomerLocationId: string | undefined;
}> {
  const [payment, shipping] = await Promise.all([
    client
      .from("customerPayment")
      .select(
        "invoiceCustomerId, invoiceCustomerContactId, invoiceCustomerLocationId, paymentTermId"
      )
      .eq("customerId", customerId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("customerShipping")
      .select("shippingCustomerId, shippingCustomerLocationId")
      .eq("customerId", customerId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (payment.error || shipping.error) {
    logger.error("Failed to read the customer's invoicing defaults", {
      companyId,
      customerId,
      error: payment.error ?? shipping.error
    });
  }

  const shipsToItself =
    !shipping.data?.shippingCustomerId ||
    shipping.data.shippingCustomerId === customerId;
  return {
    invoiceCustomerId: payment.data?.invoiceCustomerId ?? undefined,
    invoiceCustomerContactId:
      payment.data?.invoiceCustomerContactId ?? undefined,
    invoiceCustomerLocationId:
      payment.data?.invoiceCustomerLocationId ?? undefined,
    paymentTermId: payment.data?.paymentTermId ?? undefined,
    shipToCustomerLocationId: shipsToItself
      ? (shipping.data?.shippingCustomerLocationId ?? undefined)
      : undefined
  };
}

/** The invoicing terms a Draft takes when its customer changes: the new
 *  customer's `contractInvoicingDefaults`, every one of them — the old
 *  customer's bill-to, contact, addresses and payment terms would be wrong,
 *  so a default the new customer lacks is cleared, not kept. Null when the
 *  customer did not change. Shared by setup step 1 and the properties
 *  panel, so both replace the same set. */
export async function contractCustomerChange(
  client: SupabaseClient<Database>,
  companyId: string,
  change: { from: string | null; to: string | null }
): Promise<Awaited<ReturnType<typeof contractInvoicingDefaults>> | null> {
  if (!change.to || change.to === change.from) return null;
  return contractInvoicingDefaults(client, companyId, change.to);
}

/** Confirm, schedule edits, amend, cancel and revert — the
 *  `post-customer-contract` server function, run as the signed-in user so
 *  its permission check applies. Never throws: `{ data, error }`. */
export function runContractAction(
  caller: {
    client: SupabaseClient<Database>;
    db: Kysely<KyselyDatabase>;
    companyId: string;
    userId: string;
  },
  input: z.input<typeof postCustomerContractInput>
) {
  return invokePosting(
    caller,
    "post-customer-contract",
    input,
    postCustomerContract,
    { as: postCustomerContractPermission }
  );
}

type SalesOrderStatus = Database["public"]["Enums"]["salesOrderStatus"];

/** The statuses the invoiced/shipped rollup sets. A Draft or unconfirmed
 *  order gets its status at Confirm (which derives it from the lines), and a
 *  Cancelled or Closed one keeps its own. */
const ROLLUP_ORDER_STATUSES: SalesOrderStatus[] = [
  "To Ship and Invoice",
  "To Ship",
  "To Invoice",
  "Completed"
];

/** The order status the lines imply — the rollup in `post-sales-invoice`
 *  (copied, not imported: that file is a server function). Service lines are
 *  never shipped, so they never hold shipping open. */
function salesOrderStatusFromLines(
  lines: {
    salesOrderLineType: Database["public"]["Enums"]["salesOrderLineType"];
    invoicedComplete: boolean;
    sentComplete: boolean;
  }[]
): { status: SalesOrderStatus; allInvoiced: boolean } {
  const allInvoiced = lines.every(
    (line) => line.salesOrderLineType === "Comment" || line.invoicedComplete
  );
  const allShipped = lines.every(
    (line) =>
      line.salesOrderLineType === "Comment" ||
      line.salesOrderLineType === "Service" ||
      line.sentComplete
  );

  let status: SalesOrderStatus = "To Ship and Invoice";
  if (allInvoiced && allShipped) {
    status = "Completed";
  } else if (allInvoiced) {
    status = "To Ship";
  } else if (allShipped) {
    status = "To Invoice";
  }
  return { status, allInvoiced };
}

/**
 * Creates a Draft contract from a sales order's Service lines (decision 7).
 * The lines taken are marked `invoicedComplete`, so `convert` never invoices
 * them and the order's rollup counts them as invoiced; when that leaves every
 * line invoiced, the order's status is recomputed. Deleting the Draft
 * contract, or one of its lines, releases them
 * (`deleteContractReleasingSalesOrderLines`). Returns the contract's id.
 */
export async function createContractFromSalesOrder(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    /** `YYYY-MM-DD` in the company's timezone: the close date. */
    asOf: string;
    input: z.infer<typeof createContractFromSalesOrderValidator>;
  }
): Promise<string> {
  const { companyId, userId, asOf, input } = args;

  // Drawn before the transaction, as the contract form's route does: a
  // refusal below costs a number, but the sequence row is not held locked
  // while the order is.
  const customerContractId = await db
    .transaction()
    .execute((trx) => getNextSequence(trx, "customerContract", companyId));

  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("salesOrder")
      .select([
        "id",
        "salesOrderId",
        "status",
        "customerId",
        "customerReference",
        "salesPersonId",
        "currencyCode",
        "exchangeRate"
      ])
      .where("id", "=", input.salesOrderId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Sales order not found");
    if (order.status === "Cancelled" || order.status === "Closed") {
      throw new Error(
        `Cannot create a contract from a ${order.status.toLowerCase()} sales order`
      );
    }

    // Payment terms and the invoice party live on the order's payment row.
    const payment = await trx
      .selectFrom("salesOrderPayment")
      .select([
        "paymentTermId",
        "invoiceCustomerId",
        "invoiceCustomerContactId",
        "invoiceCustomerLocationId"
      ])
      .where("id", "=", order.id)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    // Every line is locked, not only the chosen ones: the status rollup
    // below reads them all.
    const orderLines = await trx
      .selectFrom("salesOrderLine")
      .select([
        "id",
        "salesOrderLineType",
        "itemId",
        "description",
        "saleQuantity",
        "unitPrice",
        "convertedUnitPrice",
        "taxPercent",
        "invoicedComplete",
        "quantityInvoiced",
        "sentComplete"
      ])
      .where("salesOrderId", "=", order.id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .execute();
    const orderLineById = new Map(orderLines.map((line) => [line.id, line]));

    const chosenIds = new Set(input.lines.map((line) => line.salesOrderLineId));
    if (chosenIds.size !== input.lines.length) {
      throw new Error("A sales order line was chosen more than once");
    }

    const chosen = input.lines.map((choice) => {
      const line = orderLineById.get(choice.salesOrderLineId);
      if (!line) throw new Error("A chosen line is not on this sales order");
      if (line.salesOrderLineType !== "Service" || !line.itemId) {
        throw new Error("Only Service lines can move to a contract");
      }
      if (line.invoicedComplete || Number(line.quantityInvoiced ?? 0) > 0) {
        throw new Error(
          "A line that is already invoiced cannot move to a contract"
        );
      }
      const quantity = Number(line.saleQuantity ?? 0);
      if (quantity <= 0) {
        throw new Error("A line with no quantity cannot move to a contract");
      }
      // A contract line's rate is in the contract's currency, which is the
      // order's: `unitPrice` is base, `convertedUnitPrice` (unitPrice ×
      // exchangeRate) is what the customer was quoted.
      const rate = round(
        Number(line.convertedUnitPrice ?? line.unitPrice ?? 0)
      );
      if (rate < 0) {
        throw new Error(
          "A line with a negative price cannot move to a contract"
        );
      }
      return { choice, line, itemId: line.itemId, quantity, rate };
    });

    const previousContracts = await trx
      .selectFrom("customerContract")
      .select("status")
      .where("companyId", "=", companyId)
      .where("customerId", "=", order.customerId)
      .execute();

    const { endDate, termMonths } = contractEndDate(
      input.startDate,
      input.duration,
      input.endDate
    );

    const contract = await trx
      .insertInto("customerContract")
      .values({
        companyId,
        customerContractId,
        name: input.name,
        contractType: suggestContractType(previousContracts),
        customerId: order.customerId,
        invoiceCustomerId: payment?.invoiceCustomerId ?? null,
        invoiceCustomerContactId: payment?.invoiceCustomerContactId ?? null,
        invoiceCustomerLocationId: payment?.invoiceCustomerLocationId ?? null,
        salesPersonId: order.salesPersonId,
        salesOrderId: order.id,
        customerReference: order.customerReference,
        closeDate: asOf,
        startDate: input.startDate,
        endDate,
        termMonths,
        billingFrequency: input.billingFrequency,
        billingAlignment: input.billingAlignment,
        billingTiming: input.billingTiming,
        paymentTermId: payment?.paymentTermId ?? null,
        currencyCode: order.currencyCode,
        exchangeRate: order.exchangeRate ?? 1,
        createdBy: userId
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("customerContractLine")
      .values(
        chosen.map(({ choice, line, itemId, quantity, rate }) => ({
          companyId,
          customerContractId: contract.id,
          revenueType: choice.revenueType,
          itemId,
          description: line.description,
          quantity,
          rate,
          rateUnit:
            choice.revenueType === "Recurring"
              ? (choice.rateUnit ?? null)
              : null,
          taxPercent: line.taxPercent,
          startDate: input.startDate,
          salesOrderLineId: line.id,
          createdBy: userId
        }))
      )
      .execute();

    await trx
      .updateTable("salesOrderLine")
      .set({
        invoicedComplete: true,
        updatedBy: userId,
        updatedAt: sql`now()`
      })
      .where("companyId", "=", companyId)
      .where("id", "in", [...chosenIds])
      .execute();

    const { status, allInvoiced } = salesOrderStatusFromLines(
      orderLines.map((line) => ({
        ...line,
        invoicedComplete: line.invoicedComplete || chosenIds.has(line.id)
      }))
    );
    if (allInvoiced && ROLLUP_ORDER_STATUSES.includes(order.status)) {
      await trx
        .updateTable("salesOrder")
        .set({ status, updatedBy: userId, updatedAt: sql`now()` })
        .where("id", "=", order.id)
        .where("companyId", "=", companyId)
        .execute();
    }

    return contract.id;
  });
}

/**
 * Hands sales-order lines back to their order when the Draft contract (or
 * contract line) that took them is deleted: `invoicedComplete` goes back to
 * false where the line is not fully invoiced, and an order the rollup had
 * settled is recomputed from its lines. Runs inside the delete's transaction.
 */
async function releaseContractSalesOrderLines(
  trx: KyselyTx,
  args: { companyId: string; userId: string; salesOrderLineIds: string[] }
): Promise<void> {
  const { companyId, userId, salesOrderLineIds } = args;
  if (salesOrderLineIds.length === 0) return;

  const released = await trx
    .updateTable("salesOrderLine")
    .set({
      invoicedComplete: false,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where("id", "in", salesOrderLineIds)
    .where("invoicedComplete", "=", true)
    .where(
      sql<boolean>`coalesce("quantityInvoiced", 0) < coalesce("saleQuantity", 0)`
    )
    .returning("salesOrderId")
    .execute();

  const salesOrderIds = [...new Set(released.map((line) => line.salesOrderId))];
  if (salesOrderIds.length === 0) return;

  const orders = await trx
    .selectFrom("salesOrder")
    .select(["id", "status"])
    .where("companyId", "=", companyId)
    .where("id", "in", salesOrderIds)
    .forUpdate()
    .execute();
  const orderLines = await trx
    .selectFrom("salesOrderLine")
    .select([
      "salesOrderId",
      "salesOrderLineType",
      "invoicedComplete",
      "sentComplete"
    ])
    .where("companyId", "=", companyId)
    .where("salesOrderId", "in", salesOrderIds)
    .execute();

  // Each order's new status, grouped so one UPDATE per status covers them
  // (at most one per rollup status, however many orders).
  const orderIdsByStatus = new Map<SalesOrderStatus, string[]>();
  for (const order of orders) {
    if (!ROLLUP_ORDER_STATUSES.includes(order.status)) continue;
    const { status } = salesOrderStatusFromLines(
      orderLines.filter((line) => line.salesOrderId === order.id)
    );
    if (status === order.status) continue;
    orderIdsByStatus.set(status, [
      ...(orderIdsByStatus.get(status) ?? []),
      order.id
    ]);
  }

  for (const [status, ids] of orderIdsByStatus) {
    await trx
      .updateTable("salesOrder")
      .set({ status, updatedBy: userId, updatedAt: sql`now()` })
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute();
  }
}

/** Locks a contract and refuses one that is missing or not a Draft. */
async function lockDraftContract(
  trx: KyselyTx,
  args: { companyId: string; customerContractId: string; refusal: string }
): Promise<void> {
  const contract = await trx
    .selectFrom("customerContract")
    .select("status")
    .where("id", "=", args.customerContractId)
    .where("companyId", "=", args.companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!contract) throw new Error("Contract not found");
  if (contract.status !== "Draft") throw new Error(args.refusal);
}

/**
 * Deletes a Draft contract and, in the same transaction, hands the
 * sales-order lines it took back to their order (decision 7) so they can be
 * invoiced again. Throws on a missing or non-Draft contract.
 */
export async function deleteContractReleasingSalesOrderLines(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; userId: string; id: string }
): Promise<void> {
  const { companyId, userId, id } = args;
  await db.transaction().execute(async (trx) => {
    await lockDraftContract(trx, {
      companyId,
      customerContractId: id,
      refusal: "Only a Draft contract can be deleted. Cancel it instead."
    });

    const lines = await trx
      .selectFrom("customerContractLine")
      .select("salesOrderLineId")
      .where("customerContractId", "=", id)
      .where("companyId", "=", companyId)
      .where("salesOrderLineId", "is not", null)
      .execute();
    await releaseContractSalesOrderLines(trx, {
      companyId,
      userId,
      salesOrderLineIds: lines.flatMap((line) =>
        line.salesOrderLineId ? [line.salesOrderLineId] : []
      )
    });

    await trx
      .deleteFrom("customerContract")
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Draft")
      .execute();
  });
}

/** One line of a Draft contract, handing its sales-order line back to the
 *  order (see `deleteContractReleasingSalesOrderLines`). The line must belong
 *  to `customerContractId`; throws otherwise. */
export async function deleteContractLineReleasingSalesOrderLine(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    customerContractId: string;
    customerContractLineId: string;
  }
): Promise<void> {
  const { companyId, userId, customerContractId, customerContractLineId } =
    args;
  await db.transaction().execute(async (trx) => {
    await lockDraftContract(trx, {
      companyId,
      customerContractId,
      refusal: "Lines can only be removed from a Draft contract — use Amend"
    });

    const line = await trx
      .selectFrom("customerContractLine")
      .select(["customerContractId", "salesOrderLineId"])
      .where("id", "=", customerContractLineId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!line || line.customerContractId !== customerContractId) {
      throw new Error("This line does not belong to this contract");
    }

    await releaseContractSalesOrderLines(trx, {
      companyId,
      userId,
      salesOrderLineIds: line.salesOrderLineId ? [line.salesOrderLineId] : []
    });

    await trx
      .deleteFrom("customerContractLine")
      .where("id", "=", customerContractLineId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

/** Where a Draft contract opens: its setup wizard, for anyone who can edit
 *  it (the wizard needs `update: sales`). Null for a confirmed contract, or
 *  for a viewer who cannot edit — they get the contract page. */
export async function draftContractSetupPath(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string; id: string }
): Promise<string | null> {
  const { companyId, userId, id } = args;
  const [contract, claims] = await Promise.all([
    client
      .from("customerContract")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle(),
    getUserClaims(userId, companyId)
  ]);
  if (contract.data?.status !== "Draft") return null;
  if (!hasPermission(claims?.permissions, "sales", "update", companyId)) {
    return null;
  }
  return path.to.contractSetup(id, "products");
}

/** Where a Draft rental agreement opens: its setup wizard, for anyone who
 *  can edit it (the wizard needs `update: sales`). Null for an activated
 *  agreement, or for a viewer who cannot edit — they get the agreement page. */
export async function draftRentalAgreementSetupPath(
  client: SupabaseClient<Database>,
  args: { companyId: string; userId: string; id: string }
): Promise<string | null> {
  const { companyId, userId, id } = args;
  const [agreement, claims] = await Promise.all([
    client
      .from("rentalAgreement")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle(),
    getUserClaims(userId, companyId)
  ]);
  if (agreement.data?.status !== "Draft") return null;
  if (!hasPermission(claims?.permissions, "sales", "update", companyId)) {
    return null;
  }
  return path.to.rentalAgreementSetup(id, "units");
}

/**
 * One field set on several records, as a Properties panel posts it: `ids`
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

/**
 * The sales-rule gate a whole document passes before it moves on (quote
 * finalize and convert, RFQ convert, order confirm). Every line is
 * re-evaluated with the service role: lines arrive from paths the per-line
 * check never saw, and a rule may have been authored since.
 *
 * `blocked` is set when an error fired, or a warning that was not
 * acknowledged; that attempt is recorded (except for an RFQ, which the
 * acknowledgment table cannot name). A failed evaluation blocks too, with
 * its message as the one violation. Otherwise `check` holds the warnings the
 * caller records as acknowledged once the transition commits.
 */
export async function salesDocumentGate(
  ctx: ServiceContext,
  args: {
    documentType: "quote" | "salesOrder" | "salesRfq";
    documentId: string;
    acknowledged: boolean;
    /** Only these lines are checked (a violation naming no line always is). */
    lineIds?: Set<string>;
  }
): Promise<{ blocked: SalesRuleCheck | null; check: SalesRuleCheck }> {
  const { documentType, documentId, acknowledged, lineIds } = args;
  let found: SalesRuleCheck;
  try {
    found = await evaluateSalesRulesForSalesDocument({
      client: ctx.asSystem.supabase,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      documentType,
      documentId
    });
  } catch (err) {
    // Fail closed, but as the modal's message rather than a raw error.
    const blocked = {
      violations: [
        {
          ruleId: "__evaluation-error__",
          severity: "error" as const,
          message:
            err instanceof Error ? err.message : "Sales rule evaluation failed"
        }
      ],
      ruleNames: {}
    };
    return { blocked, check: blocked };
  }

  const check = {
    violations: dedupeViolations(found.violations).filter(
      (v) => !lineIds || !v.lineId || lineIds.has(v.lineId)
    ),
    ruleNames: found.ruleNames
  };
  if (
    check.violations.length === 0 ||
    !isBlocked(check.violations, acknowledged)
  ) {
    return { blocked: null, check };
  }
  if (documentType !== "salesRfq") {
    await recordSalesRuleOutcome(ctx.asSystem.supabase, {
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      documentType,
      documentId,
      outcome: "blocked",
      ...check
    });
  }
  return { blocked: check, check };
}

/**
 * Move a file dropped on a quote or RFQ line into place. A 3D model gets its
 * raw file in the staging bucket the optimise job reads, then a `modelUpload`
 * row (linked to the line through `setModel`); inserting the row starts the
 * optimise. Any other file moves under `documentFolder`.
 */
export async function placeDroppedFile(
  ctx: ServiceContext,
  args: {
    documentPath: string;
    is3DModel?: boolean;
    size?: number;
    documentFolder: string;
    setModel: (
      modelUploadId: string
    ) => PromiseLike<{ error: { message: string } | null }>;
    lineName: string;
  }
): Promise<CarbonError | null> {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const fileName = args.documentPath.split("/").pop();

  if (!args.is3DModel) {
    const move = await storage(client)
      .company(companyId)
      .move(
        args.documentPath,
        `${companyId}/${args.documentFolder}/${fileName}`
      );
    return move.error
      ? ctx.error("internal", "Failed to move file", move.error)
      : null;
  }

  const modelId = nanoid();
  const newPath = `${companyId}/models/${modelId}.${fileName?.split(".").pop()}`;

  // Attachments live in the company bucket, raw models in `temp-staging`
  // (2.5 GB) for the optimise and assembly jobs; storage has no cross-bucket
  // move. Staged BEFORE the row: inserting it starts the optimise, which
  // reads the file.
  const raw = await storage(client)
    .company(companyId)
    .download(args.documentPath);
  if (!raw.data) {
    return ctx.error("internal", "Failed to read model file", raw.error);
  }
  const staged = await client.storage
    .from(TEMP_STAGING_BUCKET)
    .upload(newPath, raw.data, { upsert: true });
  if (staged.error) {
    return ctx.error("internal", "Failed to stage model file", staged.error);
  }

  const recordCreate = await client.from("modelUpload").insert({
    id: modelId,
    modelPath: newPath,
    name: fileName!,
    size: args.size ?? 0,
    companyId,
    createdBy: ctx.auditUserId
  });
  if (recordCreate.error) {
    return ctx.error(
      "internal",
      "Failed to insert model record",
      recordCreate.error
    );
  }
  const recordUpdate = await args.setModel(modelId);
  if (recordUpdate.error) {
    return ctx.error(
      "internal",
      `Failed to update ${args.lineName} with model`,
      recordUpdate.error
    );
  }

  await storage(client).company(companyId).remove([args.documentPath]);
  return null;
}

// --- Documents (PDF) --------------------------------------------------------

/**
 * Store a rendered sales document PDF in the company bucket under `folder`
 * and record it as a document of its source, readable by the user who
 * issued it.
 */
export async function attachDocumentPdf(
  ctx: ServiceContext,
  args: {
    pdf: Response;
    identifier: string;
    folder: string;
    sourceDocument: "Quote" | "Sales Order" | "Sales Return Order";
    sourceDocumentId: string;
  }
): Promise<
  | { file: ArrayBuffer; fileName: string; documentFilePath: string }
  | CarbonError
> {
  if (args.pdf.headers.get("content-type") !== "application/pdf") {
    return ctx.error("internal", "Failed to generate PDF");
  }
  const companyId = ctx.company.id;
  const file = await args.pdf.arrayBuffer();
  const fileName = stripSpecialCharacters(
    `${args.identifier} - ${datetime.timestamp().slice(0, -5)}.pdf`
  );
  const documentFilePath = `${companyId}/${args.folder}/${fileName}`;

  const upload = await storage(ctx.asSystem.supabase)
    .company(companyId)
    .upload(documentFilePath, file, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });
  if (upload.error) {
    return ctx.error(
      "internal",
      "Failed to upload PDF to storage",
      upload.error
    );
  }

  const document = await upsertDocument(ctx.asSystem.supabase, {
    path: documentFilePath,
    name: fileName,
    size: Math.round(file.byteLength / 1024),
    sourceDocument: args.sourceDocument,
    sourceDocumentId: args.sourceDocumentId,
    readGroups: [ctx.auditUserId],
    writeGroups: [ctx.auditUserId],
    createdBy: ctx.auditUserId,
    companyId
  });
  if (document.error) {
    return ctx.error(
      "internal",
      "Failed to create document record",
      document.error
    );
  }
  return { file, fileName, documentFilePath };
}

/** Render a sales order's PDF and attach it to its opportunity. */
export async function attachSalesOrderPdf(
  ctx: ServiceContext,
  args: { salesOrderId: string; locale: string }
) {
  const order = await getSalesOrder(ctx.asSystem.supabase, args.salesOrderId);
  if (!order.data?.salesOrderId || !order.data.opportunityId) {
    return ctx.error("internal", "Failed to get sales order", order.error);
  }
  return attachDocumentPdf(ctx, {
    pdf: await renderSalesOrderPdf(ctx.asCaller.supabase, {
      id: args.salesOrderId,
      companyId: ctx.company.id,
      companyGroupId: ctx.company.groupId,
      locale: args.locale
    }),
    identifier: order.data.salesOrderId,
    folder: `opportunity/${order.data.opportunityId}`,
    sourceDocument: "Sales Order",
    sourceDocumentId: args.salesOrderId
  });
}

export const quoteLocked = "Cannot modify a locked quote. Reopen it first.";

/**
 * Check one quote or sales order line against the sales rules before it is
 * written. Every quantity break is evaluated: a minimum fires on the smallest,
 * a maximum on the largest. A blocked attempt is recorded; `lineId` is null
 * for a line not created yet.
 */
export async function salesLineGate(
  ctx: ServiceContext,
  args: {
    surface: "quoteLine" | "salesOrderLine";
    documentType: "quote" | "salesOrder";
    documentId: string;
    lineId: string | null;
    itemId: string | null;
    quantities: number[];
    customerId: string | null;
    customerLocationId: string | null;
    acknowledged: boolean;
  }
): Promise<{ blocked: SalesRuleCheck | null; check: SalesRuleCheck }> {
  const found = await evaluateSalesRuleLines({
    client: ctx.asSystem.supabase,
    companyId: ctx.company.id,
    userId: ctx.auditUserId,
    surface: args.surface,
    lines: args.quantities.map((quantity) => ({
      lineId: args.lineId ?? "new",
      itemId: args.itemId,
      quantity
    })),
    customerId: args.customerId,
    customerLocationId: args.customerLocationId
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
  await recordSalesLineOutcome(ctx, args, "blocked", check);
  return { blocked: check, check };
}

/** Record a line check's outcome against the line it is about. */
export function recordSalesLineOutcome(
  ctx: ServiceContext,
  line: {
    documentType: "quote" | "salesOrder";
    documentId: string;
    lineId: string | null;
    itemId: string | null;
  },
  outcome: "blocked" | "acknowledged",
  check: SalesRuleCheck
) {
  return recordSalesRuleOutcome(ctx.asSystem.supabase, {
    companyId: ctx.company.id,
    userId: ctx.auditUserId,
    documentType: line.documentType,
    documentId: line.documentId,
    documentLineId: line.lineId,
    itemId: line.itemId,
    outcome,
    ...check
  });
}

/** The configuration a line form posts as JSON text; unreadable means none. */
export function parseConfiguration(
  value: unknown
): Record<string, unknown> | undefined {
  if (typeof value !== "string") {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    logger.error("Failed to parse quote line configuration", { error });
    return undefined;
  }
}

/** A Draft quote this company owns, or why it cannot be changed. */
export async function unlockedQuote(ctx: ServiceContext, quoteId: string) {
  const refused = await refuseUnlessOwned(ctx, "quote", { id: quoteId });
  if (refused) return refused;
  // The caller may hold the write permission without sales_view, which RLS
  // needs to read the quote; an unread status would pass as unlocked.
  const quote = await getQuote(ctx.asSystem.supabase, quoteId);
  if (quote.error || !quote.data) {
    return ctx.error("internal", "Failed to load quote", quote.error);
  }
  if (isQuoteLocked(quote.data.status)) return ctx.error("rule", quoteLocked);
  return quote.data;
}

/** Price a just-created quote line by its method; a failure is the message. */
export async function priceNewQuoteLine(
  ctx: ServiceContext,
  args: {
    quoteId: string;
    quoteLineId: string;
    itemId: string;
    methodType: z.infer<typeof quoteLineValidator>["methodType"];
    quantities: number[];
    configuration?: Record<string, unknown>;
  }
): Promise<string | null> {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const { quoteId, quoteLineId, quantities } = args;

  if (args.methodType === "Purchase to Order") {
    const priced = await resolvePurchaseToOrderPrices(
      serviceRole,
      companyId,
      quoteId,
      quoteLineId,
      quantities,
      userId
    );
    return priced?.error ? "Failed to resolve Purchase to Order prices" : null;
  }
  if (args.methodType === "Pull from Inventory") {
    const priced = await resolveQuoteLinePrices(
      serviceRole,
      companyId,
      quoteId,
      quoteLineId,
      quantities,
      userId
    );
    return priced?.error
      ? "Failed to resolve Pull from Inventory prices"
      : null;
  }
  if (args.methodType === "Make to Order") {
    const method = await upsertQuoteLineMethod(serviceRole, ctx.asSystem.pg, {
      quoteId,
      quoteLineId,
      itemId: args.itemId,
      configuration: args.configuration,
      companyId,
      userId
    });
    if (method.error) return "Failed to create quote line method.";
    const priced = await recalculateQuoteLinePrices(
      serviceRole,
      ctx.asSystem.pg,
      companyId,
      quoteId,
      quoteLineId,
      userId
    );
    return priced?.error ? "Failed to recalculate quote line prices" : null;
  }
  return null;
}

/** Email a finalized quote's PDF to its customer contact. Throws on failure. */
export async function emailQuote(
  ctx: ServiceContext,
  args: {
    quote: NonNullable<Awaited<ReturnType<typeof getQuote>>["data"]>;
    customerContactId: string;
    cc?: string[];
    fileName: string;
    documentFilePath: string;
  }
) {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const [company, companySettings, customer, customerContact, user] =
    await Promise.all([
      getCompany(serviceRole, companyId),
      getCompanySettings(serviceRole, companyId),
      getCustomer(serviceRole, args.quote.customerId!),
      getCustomerContact(serviceRole, args.customerContactId, companyId),
      getUser(serviceRole, ctx.auditUserId)
    ]);
  if (!company.data) throw new Error("Failed to get company");
  if (!companySettings.data) throw new Error("Failed to get company settings");
  if (!customer.data) throw new Error("Failed to get customer");
  if (!customerContact.data) throw new Error("Failed to get customer contact");
  if (!user.data) throw new Error("Failed to get user");

  const emailTemplate = QuoteEmail({
    // @ts-expect-error TS2739 - TODO: fix type
    company: company.data,
    companySettings: companySettings.data,
    // @ts-expect-error
    quote: args.quote,
    recipient: {
      email: customerContact.data.contact!.email!,
      firstName: customerContact.data.contact!.firstName!,
      lastName: customerContact.data.contact!.lastName!
    },
    sender: {
      email: user.data.email,
      firstName: user.data.firstName,
      lastName: user.data.lastName
    }
  });
  const html = await render(emailTemplate);
  const text = await render(emailTemplate, { plainText: true });
  const signed = await storage(serviceRole)
    .company(companyId)
    .createSignedUrl(args.documentFilePath, 3600);
  if (signed.error) {
    logger.error("Failed to create signed URL for attachment", {
      storagePath: args.documentFilePath,
      error: signed.error
    });
  }

  await trigger("send-email", {
    document: true,
    to: [user.data.email, customerContact.data.contact!.email!],
    cc: args.cc?.length ? args.cc : undefined,
    from: user.data.email,
    subject: `Quote ${getQuoteDisplayId(args.quote)}`,
    html,
    text,
    attachments: signed.data
      ? [{ path: signed.data.signedUrl, filename: args.fileName }]
      : undefined,
    companyId
  });
}

/** The quote lines `selectedLines` converts: those ordered in a quantity. */
export function convertingLineIds(
  selectedLines: z.infer<typeof selectedLinesValidator>
): Set<string> {
  return new Set(
    Object.entries(selectedLines)
      .filter(([, line]) => (line.quantity ?? 0) > 0)
      .map(([lineId]) => lineId)
  );
}

/** A Make to Order part and a quote line for a file dropped on the quote. */
export async function createQuoteLineForFile(
  ctx: ServiceContext,
  { quoteId, fileName }: { quoteId: string; fileName: string }
): Promise<{ lineId: string; partId: string } | CarbonError> {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const partName = fileName.replace(/\.[^/.]+$/, "");

  let readableId = partName;
  let revision = "0";
  try {
    const { output } = await generateText({
      model: openai("gpt-4o-mini"),
      output: Output.object({
        schema: z.object({
          partId: z
            .string()
            .describe("The part identifier extracted from the filename"),
          revision: z
            .string()
            .nullable()
            .describe("The revision number if present, null if not found")
        })
      }),
      prompt: `Extract the part ID and revision from this filename: "${partName}". The part ID should be the main identifier, and revision should be any version/revision indicator if present.`
    });
    readableId = output.partId;
    revision = output.revision || "0";
  } catch (error) {
    logger.error("Failed to parse part filename", { error });
  }

  // A revision that exists already gets a suffix.
  const existing = await serviceRole
    .from("item")
    .select("revision")
    .eq("readableId", readableId)
    .eq("companyId", companyId);
  const taken = new Set((existing.data ?? []).map((item) => item.revision));
  const base = revision;
  for (let suffix = 1; taken.has(revision); suffix++) {
    revision = `${base} (${suffix})`;
  }

  const part = await upsertPart(serviceRole, {
    id: readableId,
    name: readableId,
    defaultMethodType: "Make to Order",
    itemTrackingType: "Inventory",
    replenishmentSystem: "Make",
    revision,
    unitOfMeasureCode: "EA",
    shelfLifeCalculateFromBom: false,
    companyId,
    createdBy: userId
  });
  if (part.error || !part.data?.id) {
    return ctx.error("internal", "Failed to create part", part.error);
  }
  const partId = part.data.id;

  const line = await upsertQuoteLine(serviceRole, {
    quoteId,
    itemId: partId,
    status: "Not Started",
    estimatorId: userId,
    description: partName,
    methodType: "Make to Order",
    customerPartId: partName,
    customerPartRevision: "",
    unitOfMeasureCode: "EA",
    taxPercent: 0,
    quantity: [1],
    companyId,
    createdBy: userId
  });
  if (line.error || !line.data) {
    return ctx.error("internal", "Failed to create quote line.", line.error);
  }

  const method = await upsertQuoteLineMethod(serviceRole, ctx.asSystem.pg, {
    quoteId,
    quoteLineId: line.data.id,
    itemId: partId,
    configuration: undefined,
    companyId,
    userId
  });
  if (method.error) {
    return ctx.error(
      "internal",
      "Failed to create quote line method.",
      method.error
    );
  }
  return { lineId: line.data.id, partId };
}

// --- Digital quotes (the customer's share link) ------------------------------

const digitalQuoteClosed = "This quote is no longer available for a response.";

/** The quote a share link answers, while it still awaits a response. */
export async function sentQuote(ctx: ServiceContext, quoteId: string) {
  const quote = await ctx.asSystem.supabase
    .from("quote")
    .select("*")
    .eq("id", quoteId)
    .eq("companyId", ctx.company.id)
    .single();
  if (quote.error) return ctx.error("notFound", "Quote not found", quote.error);
  // Without this a replayed link creates duplicate orders, or flips an
  // ordered quote back to Lost.
  if (quote.data.status !== "Sent")
    return ctx.error("rule", digitalQuoteClosed);
  return quote.data;
}

/**
 * Tell the company's digital quote group that the customer answered. Best
 * effort: the customer's accept or reject is already saved, so a failure here
 * is logged and never returned to them.
 */
export async function notifyDigitalQuoteResponse(
  ctx: ServiceContext,
  quoteId: string
): Promise<void> {
  const settings = await getCompanySettings(
    ctx.asSystem.supabase,
    ctx.company.id
  );
  if (settings.error) {
    logger.error("Failed to read the digital quote notification group", {
      companyId: ctx.company.id,
      quoteId,
      error: settings.error
    });
    return;
  }
  const groupIds = settings.data?.digitalQuoteNotificationGroup ?? [];
  if (groupIds.length === 0) return;
  try {
    await trigger("notify", {
      companyId: ctx.company.id,
      documentId: quoteId,
      event: NotificationEvent.DigitalQuoteResponse,
      recipient: { type: "group", groupIds }
    });
  } catch (error) {
    logger.error("Failed to notify the digital quote group", {
      companyId: ctx.company.id,
      quoteId,
      error
    });
  }
}

export async function advancingStatusRefusal(
  ctx: ServiceContext,
  documentType: "quote" | "salesOrder",
  documentId: string
): Promise<CarbonError | null> {
  const gate = await salesDocumentGate(ctx, {
    documentType,
    documentId,
    acknowledged: true
  });
  if (!gate.blocked) return null;
  const errors = gate.blocked.violations.filter((v) => v.severity === "error");
  return ctx.error(
    "rule",
    errors.map((v) => v.message).join("; ") || "A sales rule blocks this status"
  );
}

/** A sales order line keeps only the target its type uses. */
export function withLineTarget<
  L extends {
    salesOrderLineType: string;
    accountId?: string;
    assetId?: string;
    itemId?: string;
  }
>(line: L): L {
  if (line.salesOrderLineType === "Comment") {
    return {
      ...line,
      accountId: undefined,
      assetId: undefined,
      itemId: undefined
    };
  }
  if (line.salesOrderLineType === "Fixed Asset") {
    return { ...line, accountId: undefined, itemId: undefined };
  }
  return { ...line, accountId: undefined, assetId: undefined };
}

/** An unlocked sales order this company owns, or why it cannot be changed. */
export async function unlockedSalesOrder(
  ctx: ServiceContext,
  salesOrderId: string,
  message: string
) {
  const refused = await refuseUnlessOwned(ctx, "salesOrder", {
    id: salesOrderId
  });
  if (refused) return refused;
  // Read as the system: an unread status would pass as unlocked.
  const order = await getSalesOrder(ctx.asSystem.supabase, salesOrderId);
  if (order.error || !order.data) {
    return ctx.error("internal", "Failed to load sales order", order.error);
  }
  if (isSalesOrderLocked(order.data.status)) return ctx.error("rule", message);
  return null;
}

/**
 * Check a sales order line's item against the sales rules, at the order's
 * ship-to (the drop-ship location for a drop shipment). A line with no item
 * (a comment, a fixed asset) is not checked.
 */
export async function salesOrderLineGate(
  ctx: ServiceContext,
  args: {
    salesOrderId: string;
    lineId: string | null;
    itemId?: string;
    quantity?: number;
    acknowledged: boolean;
  }
) {
  if (!args.itemId) {
    return { blocked: null, check: { violations: [], ruleNames: {} } };
  }
  const shipTo = await resolveSalesOrderShipTo(
    ctx.asSystem.supabase,
    args.salesOrderId,
    ctx.company.id
  );
  return salesLineGate(ctx, {
    surface: "salesOrderLine",
    documentType: "salesOrder",
    documentId: args.salesOrderId,
    lineId: args.lineId,
    itemId: args.itemId,
    quantities: [args.quantity ?? 1],
    customerId: shipTo.customerId,
    customerLocationId: shipTo.customerLocationId,
    acknowledged: args.acknowledged
  });
}

/**
 * A return line's goods still On Hold: its expected serials and batches,
 * plus entities received blind against the line's receipt lines.
 */
export async function returnedOnHoldEntityIds(
  ctx: ServiceContext,
  { id, lineId }: { id: string; lineId: string }
): Promise<string[]> {
  const client = ctx.asCaller.supabase;
  const companyId = ctx.company.id;
  const linked = await getSalesReturnOrderLineTrackedEntities(client, [lineId]);
  const ids = (linked.data ?? [])
    .filter((row) => row.trackedEntity?.status === "On Hold")
    .map((row) => row.trackedEntityId);

  const receipts = await client
    .from("receipt")
    .select("id")
    .eq("sourceDocument", "Sales Return Order")
    .eq("sourceDocumentId", id)
    .eq("companyId", companyId);
  const receiptIds = (receipts.data ?? []).map((receipt) => receipt.id);
  if (receiptIds.length > 0) {
    const receiptLines = await client
      .from("receiptLine")
      .select("id")
      .in("receiptId", receiptIds)
      .eq("lineId", lineId)
      .eq("companyId", companyId);
    const receiptLineIds = (receiptLines.data ?? []).map((row) => row.id);
    if (receiptLineIds.length > 0) {
      const blind = await client
        .from("trackedEntity")
        .select("id")
        .eq("companyId", companyId)
        .eq("status", "On Hold")
        .in("attributes ->> Receipt Line", receiptLineIds);
      ids.push(...(blind.data ?? []).map((entity) => entity.id));
    }
  }
  return [...new Set(ids)];
}

/**
 * Link a new Issue to the return line and its returned entities, and set
 * its item to the line's received quantity and disposition with the
 * entities split out (under the lock every disposition writer takes).
 */
export async function linkIssueToReturnLine(
  ctx: ServiceContext,
  args: {
    issueId: string;
    salesReturnOrderId: string;
    rmaReadableId: string;
    lineId: string;
    itemId: string;
    entityIds: string[];
    quantityReceived: number;
    disposition: "Scrap" | "Rework";
  }
): Promise<CarbonError | null> {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const { issueId } = args;

  const lineLink = await serviceRole
    .from("nonConformanceSalesReturnOrderLine")
    .insert({
      nonConformanceId: issueId,
      salesReturnOrderLineId: args.lineId,
      salesReturnOrderId: args.salesReturnOrderId,
      salesReturnOrderReadableId: args.rmaReadableId,
      companyId,
      createdBy: userId
    });
  if (lineLink.error) {
    return ctx.error(
      "internal",
      "Failed to link the Issue to the RMA",
      lineLink.error
    );
  }

  let entityRows: { id: string; quantity: number }[] = [];
  if (args.entityIds.length > 0) {
    const entityLinks = await serviceRole
      .from("nonConformanceTrackedEntity")
      .insert(
        args.entityIds.map((trackedEntityId) => ({
          nonConformanceId: issueId,
          trackedEntityId,
          companyId,
          createdBy: userId
        }))
      );
    if (entityLinks.error) {
      return ctx.error(
        "internal",
        "Failed to link the returned entities to the Issue",
        entityLinks.error
      );
    }
    const quantities = await serviceRole
      .from("trackedEntity")
      .select("id, quantity")
      .in("id", args.entityIds)
      .eq("companyId", companyId);
    if (quantities.error) {
      return ctx.error(
        "internal",
        "Failed to read the returned entities for the Issue",
        quantities.error
      );
    }
    entityRows = quantities.data.map((entity) => ({
      id: entity.id,
      quantity: Number(entity.quantity ?? 1)
    }));
  }

  try {
    // The lock helper takes a Kysely transaction itself.
    await ctx.asSystem.pg.transaction().execute(async (trx) => {
      await lockIssueDispositions(trx, {
        nonConformanceId: issueId,
        companyId
      });
      const itemRow = await trx
        .updateTable("nonConformanceItem")
        .set({
          quantity: args.quantityReceived,
          disposition: args.disposition,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("nonConformanceId", "=", issueId)
        .where("itemId", "=", args.itemId)
        .where("companyId", "=", companyId)
        .returning(["id"])
        .executeTakeFirst();
      if (itemRow && entityRows.length > 0) {
        await trx
          .insertInto("nonConformanceItemTrackedEntity")
          .values(
            entityRows.map((entity) => ({
              nonConformanceItemId: itemRow.id,
              nonConformanceId: issueId,
              trackedEntityId: entity.id,
              quantity: entity.quantity,
              companyId,
              createdBy: userId
            }))
          )
          .execute();
      }
    });
    return null;
  } catch (err) {
    return ctx.error("internal", "Failed to set the Issue's item", err);
  }
}

/** Reprice a quote line after its method changed; a failure is logged. */
export async function repriceQuoteLine(
  ctx: ServiceContext,
  { quoteId, quoteLineId }: { quoteId: string; quoteLineId: string }
) {
  const priced = await recalculateQuoteLinePrices(
    ctx.asSystem.supabase,
    ctx.asSystem.pg,
    ctx.company.id,
    quoteId,
    quoteLineId,
    ctx.auditUserId
  );
  if (priced?.error) {
    logger.error("Failed to recalculate quote line prices", {
      companyId: ctx.company.id,
      quoteLineId,
      error: priced.error
    });
  }
  return priced;
}

/**
 * The quote line, and the make method and operation a method row names,
 * must be this company's and that line's: method rows are written with the
 * service role.
 */
export async function refuseUnlessQuoteMethodRows(
  ctx: ServiceContext,
  args: {
    quoteId: string;
    quoteLineId: string;
    quoteMakeMethodId?: string;
    quoteOperationId?: string;
  }
): Promise<CarbonError | null> {
  const { quoteLineId } = args;
  const refusals = await Promise.all([
    refuseUnlessOwned(ctx, "quoteLine", {
      id: quoteLineId,
      quoteId: args.quoteId
    }),
    args.quoteMakeMethodId
      ? refuseUnlessOwned(ctx, "quoteMakeMethod", {
          id: args.quoteMakeMethodId,
          quoteLineId
        })
      : null,
    args.quoteOperationId
      ? refuseUnlessOwned(ctx, "quoteOperation", {
          id: args.quoteOperationId,
          quoteLineId
        })
      : null
  ]);
  return refusals.find((refusal) => refusal !== null) ?? null;
}

// --- Contracts --------------------------------------------------------------

export const forbidden = (ctx: ServiceContext) =>
  ctx.error("forbidden", "You do not have permission to do this");

/** Today in the company's timezone: the date a contract or rental acts on. */
export async function companyToday(ctx: ServiceContext) {
  return datetime
    .today(
      await getCachedCompanyTimeZone(ctx.asCaller.supabase, ctx.company.id)
    )
    .toString();
}

/** The contract lifecycle server function, run as the caller. */
export function postContract(
  ctx: ServiceContext,
  input: z.input<typeof postCustomerContractInput>
) {
  return runContractAction(
    {
      client: ctx.asCaller.supabase,
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    },
    input
  );
}

// --- Rental agreements ------------------------------------------------------

/** A rental agreement of this company, or why not. */
export async function ownRentalAgreement(ctx: ServiceContext, id: string) {
  const agreement = await getRentalAgreement(
    ctx.asCaller.supabase,
    id,
    ctx.company.id
  );
  if (agreement.error || agreement.data?.companyId !== ctx.company.id) {
    return ctx.error("notFound", "Rental agreement not found", agreement.error);
  }
  return agreement.data;
}
type RateUnit = Database["public"]["Enums"]["rentalRateUnit"];

export type RentalInvoiceGenerationArgs = {
  companyId: string;
  /** `YYYY-MM-DD` in the company's timezone: periods due on or before it, and
   *  charges dated on or before it, are billed. */
  asOf: string;
  /** Bill one agreement only (the agreement page's action). */
  rentalAgreementId?: string;
  userId: string;
};

/** One invoice the generator drafted, and what automation may do with it. */
export type DraftedRentalInvoice = {
  invoiceId: string;
  rentalAgreementId: string;
  /** The agreement's effective invoice automation. */
  mode: InvoiceAutomation;
  /** Set when a person must review the draft before it is posted. */
  holdReason: string | null;
};

/** The credit memo an agreement's early-return adjustments were drafted on.
 *  It stays Draft: a person posts it, as early-return credits were always
 *  reviewed before they reached the customer. */
export type DraftedRentalCreditMemo = {
  memoId: string;
  rentalAgreementId: string;
};

export type RentalInvoiceGenerationFailure = {
  rentalAgreementId: string;
  error: string;
};

export type RentalInvoiceGenerationResult = {
  invoices: DraftedRentalInvoice[];
  /** `invoices.map(i => i.invoiceId)`. */
  invoiceIds: string[];
  /** Early-return credits, one Draft credit memo per agreement. */
  creditMemos: DraftedRentalCreditMemo[];
  /** Agreements whose transaction rolled back; their rows stay unbilled. */
  failures: RentalInvoiceGenerationFailure[];
};

/**
 * Drafts the sales invoices of every Active agreement that has something due: every
 * Pending billing period with `dueOn <= asOf` and every unbilled charge dated
 * on or before `asOf`. First it rolls every live line's periods forward to
 * `billingHorizon(asOf)` — activation only cuts periods to one cycle ahead,
 * so an open-ended or held-over line gets its next period here. A Closed
 * agreement is billed too while it has Pending periods or unbilled charges —
 * voiding one of its invoices returns its rows to unbilled, and closing
 * required none — but it never rolls forward. Each agreement is its own transaction, so one
 * agreement's failure never rolls back another's invoice. The billed rows are
 * stamped with their invoice line, which is what makes a second call for the
 * same day a no-op; deleting the Draft invoice releases them
 * (the ERP's `releaseRentalInvoiceStamps`). Under invoice automation an agreement's
 * rent and its charges become separate invoices (`planRentalInvoices`).
 */
async function createRentalInvoicesForDuePeriods(
  db: Kysely<KyselyDatabase>,
  args: RentalInvoiceGenerationArgs
): Promise<RentalInvoiceGenerationResult> {
  const { companyId, asOf, rentalAgreementId } = args;

  // One read for every agreement with anything due; the per-agreement
  // transaction below re-reads its own rows under lock.
  let dueQuery = db
    .selectFrom("rentalAgreement as ra")
    .select("ra.id")
    .where("ra.companyId", "=", companyId)
    .where("ra.status", "in", BILLABLE_STATUSES)
    .where((eb) =>
      eb.or([
        // A live line of an Active agreement may need its next period cut
        // before anything is due.
        eb.and([
          eb("ra.status", "=", "Active"),
          eb.exists(
            eb
              .selectFrom("rentalAgreementLine as l")
              .select("l.id")
              .whereRef("l.rentalAgreementId", "=", "ra.id")
              .whereRef("l.companyId", "=", "ra.companyId")
              .where("l.status", "in", ["Pending", "On Rent"])
          )
        ]),
        eb.exists(
          eb
            .selectFrom("rentalBillingPeriod as p")
            .innerJoin("rentalAgreementLine as l", (join) =>
              join
                .onRef("l.id", "=", "p.rentalAgreementLineId")
                .onRef("l.companyId", "=", "p.companyId")
            )
            .select("p.id")
            .whereRef("l.rentalAgreementId", "=", "ra.id")
            .whereRef("l.companyId", "=", "ra.companyId")
            .where("p.status", "=", "Pending")
            .where("p.dueOn", "<=", asOf)
        ),
        eb.exists(
          eb
            .selectFrom("rentalAgreementCharge as c")
            .innerJoin("rentalAgreementLine as l", (join) =>
              join
                .onRef("l.id", "=", "c.rentalAgreementLineId")
                .onRef("l.companyId", "=", "c.companyId")
            )
            .select("c.id")
            .whereRef("l.rentalAgreementId", "=", "ra.id")
            .whereRef("l.companyId", "=", "ra.companyId")
            .where("c.salesInvoiceLineId", "is", null)
            .where("c.chargeDate", "<=", asOf)
        )
      ])
    )
    .orderBy("ra.rentalAgreementId");
  if (rentalAgreementId) {
    dueQuery = dueQuery.where("ra.id", "=", rentalAgreementId);
  }
  const agreements = await dueQuery.execute();

  // One agreement's failure never stops the others: what earlier agreements
  // committed is returned (so automation still runs over it) next to the
  // failures, rather than lost behind a throw.
  const invoices: DraftedRentalInvoice[] = [];
  const creditMemos: DraftedRentalCreditMemo[] = [];
  const failures: RentalInvoiceGenerationFailure[] = [];
  if (agreements.length === 0) {
    return { invoices, invoiceIds: [], creditMemos, failures };
  }

  // The company default every agreement without its own automation follows;
  // one read for the whole run.
  const settings = await db
    .selectFrom("companySettings")
    .select("invoiceAutomation")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();

  for (const agreement of agreements) {
    try {
      const drafted = await db
        .transaction()
        .execute((trx) =>
          draftAgreementInvoices(
            trx,
            args,
            agreement.id,
            settings.invoiceAutomation
          )
        );
      invoices.push(...drafted.invoices);
      creditMemos.push(...drafted.creditMemos);
    } catch (error) {
      failures.push({
        rentalAgreementId: agreement.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return {
    invoices,
    invoiceIds: invoices.map((i) => i.invoiceId),
    creditMemos,
    failures
  };
}

type RentalAgreementRecord = Selectable<KyselyDatabase["rentalAgreement"]>;

/** Statuses with something left to bill: an Active agreement, and a Closed
 *  one whose voided invoice returned rows to unbilled. */
const BILLABLE_STATUSES: Database["public"]["Enums"]["rentalAgreementStatus"][] =
  ["Active", "Closed"];

type LineValues = {
  rentalAgreementLineId: string;
  rentalBillingPeriodId: string | null;
  rentalAgreementChargeId: string | null;
  rentalLineType: Database["public"]["Enums"]["rentalInvoiceLineType"];
  description: string;
  unitPrice: number;
  taxPercent: number;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
};

async function draftAgreementInvoices(
  trx: KyselyTx,
  args: RentalInvoiceGenerationArgs,
  agreementId: string,
  companyInvoiceAutomation: InvoiceAutomation
): Promise<{
  invoices: DraftedRentalInvoice[];
  creditMemos: DraftedRentalCreditMemo[];
}> {
  const { companyId, asOf, userId } = args;
  const nothing = { invoices: [], creditMemos: [] };

  const agreement = await trx
    .selectFrom("rentalAgreement")
    .selectAll()
    .where("id", "=", agreementId)
    .where("companyId", "=", companyId)
    .where("status", "in", BILLABLE_STATUSES)
    .forUpdate()
    .executeTakeFirst();
  if (!agreement) return nothing;

  // Periods and credits are billed in the agreement's currency, at its
  // settlement precision.
  const currency = await trx
    .selectFrom("currency")
    .innerJoin("company", "company.companyGroupId", "currency.companyGroupId")
    .select("currency.decimalPlaces")
    .where("company.id", "=", companyId)
    .where("currency.code", "=", agreement.currencyCode)
    .executeTakeFirst();
  if (!currency || currency.decimalPlaces === null) {
    throw new Error(
      `Currency ${agreement.currencyCode} is not set up for this company`
    );
  }
  const decimals = currency.decimalPlaces;

  const mode = effectiveInvoiceAutomation(
    agreement.invoiceAutomation,
    companyInvoiceAutomation
  );

  // A Closed agreement only bills what a void returned to unbilled; it has
  // no live line to cut a new period for.
  if (agreement.status === "Active") {
    await rollBillingPeriodsForward(trx, {
      companyId,
      userId,
      asOf,
      agreementId: agreement.id,
      cycle: agreement.billingCycle,
      timing: agreement.billingTiming,
      decimals
    });
  }

  // Locked so a concurrent run (the daily job and a manual "Generate
  // invoices") cannot bill the same period twice.
  const periods = await trx
    .selectFrom("rentalBillingPeriod as p")
    .innerJoin("rentalAgreementLine as l", (join) =>
      join
        .onRef("l.id", "=", "p.rentalAgreementLineId")
        .onRef("l.companyId", "=", "p.companyId")
    )
    .leftJoin("fixedAsset as fa", (join) =>
      join
        .onRef("fa.id", "=", "l.fixedAssetId")
        .onRef("fa.companyId", "=", "l.companyId")
    )
    .select([
      "p.id",
      "p.rentalAgreementLineId",
      "p.periodStart",
      "p.periodEnd",
      "p.days",
      "p.amount",
      "p.rateUnitApplied",
      "p.isAdjustment",
      "p.voidedSalesInvoiceId",
      "fa.name as assetName",
      "fa.serialNumber"
    ])
    .where("l.rentalAgreementId", "=", agreement.id)
    .where("p.companyId", "=", companyId)
    .where("p.status", "=", "Pending")
    .where("p.dueOn", "<=", asOf)
    .orderBy("p.periodStart")
    .orderBy("p.isAdjustment")
    .forUpdate("p")
    .execute();

  const charges = await trx
    .selectFrom("rentalAgreementCharge as c")
    .innerJoin("rentalAgreementLine as l", (join) =>
      join
        .onRef("l.id", "=", "c.rentalAgreementLineId")
        .onRef("l.companyId", "=", "c.companyId")
    )
    .select([
      "c.id",
      "c.rentalAgreementLineId",
      "c.chargeType",
      "c.description",
      "c.amount",
      "c.taxPercent",
      "c.invoiceSeparately",
      "c.voidedSalesInvoiceId"
    ])
    .where("l.rentalAgreementId", "=", agreement.id)
    .where("c.companyId", "=", companyId)
    .where("c.salesInvoiceLineId", "is", null)
    .where("c.chargeDate", "<=", asOf)
    .orderBy("c.chargeDate")
    .forUpdate("c")
    .execute();

  if (periods.length === 0 && charges.length === 0) return nothing;

  // An early-return adjustment is a credit, and a credit on an invoice can
  // net it below zero — a document no payment can apply and no refund can
  // pay out. Adjustments go on a credit memo instead; everything else is
  // invoiced as before.
  const adjustments = periods.filter((period) => period.isAdjustment);
  const billable = periods.filter((period) => !period.isAdjustment);
  const creditMemos: DraftedRentalCreditMemo[] =
    adjustments.length > 0
      ? [
          {
            memoId: await insertRentalCreditMemo(trx, args, agreement, {
              adjustments,
              decimals
            }),
            rentalAgreementId: agreement.id
          }
        ]
      : [];

  // The readable ids of the voided invoices these rows were billed on, so a
  // re-bill's hold names them. One read; a deleted invoice keeps its raw id.
  const voidedIds = [
    ...new Set(
      [...billable, ...charges]
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
  const voidedReadableId = (voidedId: string | null) =>
    voidedId ? (voidedReadableIds.get(voidedId) ?? voidedId) : null;

  // Periods and charges are priced in the agreement's currency;
  // `salesInvoiceLine.unitPrice` is base currency (`convertedUnitPrice` =
  // unitPrice × exchangeRate is what the customer sees), as on every sales
  // document.
  const exchangeRate = Number(agreement.exchangeRate);
  const lines: {
    values: LineValues;
    isAdjustment: boolean;
    invoiceSeparately: boolean;
    voidedInvoiceReadableId: string | null;
  }[] = [
    ...billable.map((period) => ({
      values: {
        rentalAgreementLineId: period.rentalAgreementLineId,
        rentalBillingPeriodId: period.id,
        rentalAgreementChargeId: null,
        rentalLineType: "Rent" as const,
        description: rentLineDescription({
          ...period,
          cycle: agreement.billingCycle
        }),
        unitPrice: toBaseAmount(Number(period.amount), exchangeRate),
        taxPercent: Number(agreement.taxPercent),
        serviceStartDate: period.periodStart,
        serviceEndDate: period.periodEnd
      },
      isAdjustment: period.isAdjustment ?? false,
      invoiceSeparately: false,
      voidedInvoiceReadableId: voidedReadableId(period.voidedSalesInvoiceId)
    })),
    ...charges.map((charge) => ({
      values: {
        rentalAgreementLineId: charge.rentalAgreementLineId,
        rentalBillingPeriodId: null,
        rentalAgreementChargeId: charge.id,
        rentalLineType: charge.chargeType,
        description: charge.description,
        unitPrice: toBaseAmount(Number(charge.amount), exchangeRate),
        taxPercent: Number(charge.taxPercent),
        serviceStartDate: null,
        serviceEndDate: null
      },
      isAdjustment: false,
      invoiceSeparately: charge.invoiceSeparately,
      voidedInvoiceReadableId: voidedReadableId(charge.voidedSalesInvoiceId)
    }))
  ];

  const planned = planRentalInvoices(
    mode,
    lines.map((line) => ({
      item: line.values,
      lineType: line.values.rentalLineType,
      isAdjustment: line.isAdjustment,
      invoiceSeparately: line.invoiceSeparately,
      voidedInvoiceReadableId: line.voidedInvoiceReadableId
    }))
  );

  const drafted: DraftedRentalInvoice[] = [];
  for (const invoice of planned) {
    const invoiceId = await insertRentalInvoice(
      trx,
      args,
      agreement,
      invoice.lines,
      invoice.holdReason
    );
    drafted.push({
      invoiceId,
      rentalAgreementId: agreement.id,
      mode,
      holdReason: invoice.holdReason
    });
  }
  return { invoices: drafted, creditMemos };
}

/**
 * Inserts one Draft credit memo for an agreement's due early-return
 * adjustments and stamps them with it (`Invoiced`, `memoId`). The memo is the
 * sum of the credits at the currency's settlement precision; post-memo books
 * each period's share against its Deferral rows. Returns the memo id.
 */
async function insertRentalCreditMemo(
  trx: KyselyTx,
  args: RentalInvoiceGenerationArgs,
  agreement: RentalAgreementRecord,
  credit: {
    adjustments: {
      id: string;
      amount: number | string;
      days: number;
      periodStart: string;
      periodEnd: string;
      rateUnitApplied: RateUnit | null;
      isAdjustment: boolean | null;
      assetName: string | null;
      serialNumber: string | null;
    }[];
    decimals: number;
  }
): Promise<string> {
  const { companyId, asOf, userId } = args;
  const amount = round(
    -credit.adjustments.reduce((sum, row) => sum + Number(row.amount), 0),
    credit.decimals
  );
  if (!(amount > 0)) {
    throw new Error("An early-return credit must be a positive amount");
  }
  // Allocated in this transaction, so a rollback leaves no gap.
  const memoReadableId = await getNextSequence(trx, "creditMemo", companyId);
  const memo = await trx
    .insertInto("memo")
    .values({
      memoId: memoReadableId,
      direction: "Credit",
      status: "Draft",
      customerId: agreement.customerId,
      memoDate: asOf,
      currencyCode: agreement.currencyCode,
      exchangeRate: agreement.exchangeRate,
      amount,
      reference: agreement.rentalAgreementId,
      notes: credit.adjustments
        .map((row) =>
          rentLineDescription({
            ...row,
            isAdjustment: true,
            cycle: agreement.billingCycle
          })
        )
        .join("\n"),
      rentalAgreementId: agreement.id,
      companyId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  await trx
    .updateTable("rentalBillingPeriod")
    .set({
      status: "Invoiced",
      memoId: memo.id,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .where("companyId", "=", companyId)
    .where(
      "id",
      "in",
      credit.adjustments.map((row) => row.id)
    )
    .execute();

  return memo.id;
}

/**
 * Inserts one Draft rental invoice (opportunity, header, shipment, lines) and
 * stamps the periods and charges it bills with their invoice line. Returns
 * the invoice id.
 */
async function insertRentalInvoice(
  trx: KyselyTx,
  args: RentalInvoiceGenerationArgs,
  agreement: RentalAgreementRecord,
  lines: LineValues[],
  holdReason: string | null
): Promise<string> {
  const { companyId, asOf, userId } = args;

  const subtotal = round(lines.reduce((sum, line) => sum + line.unitPrice, 0));
  const totalTax = round(
    lines.reduce((sum, line) => sum + line.unitPrice * line.taxPercent, 0)
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
    .values({ companyId, customerId: agreement.customerId })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  const invoice = await trx
    .insertInto("salesInvoice")
    .values({
      invoiceId: readableInvoiceId,
      status: "Draft",
      customerId: agreement.customerId,
      invoiceCustomerId: agreement.customerId,
      invoiceCustomerContactId: agreement.customerContactId,
      invoiceCustomerLocationId: agreement.customerLocationId,
      locationId: agreement.locationId,
      paymentTermId: agreement.paymentTermId,
      currencyCode: agreement.currencyCode,
      exchangeRate: agreement.exchangeRate,
      dateIssued: asOf,
      subtotal,
      totalDiscount: 0,
      totalTax,
      totalAmount: round(subtotal + totalTax),
      opportunityId: opportunity.id,
      automationHoldReason: holdReason,
      companyId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  await trx
    .insertInto("salesInvoiceShipment")
    .values({
      id: invoice.id,
      locationId: agreement.locationId,
      // The agreement's Rental Site is where the units go: the ship-to.
      customerLocationId: agreement.customerLocationId,
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
        invoiceLineType: "Rental" as const,
        rentalAgreementId: agreement.id,
        ...line,
        quantity: 1,
        // NOT NULL with a default — stated, never left to the default.
        methodType: "Pull from Inventory" as const,
        unitOfMeasureCode: "EA",
        exchangeRate: agreement.exchangeRate,
        locationId: agreement.locationId,
        sortOrder: index + 1,
        companyId,
        createdBy: userId
      }))
    )
    .execute();

  // Stamp what was billed with the line that billed it.
  await trx
    .updateTable("rentalBillingPeriod as p")
    .from("salesInvoiceLine as sil")
    .set({
      status: "Invoiced",
      salesInvoiceLineId: sql`sil.id`,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .whereRef("sil.rentalBillingPeriodId", "=", "p.id")
    .whereRef("sil.companyId", "=", "p.companyId")
    .where("sil.invoiceId", "=", invoice.id)
    .where("p.companyId", "=", companyId)
    .execute();

  await trx
    .updateTable("rentalAgreementCharge as c")
    .from("salesInvoiceLine as sil")
    .set({
      salesInvoiceLineId: sql`sil.id`,
      updatedBy: userId,
      updatedAt: sql`now()`
    })
    .whereRef("sil.rentalAgreementChargeId", "=", "c.id")
    .whereRef("sil.companyId", "=", "c.companyId")
    .where("sil.invoiceId", "=", invoice.id)
    .where("c.companyId", "=", companyId)
    .execute();

  return invoice.id;
}

/**
 * Cuts the periods every live (Pending / On Rent) line of the agreement is
 * missing up to `billingHorizon(asOf)`, from the line's activation snapshot.
 * A fixed term was generated in full at activation, so this only adds the
 * rolling period of an open-ended line or a holdover period past the end
 * date. Existing rows are never touched — returns re-cut through the edge
 * function. Sales-type lines never roll: their term is fixed at activation.
 */
async function rollBillingPeriodsForward(
  trx: KyselyTx,
  args: {
    companyId: string;
    userId: string;
    asOf: string;
    agreementId: string;
    cycle: Database["public"]["Enums"]["rentalBillingCycle"];
    timing: Database["public"]["Enums"]["rentalBillingTiming"];
    /** The agreement currency's `decimalPlaces`. */
    decimals: number;
  }
): Promise<void> {
  const { companyId, userId, asOf, agreementId, cycle, timing } = args;

  const dates = await trx
    .selectFrom("rentalAgreement")
    .select([
      sql<string>`"startDate"::text`.as("startDate"),
      sql<string | null>`"endDate"::text`.as("endDate")
    ])
    .where("id", "=", agreementId)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();

  const lines = await trx
    .selectFrom("rentalAgreementLine")
    .select(["id", "rateUnit", "rate"])
    .where("rentalAgreementId", "=", agreementId)
    .where("companyId", "=", companyId)
    .where("status", "in", ["Pending", "On Rent"])
    // A sales-type lease's whole term was cut at activation and its payments
    // run down Net Investment in Leases; a holdover period past the end date
    // has no place on that schedule, so only operating lines roll forward.
    .where((eb) =>
      eb.or([
        eb("lessorClassification", "is", null),
        eb("lessorClassification", "=", "Rental")
      ])
    )
    .forUpdate()
    .execute();
  if (lines.length === 0) return;

  const existing = await trx
    .selectFrom("rentalBillingPeriod")
    .select([
      "rentalAgreementLineId",
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd"),
      "amount",
      "status",
      "isAdjustment"
    ])
    .where("companyId", "=", companyId)
    .where(
      "rentalAgreementLineId",
      "in",
      lines.map((line) => line.id)
    )
    .execute();

  const through = billingHorizon(cycle, asOf);
  const rows = lines.flatMap((line) => {
    const { create } = generateRentalBillingPeriods({
      cycle,
      timing,
      rateUnit: line.rateUnit,
      rate: Number(line.rate),
      startDate: dates.startDate,
      endDate: dates.endDate,
      returnedAt: null,
      through,
      existing: existing
        .filter((row) => row.rentalAgreementLineId === line.id)
        .map((row) => ({
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          amount: Number(row.amount),
          status: row.status,
          isAdjustment: row.isAdjustment
        })),
      decimals: args.decimals
    });
    return create.map((spec) => ({
      rentalAgreementLineId: line.id,
      periodStart: spec.periodStart,
      periodEnd: spec.periodEnd,
      days: spec.days,
      amount: spec.amount,
      rateUnitApplied: spec.rateUnitApplied,
      isAdjustment: false,
      dueOn: spec.dueOn,
      status: "Pending" as const,
      companyId,
      createdBy: userId
    }));
  });

  if (rows.length > 0) {
    await trx.insertInto("rentalBillingPeriod").values(rows).execute();
  }
}

/** "2026-10-01 – 2026-10-28 · 28 days · 1 × Month rate — Skid Steer 4
 *  SN-1001", "… · 31 days · Month rate — …" (a Monthly unit on a Calendar
 *  Month or Monthly agreement is its month rate prorated by days, so it names
 *  no unit count), or for an early-return credit "Early return credit — 3 days used". */
export function rentLineDescription(period: {
  cycle: Database["public"]["Enums"]["rentalBillingCycle"];
  periodStart: string;
  periodEnd: string;
  days: number;
  rateUnitApplied: RateUnit | null;
  isAdjustment: boolean;
  assetName: string | null;
  serialNumber: string | null;
}): string {
  // A unit capitalized from stock is named "<item> <serial>": its serial is
  // named once, not twice.
  const serial =
    period.serialNumber && !period.assetName?.includes(period.serialNumber)
      ? period.serialNumber
      : null;
  const unit = [period.assetName, serial].filter(Boolean).join(" ");
  if (period.isAdjustment) {
    return `Early return credit — ${period.days} days used${unit ? ` — ${unit}` : ""}`;
  }
  const tier =
    period.rateUnitApplied === null
      ? ""
      : period.cycle !== "28 Days" && period.rateUnitApplied === "Month"
        ? " · Month rate"
        : ` · ${wholeRateUnits(period.days, period.rateUnitApplied)} × ${period.rateUnitApplied} rate`;
  return `${period.periodStart} – ${period.periodEnd} · ${period.days} days${tier}${unit ? ` — ${unit}` : ""}`;
}

export const createRentalInvoicesInput = z.object({
  /** `YYYY-MM-DD` in the company's timezone. */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Bill one agreement only. */
  rentalAgreementId: z.string().optional()
});

export const createRentalInvoicesPermission = {
  update: "sales",
  create: "invoicing"
} satisfies PermissionRule<z.output<typeof createRentalInvoicesInput>>;

/** Drafts the rental invoices due on or before `asOf` (see
 *  `createRentalInvoicesForDuePeriods`). An agreement that fails is reported
 *  in `failures`, never thrown, so the others still draft. */
export async function createRentalInvoices(
  ctx: ServiceContext,
  raw: z.input<typeof createRentalInvoicesInput>
) {
  const { asOf, rentalAgreementId } = createRentalInvoicesInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  return createRentalInvoicesForDuePeriods(db, {
    companyId,
    userId,
    asOf,
    rentalAgreementId
  });
}
export type Db = Kysely<KyselyDatabase>;

export type Trx = Transaction<KyselyDatabase>;

export type Enums = Database["public"]["Enums"];

export type AgreementRow = {
  id: string;
  rentalAgreementId: string;
  status: Enums["rentalAgreementStatus"];
  customerId: string;
  locationId: string;
  startDate: string;
  endDate: string | null;
  billingCycle: Enums["rentalBillingCycle"];
  billingTiming: Enums["rentalBillingTiming"];
  currencyCode: string;
  discountRate: number;
  ownershipTransfers: boolean;
  specializedAsset: boolean;
  purchaseOptionAmount: number | null;
  purchaseOptionReasonablyCertain: boolean;
};

// Re-read under the caller's company and lock: the id comes from the payload,
// and the permission check proves nothing about it. The lock serializes two
// actions on one agreement (a double-clicked Activate, a return racing a
// cancel). DATE columns decode to JS Dates through the driver, so they are
// selected as text — the billing math works on `YYYY-MM-DD` strings.
export async function lockAgreement(
  trx: Trx,
  companyId: string,
  id: string
): Promise<AgreementRow> {
  const agreement = await trx
    .selectFrom("rentalAgreement")
    .select([
      "id",
      "rentalAgreementId",
      "status",
      "customerId",
      "locationId",
      sql<string>`"startDate"::text`.as("startDate"),
      sql<string | null>`"endDate"::text`.as("endDate"),
      "billingCycle",
      "billingTiming",
      "currencyCode",
      "discountRate",
      "ownershipTransfers",
      "specializedAsset",
      "purchaseOptionAmount",
      "purchaseOptionReasonablyCertain"
    ])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!agreement) throw new NotFoundError("Rental agreement not found");
  return {
    ...agreement,
    discountRate: Number(agreement.discountRate),
    purchaseOptionAmount:
      agreement.purchaseOptionAmount === null
        ? null
        : Number(agreement.purchaseOptionAmount)
  };
}

export function billingPeriodRow(
  spec: PeriodSpec,
  rentalAgreementLineId: string,
  companyId: string,
  userId: string
) {
  return {
    rentalAgreementLineId,
    periodStart: spec.periodStart,
    periodEnd: spec.periodEnd,
    days: spec.days,
    amount: spec.amount,
    rateUnitApplied: spec.rateUnitApplied,
    isAdjustment: spec.isAdjustment,
    dueOn: spec.dueOn,
    status: "Pending" as const,
    companyId,
    createdBy: userId
  };
}

// What the 'Lease' journals need, resolved once per request inside the
// transaction. The status read holds FOR SHARE on the company's settings
// until commit; the period resolver reuses the caller's transaction and locks
// the period row, so a close cannot slip in between.
export type LeaseAccounting = {
  // Provisional before the company's accounting cutover, Posted after it.
  postingStatus: AutomaticJournalStatus;
  // null for a Provisional journal: it has no accounting period
  accountingPeriodId: string | null;
  // The accounts journal lines use. Before the cutover an empty lease default
  // is a stand-in on retained earnings (resolveDefaultAccount).
  accounts: {
    netInvestmentInLeasesAccount: string;
    leaseRevenueAccount: string;
    costOfGoodsSoldAccount: string;
    finishedGoodsAccount: string;
    rawMaterialsAccount: string;
  };
  // The default each lease account stands in for; the lessor builders put
  // it on the line that uses the account (journalLine.accountDefaultRole).
  accountDefaultRoles: LeaseStandInRoles;
  // The accounts a Planned Interest recognition row names. A schedule row is
  // not re-pointed at the cutover, so it never takes a stand-in: null when
  // either default is empty.
  interestAccounts: { debitAccountId: string; creditAccountId: string } | null;
  // active dimensions for the company group, entityType → dimension id
  dimensionMap: Map<string, string>;
};

export const LEASE_ACCOUNTS_REQUIRED =
  "Set the Net Investment in Leases, Lease Revenue and Lease Interest Income accounts in the account defaults before activating a rental treated as a sale";

export async function loadLeaseAccounting(
  trx: Trx,
  args: { companyId: string; companyGroupId: string | null; today: string }
): Promise<LeaseAccounting> {
  const { companyId } = args;
  const postingStatus = await journalPostingStatus(trx, companyId);
  const defaults = await trx
    .selectFrom("accountDefault")
    .select([
      "netInvestmentInLeasesAccount",
      "leaseRevenueAccount",
      "leaseInterestIncomeAccount",
      "costOfGoodsSoldAccount",
      "finishedGoodsAccount",
      "rawMaterialsAccount",
      "retainedEarningsAccount"
    ])
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) throw new Error("Error getting account defaults");
  const {
    netInvestmentInLeasesAccount,
    leaseRevenueAccount,
    leaseInterestIncomeAccount
  } = defaults;
  // After the cutover every lease default is required, as it always was.
  if (
    postingStatus === "Posted" &&
    (!netInvestmentInLeasesAccount ||
      !leaseRevenueAccount ||
      !leaseInterestIncomeAccount)
  ) {
    throw new InvalidInputError(LEASE_ACCOUNTS_REQUIRED);
  }
  const netInvestment = resolveDefaultAccount(
    defaults,
    "netInvestmentInLeasesAccount",
    postingStatus
  );
  const leaseRevenue = resolveDefaultAccount(
    defaults,
    "leaseRevenueAccount",
    postingStatus
  );

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
          .where("entityType", "in", ["Customer", "Item", "Location"])
          .execute();

  // A Provisional journal has no period, and no posting creates one before
  // the cutover.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getCurrentAccountingPeriod(companyId, trx, args.today)
      : null;

  return {
    postingStatus,
    accountingPeriodId,
    accounts: {
      netInvestmentInLeasesAccount: netInvestment.accountId,
      leaseRevenueAccount: leaseRevenue.accountId,
      costOfGoodsSoldAccount: defaults.costOfGoodsSoldAccount,
      finishedGoodsAccount: defaults.finishedGoodsAccount,
      rawMaterialsAccount: defaults.rawMaterialsAccount
    },
    accountDefaultRoles: {
      netInvestmentInLeases: netInvestment.accountDefaultRole,
      leaseRevenue: leaseRevenue.accountDefaultRole
    },
    interestAccounts:
      netInvestmentInLeasesAccount && leaseInterestIncomeAccount
        ? {
            debitAccountId: netInvestmentInLeasesAccount,
            creditAccountId: leaseInterestIncomeAccount
          }
        : null,
    dimensionMap: new Map(
      dimensions.map((dimension) => [dimension.entityType, dimension.id])
    )
  };
}

// One 'Lease' journal from already-balanced lines, Provisional before the
// accounting cutover and Posted after it. Every line carries
// the agreement as its document and the agreement line as the line
// reference, tagged with the Customer / Item / Location dimensions the
// company group has active.
export async function postLeaseJournal(
  trx: Trx,
  args: {
    accounting: LeaseAccounting;
    companyId: string;
    userId: string;
    postingDate: string;
    description: string;
    lines: PostingLine[];
    rentalAgreementId: string;
    rentalAgreementLineId: string;
    tags: { customerId: string; itemId: string; locationId: string };
  }
): Promise<string> {
  const { accounting, companyId, userId } = args;
  const journalId = await createAdjustmentJournal(trx, {
    companyId,
    accountingPeriodId: accounting.accountingPeriodId,
    status: accounting.postingStatus,
    description: args.description,
    postingDate: args.postingDate,
    userId,
    sourceType: "Lease"
  });

  const journalLineReference = nanoid();
  const journalLines = await trx
    .insertInto("journalLine")
    .values(
      args.lines.map((line) => ({
        journalId,
        accountId: line.accountId,
        description: line.description,
        amount: round(line.amount),
        quantity: 1,
        documentType: "Rental Agreement" as const,
        documentId: args.rentalAgreementId,
        documentLineReference: args.rentalAgreementLineId,
        journalLineReference,
        accountDefaultRole: line.accountDefaultRole ?? null,
        companyId
      }))
    )
    .returning(["id"])
    .execute();

  const dimensionInserts = buildJournalLineDimensionInserts({
    journalLineIds: journalLines.map((line) => line.id),
    meta: journalLines.map(() => args.tags),
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

// The traceability graph records the lease as the consumer of the unit at
// commencement, and as its producer when it comes back to stock.
export async function insertUnitActivity(
  trx: Trx,
  args: {
    type:
      | "Lease Commencement"
      | "Return to Inventory"
      | "Capitalize"
      | "Rental Delivery"
      | "Rental Return"
      | "Void Shipment";
    direction: "input" | "output";
    sourceDocument: "Rental Agreement" | "Fixed Asset" | "Shipment" | "Receipt";
    sourceDocumentId: string;
    sourceDocumentReadableId: string;
    attributes: Record<string, string>;
    trackedEntityId: string;
    companyId: string;
    userId: string;
  }
): Promise<void> {
  const activityId = nanoid();
  await trx
    .insertInto("trackedActivity")
    .values({
      id: activityId,
      type: args.type,
      sourceDocument: args.sourceDocument,
      sourceDocumentId: args.sourceDocumentId,
      sourceDocumentReadableId: args.sourceDocumentReadableId,
      attributes: args.attributes,
      companyId: args.companyId,
      createdBy: args.userId
    })
    .execute();
  await trx
    .insertInto(
      args.direction === "input"
        ? "trackedActivityInput"
        : "trackedActivityOutput"
    )
    .values({
      trackedActivityId: activityId,
      trackedEntityId: args.trackedEntityId,
      quantity: 1,
      companyId: args.companyId,
      createdBy: args.userId
    })
    .execute();
}
/** The classification a line is booked under: an overridden line keeps the
 *  value the override stored; every other line takes the tests' answer. */
export function settledClassification(
  computed: LessorClassification,
  line: {
    classificationOverride: boolean;
    lessorClassification: LessorClassification | null;
  }
): LessorClassification {
  return line.classificationOverride && line.lessorClassification !== null
    ? line.lessorClassification
    : computed;
}

/**
 * How far activation cuts a line's billing periods. An operating line goes
 * to the billing horizon (today plus one cycle) like the daily pass, which
 * rolls it on from there — past the end date as holdover. A sales-type line
 * bills exactly its term: capped at the end date, so no period past it is
 * ever cut (a holdover period would bill rent against a net investment the
 * schedule has already closed). The daily pass never rolls a sales-type line.
 */
export function activationBillingThrough(args: {
  classification: LessorClassification;
  cycle: RentalBillingCycle;
  today: string;
  endDate: string | null;
}): string {
  const horizon = billingHorizon(args.cycle, args.today);
  if (args.classification !== "Sale") return horizon;
  if (args.endDate === null) {
    throw new Error("A rental treated as a sale needs an end date");
  }
  return args.endDate < horizon ? args.endDate : horizon;
}

/** The balance the schedule must close on: what the lessor still expects at
 *  the end of the term — a reasonably certain purchase option plus both
 *  residuals. */
export function leaseClosingTarget(args: {
  purchaseOption: number;
  guaranteedResidualValue: number;
  unguaranteedResidualValue: number;
}): number {
  return round(
    args.purchaseOption +
      args.guaranteedResidualValue +
      args.unguaranteedResidualValue
  );
}

/** The billing periods the schedule's lines follow: the first `periods`
 *  regular (non-adjustment) periods of the term, in date order. A fixed term
 *  is generated in full at activation, so there are always enough. */
export function scheduleBillingPeriods(
  generated: Pick<PeriodSpec, "periodStart" | "periodEnd" | "isAdjustment">[],
  periods: number
): Array<{ periodStart: string; periodEnd: string }> {
  const regular = generated
    .filter((period) => !period.isAdjustment)
    .map(({ periodStart, periodEnd }) => ({ periodStart, periodEnd }))
    .sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
  if (regular.length < periods) {
    throw new Error(
      `A ${periods}-period lease schedule needs ${periods} billing periods, got ${regular.length}`
    );
  }
  return regular.slice(0, periods);
}

/** One Interest recognition row per schedule line that earns interest,
 *  spanning the billing period the line belongs to. */
export function interestRows(
  schedule: LessorScheduleLine[],
  spans: Array<{ periodStart: string; periodEnd: string }>
): Array<{
  index: number;
  periodStart: string;
  periodEnd: string;
  scheduledDate: string;
  amount: number;
}> {
  if (schedule.length !== spans.length) {
    throw new Error("Every schedule line needs its billing period");
  }
  return schedule.flatMap((line, index) =>
    !earnsInterest(line.interestAmount)
      ? []
      : [
          {
            index,
            periodStart: spans[index]!.periodStart,
            periodEnd: spans[index]!.periodEnd,
            scheduledDate: line.periodDate,
            amount: round(line.interestAmount)
          }
        ]
  );
}

/** The amounts a fleet unit's commencement books (spec §4). C is the unit's
 *  carrying amount (net book value); the gain the disposal records is the
 *  selling profit. */
export function commencementAmounts(args: {
  pvPayments: number;
  pvResidual: number;
  acquisitionCost: number;
  accumulatedDepreciation: number;
}): {
  netInvestment: number;
  carryingAmount: number;
  costOfGoodsSold: number;
  sellingProfit: number;
} {
  const values = [
    args.pvPayments,
    args.pvResidual,
    args.acquisitionCost,
    args.accumulatedDepreciation
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Lease commencement amounts must be finite");
  }
  const cost = round(args.acquisitionCost);
  const accumulated = round(args.accumulatedDepreciation);
  if (cost < 0 || accumulated < 0 || accumulated > cost) {
    throw new Error(
      "The unit's accumulated depreciation must be between zero and its cost"
    );
  }
  const pvPayments = round(args.pvPayments);
  const pvResidual = round(args.pvResidual);
  const carryingAmount = round(cost - accumulated);
  const costOfGoodsSold = round(carryingAmount - pvResidual);
  return {
    netInvestment: round(pvPayments + pvResidual),
    carryingAmount,
    costOfGoodsSold,
    sellingProfit: round(pvPayments - costOfGoodsSold)
  };
}

/** A journal line as the posting functions store it: `amount` is signed by
 *  the account's NATURAL balance (`journalLine.amount` convention). Same
 *  shape as `PostingLine` in lib/asset-transfer.ts. */
export type PostingLine = {
  accountId: string;
  description: string;
  amount: number;
  /** The default a stand-in line wanted (journalLine.accountDefaultRole). */
  accountDefaultRole?: OptionalDefaultRole | null;
};

/** The default a lease account stands in for before the accounting cutover,
 *  or null when the default is set (resolveDefaultAccount). */
export type LeaseStandInRoles = {
  netInvestmentInLeases?: OptionalDefaultRole | null;
  leaseRevenue?: OptionalDefaultRole | null;
};

type AccountType = "asset" | "expense" | "revenue";

/** `debit()` / `credit()` (`@carbon/database/ledger`) for the three account
 *  classes a lease journal touches: a debit is + on an asset or expense
 *  account, − on revenue. */
function naturalAmount(
  side: "debit" | "credit",
  accountType: AccountType,
  amount: number
): number {
  const debitPositive = accountType === "asset" || accountType === "expense";
  return (side === "debit") === debitPositive ? amount : -amount;
}

type Leg = {
  side: "debit" | "credit";
  accountType: AccountType;
  accountId: string;
  description: string;
  amount: number;
  accountDefaultRole?: OptionalDefaultRole | null;
};

/** Legs → natural-balance-signed journal lines, dropping zero legs and
 *  refusing an unbalanced set. A negative leg amount flips its side. */
function toPostingLines(legs: Leg[], label: string): PostingLine[] {
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
      accountId: leg.accountId,
      description: leg.description,
      amount: naturalAmount(side, leg.accountType, value),
      ...(leg.accountDefaultRole
        ? { accountDefaultRole: leg.accountDefaultRole }
        : {})
    });
  }
  assertBalanced(round(debits), round(credits), EPSILON, label);
  return lines;
}

/**
 * The commencement journal of a sales-type line whose unit comes off the
 * fleet (spec §4):
 *
 *   Dr Net Investment in Leases        NI
 *   Dr Cost of Goods Sold              C − PVres
 *   Dr Accumulated Depreciation        accumulated depreciation
 *       Cr Lease Revenue                       PVpay
 *       Cr fleet class asset account           cost
 *
 * Balanced by construction: NI + (C − PVres) + AD = PVpay + PVres + C − PVres
 * + AD = PVpay + cost. Zero legs are omitted; a residual worth more than the
 * carrying amount turns the COGS leg into a credit.
 */
export function buildCommencementLines(args: {
  pvPayments: number;
  pvResidual: number;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  accounts: {
    netInvestmentInLeasesAccountId: string;
    costOfGoodsSoldAccountId: string;
    leaseRevenueAccountId: string;
    assetAccountId: string;
    accumulatedDepreciationAccountId: string;
  };
  /** The default each lease account stands in for, when it is a stand-in. */
  accountDefaultRoles?: LeaseStandInRoles;
}): PostingLine[] {
  const amounts = commencementAmounts(args);
  const { accounts } = args;
  return toPostingLines(
    [
      {
        side: "debit",
        accountType: "asset",
        accountId: accounts.netInvestmentInLeasesAccountId,
        description: "Net Investment in Leases",
        amount: amounts.netInvestment,
        accountDefaultRole: args.accountDefaultRoles?.netInvestmentInLeases
      },
      {
        side: "debit",
        accountType: "expense",
        accountId: accounts.costOfGoodsSoldAccountId,
        description: "Cost of Goods Sold",
        amount: amounts.costOfGoodsSold
      },
      {
        side: "credit",
        accountType: "revenue",
        accountId: accounts.leaseRevenueAccountId,
        description: "Lease Revenue",
        amount: args.pvPayments,
        accountDefaultRole: args.accountDefaultRoles?.leaseRevenue
      },
      {
        side: "debit",
        accountType: "asset",
        accountId: accounts.accumulatedDepreciationAccountId,
        description: "Accumulated Depreciation",
        amount: args.accumulatedDepreciation
      },
      {
        side: "credit",
        accountType: "asset",
        accountId: accounts.assetAccountId,
        description: "Fixed Asset Cost",
        amount: args.acquisitionCost
      }
    ],
    "Lease commencement journal"
  );
}

/**
 * The net investment the SCHEDULE carries on `asOf`: the closing balance of
 * the last schedule line dated on or before it, or the initial NI when none
 * is (a lease with no schedule lines keeps its initial NI).
 *
 * Read off the schedule, not off what has posted. A sales-type unit comes
 * back only on or after its end date, when the final month's interest
 * usually has not been through a recognition run yet — netting only posted
 * principal overstated the residual by that month and dropped its interest,
 * and with accounting off (no Interest rows ever post) it left the residual
 * at the initial NI. The schedule's lines dated on or before the return keep
 * posting through recognition runs after the return, and complete the Net
 * Investment in Leases account: initial NI + Σ interest − Σ rent − closing = 0.
 */
export function netInvestmentAt(args: {
  initialNetInvestment: number;
  schedule: Array<{ periodDate: string; closingNetInvestment: number }>;
  asOf: string;
}): number {
  let last: { periodDate: string; closingNetInvestment: number } | null = null;
  for (const line of args.schedule) {
    // `YYYY-MM-DD` compares chronologically as text.
    if (line.periodDate > args.asOf) continue;
    if (last === null || line.periodDate > last.periodDate) last = line;
  }
  return round(
    Number(
      last === null ? args.initialNetInvestment : last.closingNetInvestment
    )
  );
}

/** Dr the account the returned unit now sits in (the fleet class asset
 *  account, or inventory) / Cr Net Investment in Leases, for the closing net
 *  investment. Nothing to post when it is zero. */
export function buildResidualReturnLines(args: {
  closing: number;
  debitAccountId: string;
  debitDescription: string;
  netInvestmentInLeasesAccountId: string;
  /** The default each lease account stands in for, when it is a stand-in. */
  accountDefaultRoles?: LeaseStandInRoles;
}): PostingLine[] {
  if (!Number.isFinite(args.closing)) {
    throw new Error("The closing net investment must be finite");
  }
  if (round(args.closing) < 0) {
    throw new Error("The closing net investment is negative");
  }
  return toPostingLines(
    [
      {
        side: "debit",
        accountType: "asset",
        accountId: args.debitAccountId,
        description: args.debitDescription,
        amount: args.closing
      },
      {
        side: "credit",
        accountType: "asset",
        accountId: args.netInvestmentInLeasesAccountId,
        description: "Net Investment in Leases",
        amount: args.closing,
        accountDefaultRole: args.accountDefaultRoles?.netInvestmentInLeases
      }
    ],
    "Lease residual return journal"
  );
}

/**
 * Why a unit cannot be returned the way the payload asks, or null. Only a
 * sales-type line is checked; an operating return ignores the destination.
 * A sales-type unit comes back at the END of the term — before it, the net
 * investment still carries unpaid rent, and booking that into the fleet or
 * stock would overstate the unit, so early termination stays a manual
 * journal (spec §4).
 */
export function salesTypeReturnError(args: {
  classification: string | null;
  residualDestination: ResidualDestination | null | undefined;
  returnedAt: string;
  endDate: string | null;
  takeOutOfService: boolean;
}): string | null {
  if (args.classification !== "Sale") return null;
  if (!args.residualDestination) {
    return "Choose where the returned unit goes: back to the fleet or into inventory";
  }
  if (args.endDate !== null && args.returnedAt < args.endDate) {
    return "Ending a rental treated as a sale early is a manual journal";
  }
  if (args.takeOutOfService && args.residualDestination === "Inventory") {
    return "A unit returned to inventory cannot be taken out of service; return it to the fleet instead";
  }
  return null;
}
export type RentalUnitReturn = {
  rentalAgreementLineId: string;
  returnedAt: string; // YYYY-MM-DD
  meterIn?: number | null;
  returnNotes?: string | null;
  takeOutOfService?: boolean;
  outOfServiceReason?: string | null;
  residualDestination?: ResidualDestination | null;
};

/** Returns one unit of a locked, Active agreement. The caller locks the
 *  agreement, checks it is Active and refuses a future return date. */
export async function returnRentalUnit(
  trx: Trx,
  args: {
    agreement: AgreementRow;
    unit: RentalUnitReturn;
    companyId: string;
    userId: string;
    today: string;
    /** Where a `Sale` line's residual lands (stock or new fleet asset).
     *  Without it, the agreement's location, as today. */
    locationId?: string;
  }
): Promise<{ fixedAssetId: string | null }> {
  const { agreement, unit, companyId, userId, today } = args;
  const { returnedAt } = unit;

  const line = await trx
    .selectFrom("rentalAgreementLine")
    .select([
      "id",
      "status",
      "fixedAssetId",
      "itemId",
      "trackedEntityId",
      "rateUnit",
      "rate",
      "lessorClassification",
      "initialNetInvestment",
      sql<string | null>`"deliveredAt"::text`.as("deliveredAt")
    ])
    .where("id", "=", unit.rentalAgreementLineId)
    .where("rentalAgreementId", "=", agreement.id)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!line) throw new NotFoundError("Rental agreement line not found");
  if (!RETURNABLE_LINE_STATUSES.has(line.status)) {
    throw new InvalidInputError(
      `The unit is ${line.status}; only a Pending or On Rent unit can be returned`
    );
  }
  // `YYYY-MM-DD` compares chronologically as text.
  if (returnedAt < agreement.startDate) {
    throw new InvalidInputError(
      `The return date is before the agreement starts (${agreement.startDate})`
    );
  }
  if (line.deliveredAt && returnedAt < line.deliveredAt) {
    throw new InvalidInputError(
      `The return date is before the unit was delivered (${line.deliveredAt})`
    );
  }
  // A sales-type unit is off the books until it comes back: where it goes
  // (fleet or stock) is the caller's choice and has to be made. An
  // operating return ignores the destination.
  const salesTypeProblem = salesTypeReturnError({
    classification: line.lessorClassification,
    residualDestination: unit.residualDestination,
    returnedAt,
    endDate: agreement.endDate,
    takeOutOfService: !!unit.takeOutOfService
  });
  if (salesTypeProblem) throw new InvalidInputError(salesTypeProblem);
  const salesType = line.lessorClassification === "Sale";
  if (salesType && line.initialNetInvestment === null) {
    throw new InvalidInputError(
      "This line is treated as a sale but has no commencement booked; it cannot be returned"
    );
  }

  const now = datetime.timestamp();

  // A sales-type line's billing is its term, cut in full at activation, and
  // the unit comes back only on or after the end date — there is nothing to
  // re-cut. Regenerating would cut holdover periods past the end date that
  // bill rent against a net investment the schedule has already closed.
  if (!salesType) {
    const existingRows = await trx
      .selectFrom("rentalBillingPeriod")
      .select([
        sql<string>`"periodStart"::text`.as("periodStart"),
        sql<string>`"periodEnd"::text`.as("periodEnd"),
        "amount",
        "status",
        "isAdjustment"
      ])
      .where("rentalAgreementLineId", "=", line.id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .execute();
    const existing: ExistingBillingPeriod[] = existingRows.map((row) => ({
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      amount: Number(row.amount),
      status: row.status,
      isAdjustment: row.isAdjustment
    }));

    const plan = generateRentalBillingPeriods({
      cycle: agreement.billingCycle,
      timing: agreement.billingTiming,
      rateUnit: line.rateUnit,
      rate: Number(line.rate),
      startDate: agreement.startDate,
      endDate: agreement.endDate,
      returnedAt,
      through: returnedAt,
      existing,
      decimals: await currencyDecimals(trx, companyId, agreement.currencyCode)
    });

    // The generation stops at the return, so every unbilled period starting
    // after it is gone. An invoiced one is credited through `adjustments`.
    await trx
      .deleteFrom("rentalBillingPeriod")
      .where("rentalAgreementLineId", "=", line.id)
      .where("companyId", "=", companyId)
      .where("status", "=", "Pending")
      .where("isAdjustment", "=", false)
      .where("periodStart", ">", returnedAt)
      .execute();

    // The unbilled period the return falls inside ends on the return date.
    for (const recut of plan.recut) {
      await trx
        .updateTable("rentalBillingPeriod")
        .set({
          periodEnd: recut.periodEnd,
          days: recut.days,
          amount: recut.amount,
          rateUnitApplied: recut.rateUnitApplied,
          dueOn: recut.dueOn,
          updatedBy: userId,
          updatedAt: now
        })
        .where("rentalAgreementLineId", "=", line.id)
        .where("companyId", "=", companyId)
        .where("periodStart", "=", recut.periodStart)
        .where("isAdjustment", "=", false)
        .where("status", "=", "Pending")
        .execute();
    }

    // `create` is non-empty when the return falls in a period not generated
    // yet; `adjustments` credits advance billing past the return.
    const inserts = [...plan.create, ...plan.adjustments].map((spec) =>
      billingPeriodRow(spec, line.id, companyId, userId)
    );
    if (inserts.length > 0) {
      await trx.insertInto("rentalBillingPeriod").values(inserts).execute();
    }
  }

  await trx
    .updateTable("rentalAgreementLine")
    .set({
      status: "Returned",
      returnedAt,
      meterIn: unit.meterIn ?? null,
      returnNotes: unit.returnNotes ?? null,
      updatedBy: userId,
      updatedAt: now
    })
    .where("id", "=", line.id)
    .where("companyId", "=", companyId)
    .execute();

  // A sales-type unit's closing net investment moves back onto the books
  // — as a new Rental Fleet asset or into stock. The asset the line names
  // was disposed at commencement, so a fleet return's unit is the new one.
  let fleetAssetId = line.fixedAssetId;
  if (salesType) {
    const residual = await returnResidual(trx, {
      agreement,
      line: {
        id: line.id,
        itemId: line.itemId,
        fixedAssetId: line.fixedAssetId,
        trackedEntityId: line.trackedEntityId,
        initialNetInvestment: Number(line.initialNetInvestment)
      },
      destination: unit.residualDestination as ResidualDestination,
      returnedAt,
      companyId,
      userId,
      today,
      locationId: args.locationId ?? agreement.locationId
    });
    fleetAssetId = residual.fixedAssetId;
  }

  // Straight to maintenance: the fleet status reads In Maintenance and the
  // unit cannot go back on rent until it is returned to service.
  if (unit.takeOutOfService && fleetAssetId) {
    await trx
      .updateTable("fixedAsset")
      .set({
        outOfServiceSince: returnedAt,
        outOfServiceReason: (unit.outOfServiceReason ?? "").trim(),
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", fleetAssetId)
      .where("companyId", "=", companyId)
      .execute();
  }

  return { fixedAssetId: fleetAssetId };
}

/**
 * End of a sales-type term with the unit coming back (spec §4): the closing
 * net investment — the schedule's balance on the return date
 * (`netInvestmentAt`: the closing of the last schedule line dated on or
 * before it, which at or after the end date is the closing target; the
 * initial NI when the line has no schedule) — leaves Net Investment in
 * Leases for either
 *
 *   Fleet      a new asset in the class named "Rental Fleet" (else the class
 *              the unit left at commencement) at that amount, with a Posted
 *              Capitalization transfer; Dr class asset / Cr net investment.
 *              The unit is consumed into the new asset.
 *   Inventory  stock at that unit cost (`bookAdjustment` +1, no variance
 *              journal); Dr the item's inventory account / Cr net investment.
 *              The unit is Available again.
 *
 * The schedule lines and Interest rows dated on or before the return stay,
 * posted or not: they are the term the lease ran, the closing already counts
 * them, and their interest posts through recognition runs after the return,
 * bringing Net Investment in Leases to zero. Only what is dated AFTER the
 * return is dropped — nothing accrues on a lease that has ended (normally
 * nothing, since a unit comes back on or after the end date). Before the
 * accounting cutover the journal is Provisional.
 */
async function returnResidual(
  trx: Trx,
  args: {
    agreement: AgreementRow;
    line: {
      id: string;
      itemId: string;
      fixedAssetId: string | null;
      trackedEntityId: string | null;
      initialNetInvestment: number;
    };
    destination: ResidualDestination;
    returnedAt: string;
    companyId: string;
    userId: string;
    today: string;
    locationId: string;
  }
): Promise<{ fixedAssetId: string | null }> {
  const { agreement, line, destination, returnedAt, companyId, userId, today } =
    args;

  // A Draft recognition run that already claimed interest dated after the
  // return would be left pointing at deleted rows. Interest on or before the
  // return is kept, so a run holding it is no obstacle.
  const claimed = await trx
    .selectFrom("revenueRecognitionSchedule")
    .select(sql<number>`count(*)::int`.as("count"))
    .where("rentalAgreementLineId", "=", line.id)
    .where("companyId", "=", companyId)
    .where("type", "=", "Interest")
    .where("status", "=", "Planned")
    .where("scheduledDate", ">", returnedAt)
    .where("runLineId", "is not", null)
    .executeTakeFirstOrThrow();
  if (Number(claimed.count) > 0) {
    throw new InvalidInputError(
      "A draft lease run includes this lease's interest; post or delete the run before returning the unit"
    );
  }

  const schedule = await trx
    .selectFrom("rentalLeaseScheduleLine")
    .select([
      sql<string>`"periodDate"::text`.as("periodDate"),
      "closingNetInvestment"
    ])
    .where("rentalAgreementLineId", "=", line.id)
    .where("companyId", "=", companyId)
    .execute();
  const closing = netInvestmentAt({
    initialNetInvestment: line.initialNetInvestment,
    schedule: schedule.map((row) => ({
      periodDate: row.periodDate,
      closingNetInvestment: Number(row.closingNetInvestment)
    })),
    asOf: returnedAt
  });
  if (closing < 0) {
    throw new InvalidInputError(
      `The lease's closing net investment is negative (${closing})`
    );
  }

  // Sequential on purpose: one transaction is one connection.
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();
  const item = await trx
    .selectFrom("item")
    .select([
      "id",
      "name",
      "readableId",
      "itemTrackingType",
      "replenishmentSystem"
    ])
    .where("id", "=", line.itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const itemCost = await trx
    .selectFrom("itemCost")
    .select(["costingMethod", "unitCost", "standardCost", "itemPostingGroupId"])
    .where("itemId", "=", line.itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  // The serial left the line's asset at commencement when the line named
  // only the asset (as `commenceSalesTypeLines` resolves it), so a line
  // without its own serial takes the disposed asset's.
  const disposedAsset =
    !line.trackedEntityId && line.fixedAssetId
      ? await trx
          .selectFrom("fixedAsset")
          .select("trackedEntityId")
          .where("id", "=", line.fixedAssetId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : undefined;
  const trackedEntityId =
    line.trackedEntityId ?? disposedAsset?.trackedEntityId ?? null;
  const entity = trackedEntityId
    ? await trx
        .selectFrom("trackedEntity")
        .select(["id", "readableId"])
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .executeTakeFirst()
    : undefined;
  if (!item) throw new NotFoundError("Item not found");
  const serial = entity?.readableId ?? item.readableId;
  const accounting = await loadLeaseAccounting(trx, {
    companyId,
    companyGroupId: company.companyGroupId,
    today
  });
  const tags = {
    customerId: agreement.customerId,
    itemId: line.itemId,
    locationId: agreement.locationId
  };
  const description = `Lease return ${agreement.rentalAgreementId} ${serial}`;

  let fixedAssetId: string | null = null;
  if (destination === "Fleet") {
    // The class the fleet register and capitalization default to; a company
    // that renamed it falls back to the class the unit was leased out of.
    const byName = await trx
      .selectFrom("fixedAssetClass")
      .select([
        "id",
        "assetAccountId",
        "depreciationMethod",
        "usefulLifeMonths",
        "residualValuePercent"
      ])
      .where("companyId", "=", companyId)
      .where("name", "=", "Rental Fleet")
      .where("isConstructionInProgress", "=", false)
      .executeTakeFirst();
    const original =
      byName || !line.fixedAssetId
        ? undefined
        : await trx
            .selectFrom("fixedAsset as fa")
            .innerJoin("fixedAssetClass as fac", (join) =>
              join
                .onRef("fac.id", "=", "fa.fixedAssetClassId")
                .onRef("fac.companyId", "=", "fa.companyId")
            )
            .select([
              "fac.id",
              "fac.assetAccountId",
              "fac.depreciationMethod",
              "fac.usefulLifeMonths",
              "fac.residualValuePercent"
            ])
            .where("fa.id", "=", line.fixedAssetId)
            .where("fa.companyId", "=", companyId)
            .where("fac.isConstructionInProgress", "=", false)
            .executeTakeFirst();
    const assetClass = byName ?? original;
    if (!assetClass) {
      throw new InvalidInputError(
        "No Rental Fleet asset class to return the unit into; create one or return the unit to inventory"
      );
    }

    let journalId: string | null = null;
    if (closing > 0) {
      journalId = await postLeaseJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: today,
        description,
        lines: buildResidualReturnLines({
          closing,
          debitAccountId: assetClass.assetAccountId,
          debitDescription: "Fixed Asset Acquisition",
          netInvestmentInLeasesAccountId:
            accounting.accounts.netInvestmentInLeasesAccount,
          accountDefaultRoles: accounting.accountDefaultRoles
        }),
        rentalAgreementId: agreement.id,
        rentalAgreementLineId: line.id,
        tags
      });
    }

    const assetReadableId = await getNextSequence(trx, "fixedAsset", companyId);
    const asset = await trx
      .insertInto("fixedAsset")
      .values({
        fixedAssetId: assetReadableId,
        fixedAssetClassId: assetClass.id,
        name: `${item.name} ${serial}`,
        itemId: line.itemId,
        trackedEntityId,
        serialNumber: entity?.readableId ?? null,
        locationId: args.locationId,
        quantity: 1,
        acquisitionCost: closing,
        acquisitionDate: today,
        depreciationStartDate: today,
        depreciationMethod: assetClass.depreciationMethod,
        usefulLifeMonths: assetClass.usefulLifeMonths,
        residualValuePercent: assetClass.residualValuePercent,
        status: "Active",
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();
    fixedAssetId = asset.id;

    const transferId = await getNextSequence(
      trx,
      "fixedAssetTransfer",
      companyId
    );
    const now = datetime.timestamp();
    await trx
      .insertInto("fixedAssetTransfer")
      .values({
        transferId,
        type: "Capitalization",
        sourceType: "Inventory",
        fixedAssetId: asset.id,
        itemId: line.itemId,
        trackedEntityId,
        locationId: args.locationId,
        quantity: 1,
        transferDate: today,
        amount: closing,
        journalId,
        status: "Posted",
        postedAt: now,
        postedBy: userId,
        companyId,
        createdBy: userId
      })
      .execute();

    if (trackedEntityId) {
      await trx
        .updateTable("trackedEntity")
        .set({
          status: "Consumed",
          attributes: sql<Json>`(COALESCE("attributes", '{}'::jsonb) - 'Rental Agreement' - 'Customer') || jsonb_build_object('Fixed Asset', ${asset.id}::text)`
        })
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
      await insertUnitActivity(trx, {
        type: "Capitalize",
        direction: "input",
        sourceDocument: "Fixed Asset",
        sourceDocumentId: asset.id,
        sourceDocumentReadableId: assetReadableId,
        attributes: { "Fixed Asset": asset.id },
        trackedEntityId,
        companyId,
        userId
      });
    }
  } else {
    if (!itemCost) throw new NotFoundError("Item cost not found");
    // Into stock at the closing net investment: a cost layer at that amount,
    // so the unit is later sold like any other stock. accounting: null keeps
    // the core from posting a variance journal; the lease journal is below.
    await bookAdjustment(trx, {
      ledger: {
        postingDate: today,
        itemId: line.itemId,
        quantity: 1,
        locationId: args.locationId,
        storageUnitId: null,
        trackedEntityId,
        entryType: "Positive Adjmt.",
        documentType: "Rental Agreement",
        documentId: agreement.id,
        companyId,
        createdBy: userId
      },
      item: {
        itemTrackingType: item.itemTrackingType,
        replenishmentSystem: item.replenishmentSystem,
        itemPostingGroupId: itemCost.itemPostingGroupId
      },
      itemCost: {
        costingMethod: itemCost.costingMethod,
        unitCost: itemCost.unitCost,
        standardCost: itemCost.standardCost
      },
      accounting: null,
      fixedUnitCost: closing
    });

    if (closing > 0) {
      const inventoryAccount = resolveInventoryAccount(
        item.replenishmentSystem,
        accounting.accounts
      );
      await postLeaseJournal(trx, {
        accounting,
        companyId,
        userId,
        postingDate: today,
        description,
        lines: buildResidualReturnLines({
          closing,
          debitAccountId: inventoryAccount.account,
          debitDescription: inventoryAccount.description,
          netInvestmentInLeasesAccountId:
            accounting.accounts.netInvestmentInLeasesAccount,
          accountDefaultRoles: accounting.accountDefaultRoles
        }),
        rentalAgreementId: agreement.id,
        rentalAgreementLineId: line.id,
        tags
      });
    }

    if (trackedEntityId) {
      await trx
        .updateTable("trackedEntity")
        .set({
          status: "Available",
          attributes: sql<Json>`COALESCE("attributes", '{}'::jsonb) - 'Rental Agreement' - 'Customer'`
        })
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
      await insertUnitActivity(trx, {
        type: "Return to Inventory",
        direction: "output",
        sourceDocument: "Rental Agreement",
        sourceDocumentId: agreement.id,
        sourceDocumentReadableId: agreement.rentalAgreementId,
        attributes: { "Rental Agreement": agreement.id },
        trackedEntityId,
        companyId,
        userId
      });
    }
  }

  // The lease has ended: nothing dated after the return will ever accrue.
  // Everything on or before it stays and posts through recognition runs.
  await trx
    .deleteFrom("revenueRecognitionSchedule")
    .where("rentalAgreementLineId", "=", line.id)
    .where("companyId", "=", companyId)
    .where("type", "=", "Interest")
    .where("status", "=", "Planned")
    .where("scheduledDate", ">", returnedAt)
    .execute();
  await trx
    .deleteFrom("rentalLeaseScheduleLine")
    .where("rentalAgreementLineId", "=", line.id)
    .where("companyId", "=", companyId)
    .where("postedAt", "is", null)
    .where("periodDate", ">", returnedAt)
    .execute();

  return { fixedAssetId };
}
/**
 * Payload contract and pure helpers for `post-rental-agreement`. No I/O and
 * no imports beyond zod, the generated types and the pure date / billing
 * modules, so the server function's decisions can be pinned without a
 * database.
 */

type validatorsEnums = Database["public"]["Enums"];

// Calendar dates travel as `YYYY-MM-DD` text end to end: the line and the
// billing periods store DATE columns, and a JavaScript Date would shift the
// day by the runtime timezone.
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

// companyId and userId come from the server function's context, not the input.
const scope = {
  rentalAgreementId: z.string().min(1)
};

/** Draft → Active: check every unit is available, classify each unit's
 *  accounting treatment, cut the first periods at each unit's rate. */
export const activateValidator = z.object({
  type: z.literal("activate"),
  ...scope
});

/** Where a sales-type unit goes when it comes back at the end of the term. */
export const RESIDUAL_DESTINATIONS = ["Fleet", "Inventory"] as const;

export type ResidualDestination = (typeof RESIDUAL_DESTINATIONS)[number];

/** One unit coming back, without the agreement: the fields a rental receipt
 *  line and the agreement's return action share. */
const unitReturnFields = {
  rentalAgreementLineId: z.string().min(1),
  returnedAt: calendarDate,
  meterIn: z.number().min(0).optional().nullable(),
  returnNotes: z.string().optional().nullable(),
  takeOutOfService: z.boolean().optional(),
  outOfServiceReason: z.string().optional().nullable(),
  residualDestination: z.enum(RESIDUAL_DESTINATIONS).optional().nullable()
};

export const unitReturnValidator = z
  .object(unitReturnFields)
  .refine(
    (data) => !data.takeOutOfService || !!data.outOfServiceReason?.trim(),
    {
      message: "A reason is required to take the unit out of service",
      path: ["outOfServiceReason"]
    }
  );

/** A Pending unit that never left the yard: stop its billing at
 *  `returnedAt` and free the unit, with no document (spec Q8). */
export const releaseValidator = z.object({
  type: z.literal("release"),
  rentalAgreementLineId: z.string().min(1),
  returnedAt: calendarDate,
  ...scope
});

/** Every unit is back (or sold) and everything is billed. */
export const closeValidator = z.object({
  type: z.literal("close"),
  ...scope
});

/** Nothing delivered and nothing billed: the agreement is void. */
export const cancelValidator = z.object({
  type: z.literal("cancel"),
  ...scope
});

export const payloadValidator = z.discriminatedUnion("type", [
  activateValidator,
  releaseValidator,
  closeValidator,
  cancelValidator
]);

export type RentalAgreementPayload = z.infer<typeof payloadValidator>;

/** A line holds its unit while it is in one of these statuses — the same set
 *  the `rentalAgreementLine_asset_live_idx` unique index and the
 *  `fleetAssets` view key on. */
export const LIVE_LINE_STATUSES: ReadonlyArray<
  validatorsEnums["rentalAgreementLineStatus"]
> = ["Pending", "On Rent"];

/** Line statuses a unit can be returned from. A Pending line was never
 *  delivered: returning it just stops its billing at the return date. */
export const RETURNABLE_LINE_STATUSES: ReadonlySet<
  validatorsEnums["rentalAgreementLineStatus"]
> = new Set(["Pending", "On Rent"] as const);

/** Line statuses an agreement can close with. */
export const CLOSABLE_LINE_STATUSES: ReadonlySet<
  validatorsEnums["rentalAgreementLineStatus"]
> = new Set(["Returned", "Sold"] as const);

/** Asset statuses a unit can go on rent from (spec §2 "Fleet register":
 *  Available means Active / Fully Depreciated with nothing else holding it —
 *  the view's `fleetStatus` alone reads a Draft asset as Available). */
export const RENTABLE_ASSET_STATUSES: ReadonlySet<
  validatorsEnums["fixedAssetStatus"]
> = new Set(["Active", "Fully Depreciated"] as const);

/** A NUMERIC rate as the billing math reads it: null stays null (no rate),
 *  anything else is a number. */
export function toRate(
  value: number | string | null | undefined
): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** What `fleetAssets` says about one unit a line names. */
export type FleetUnit = {
  fixedAssetId: string;
  status: validatorsEnums["fixedAssetStatus"] | null;
  fleetStatus: string | null;
  outOfServiceReason: string | null;
  /** Row id of the agreement holding the unit's live line, if any. */
  liveAgreementId: string | null;
  /** Readable number of that agreement. */
  liveAgreementReadableId: string | null;
};

/**
 * Why a unit cannot go on rent under `agreementId`, or null when it can.
 * The agreement's OWN Draft line is already Pending (the column default), so
 * the view reads the unit as `Reserved` by this very agreement — that is the
 * one Reserved state that is available here.
 */
export function unitAvailabilityError(
  unit: FleetUnit,
  agreementId: string
): string | null {
  const name = unit.fixedAssetId;
  const heldBySelf = unit.liveAgreementId === agreementId;
  switch (unit.fleetStatus) {
    case "On Rent":
    case "Reserved":
      if (heldBySelf && unit.fleetStatus === "Reserved") break;
      return `${name} is ${unit.fleetStatus} on rental agreement ${
        unit.liveAgreementReadableId ?? unit.liveAgreementId ?? "unknown"
      }`;
    case "In Maintenance":
      return `${name} is out of service: ${
        unit.outOfServiceReason ?? "no reason given"
      }`;
    case "Available":
      break;
    default:
      return `${name} is ${unit.fleetStatus ?? "unavailable"}`;
  }
  if (unit.status === null || !RENTABLE_ASSET_STATUSES.has(unit.status)) {
    return `${name} is ${
      unit.status ?? "not registered"
    }; only an Active or Fully Depreciated asset can go on rent`;
  }
  return null;
}

/** Why a unit cannot be activated at its rate, or null: a unit at no rate
 *  would go on rent and bill nothing. */
export function unpricedUnitError(name: string, rate: number): string | null {
  return rate > 0
    ? null
    : `${name} has no rate; enter its rate before activating`;
}

/** Why a unit cannot be returned on `returnedAt`, or null: a return records
 *  what has happened, so it is never dated after the company's today — an
 *  operating return would otherwise cut billing short ahead of time, and a
 *  sales-type one would close the lease before its last month. */
export function futureReturnError(
  returnedAt: string,
  today: string
): string | null {
  // `YYYY-MM-DD` compares chronologically as text.
  return returnedAt > today ? "The return date cannot be in the future" : null;
}

/** Why an Active agreement cannot close, or null when it can. */
export function closeBlocker(args: {
  lineStatuses: validatorsEnums["rentalAgreementLineStatus"][];
  pendingPeriods: number;
  unbilledCharges: number;
}): string | null {
  if (args.lineStatuses.some((status) => !CLOSABLE_LINE_STATUSES.has(status))) {
    return "Every unit must be returned or sold before the agreement closes";
  }
  if (args.pendingPeriods > 0) {
    return "Every billing period must be invoiced before the agreement closes";
  }
  if (args.unbilledCharges > 0) {
    return "Every charge must be invoiced before the agreement closes";
  }
  return null;
}

/** Why an agreement cannot be cancelled, or null when it can. A Draft always
 *  can; an Active one only while nothing is on rent, sold, billed or
 *  recognized — cancelling drops the unbilled periods, so anything a later
 *  document already relies on must not exist. A sales-type line that has
 *  commenced has already sold the unit (derecognized, lease revenue booked):
 *  unwinding that is an early termination, which v1 leaves to a manual
 *  journal. */
export function cancelBlocker(args: {
  status: validatorsEnums["rentalAgreementStatus"];
  lineStatuses: validatorsEnums["rentalAgreementLineStatus"][];
  invoicedPeriods: number;
  billedCharges: number;
  /** `revenueRecognitionSchedule` rows (accruals, interest) against the lines. */
  recognizedRows: number;
  /** Sales-type lines whose commencement was booked at activation. */
  commencedSalesTypeLines: number;
}): string | null {
  if (args.status === "Draft") return null;
  if (args.status !== "Active") {
    return `The agreement is ${args.status}`;
  }
  if (args.commencedSalesTypeLines > 0) {
    return "Ending a rental treated as a sale early is a manual journal";
  }
  if (args.lineStatuses.includes("On Rent")) {
    return "A unit is on rent; return it before cancelling the agreement";
  }
  if (args.lineStatuses.includes("Sold")) {
    return "A unit on this agreement was sold";
  }
  if (args.invoicedPeriods > 0 || args.billedCharges > 0) {
    return "The agreement has been invoiced; it can be closed, not cancelled";
  }
  if (args.recognizedRows > 0) {
    return "Rental income has been recognized on this agreement; it can be closed, not cancelled";
  }
  return null;
}

/** The unit's name in a refusal: its asset number, else its asset name, else the line id. */
export function unitLabel(
  asset: { fixedAssetId: string | null; name: string | null } | undefined,
  lineId: string
): string {
  return asset?.fixedAssetId || asset?.name || lineId;
}

/** Why a delivery cannot be dated `deliveredOn`, or null. */
export function futureDeliveryError(
  deliveredOn: string,
  today: string
): string | null {
  // `YYYY-MM-DD` compares chronologically as text.
  return deliveredOn > today
    ? "The delivery date cannot be in the future"
    : null;
}

/** Why a rental shipment cannot be voided, or null. `accrual` is the worst
 *  Accrual row of the unit: "Posted", "Draft run" (Planned with a runLineId), or null. */
export function rentalShipmentVoidBlocker(
  units: {
    label: string;
    status: validatorsEnums["rentalAgreementLineStatus"];
    accrual: "Posted" | "Draft run" | null;
  }[]
): string | null {
  const notOnRent = units.find((unit) => unit.status !== "On Rent");
  if (notOnRent) {
    return `${notOnRent.label} is ${notOnRent.status}; a rental shipment can be voided only while every unit is On Rent`;
  }
  for (const unit of units) {
    if (unit.accrual === "Posted") {
      return `A posted run holds accrued rent for ${unit.label}; the shipment cannot be voided`;
    }
    if (unit.accrual === "Draft run") {
      return `A draft lease run holds accrued rent for ${unit.label}; delete the run before voiding the shipment`;
    }
  }
  return null;
}

/** Why an agreement cannot close while a rental document is still open, or null. */
export function openRentalDocumentBlocker(args: {
  shipmentId: string | null; // readable id of an open shipment that has a line
  receiptId: string | null; // readable id of an open receipt that has a line
}): string | null {
  if (args.shipmentId) {
    return `Shipment ${args.shipmentId} is still open; post or delete it before closing the agreement`;
  }
  if (args.receiptId) {
    return `Receipt ${args.receiptId} is still open; post or delete it before closing the agreement`;
  }
  return null;
}

/** Why a unit on a rental receipt cannot be returned, or null.
 *  A receipt returns a Pending or an On Rent unit (spec Q8). */
export function receiptReturnError(
  label: string,
  status: validatorsEnums["rentalAgreementLineStatus"]
): string | null {
  return RETURNABLE_LINE_STATUSES.has(status)
    ? null
    : `${label} is ${status}; only a Pending or On Rent unit can be returned`;
}

/** Why a release date is refused, or null. */
export function futureReleaseError(
  releasedOn: string,
  today: string
): string | null {
  // `YYYY-MM-DD` compares chronologically as text.
  return releasedOn > today ? "The release date cannot be in the future" : null;
}

/** Why a unit cannot be released, or null (spec Q8, plan decisions P1 and P2). */
export function releaseBlocker(args: {
  label: string;
  status: validatorsEnums["rentalAgreementLineStatus"];
  classification: validatorsEnums["lessorClassification"] | null;
  openDocument: string | null; // e.g. "shipment SHP-000004" or "receipt RCV-000002"
}): string | null {
  if (args.status !== "Pending") {
    return `${args.label} is ${args.status}; only a Pending unit can be released`;
  }
  if (args.classification === "Sale") {
    return `${args.label} is treated as a sale; return it on a rental receipt instead`;
  }
  if (args.openDocument) {
    return `${args.label} is on ${args.openDocument}; remove it there before releasing the unit`;
  }
  return null;
}
// The lifecycle of a rental agreement (spec §3, §4). Four actions, each ONE
// transaction that locks the agreement row first:
//
//   activate  Draft → Active: every unit Available and priced (its own
//             frequency and rate, already on the line), each line classified (ASC 842, `lessor.ts`),
//             first billing periods cut. An operating line posts nothing — the
//             unit simply stops being Available. A sales-type line commences:
//             the fleet unit is derecognized (asset Disposed by Sale), the
//             'Lease' journal books net investment / COGS / lease revenue, and
//             the effective-interest schedule plus its Interest recognition
//             rows are written.
//   A unit comes back through a rental receipt (`post-receipt`), which calls `returnRentalUnit`.
//   release   a Pending unit that never left the yard stops billing at the release date and is free again.
//   close     Active → Closed once every unit is back and everything billed.
//   cancel    Draft, or Active with nothing on rent / billed / recognized /
//             commenced → Cancelled; the Pending lines are deleted so their
//             units are free.

// Business-validation failures are 400s (InvalidInputError) with the exact
// message the app shows; a referenced record the caller's company does not own
// is a 404 (NotFoundError); everything else is a 500 so real outages surface in
// monitoring.

type ActivationPlan = {
  lineId: string;
  name: string;
  itemId: string;
  fixedAssetId: string;
  trackedEntityId: string | null;
  deliveredAt: string | null;
  periods: PeriodSpec[];
  classification: "Rental" | "Sale";
  classificationInputs: ClassificationInputs;
  terms: LeasePaymentTerms;
  closingTarget: number;
};

type RentalScope = { db: Db; companyId: string; userId: string };

async function activate(
  { db, companyId, userId }: RentalScope,
  payload: Extract<RentalAgreementPayload, { type: "activate" }>,
  today: string
): Promise<{ id: string }> {
  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId
    );
    if (agreement.status !== "Draft") {
      throw new InvalidInputError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; only a Draft agreement can be activated`
      );
    }

    // Accrual and deferral amounts are posted in base currency (Task 40), so
    // until the agreement's exchange rate is carried through them a foreign
    // currency agreement would post document amounts as base. The same holds
    // for a sales-type line's net investment and lease revenue.
    const company = await trx
      .selectFrom("company")
      .select(["baseCurrencyCode", "companyGroupId"])
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!company) throw new NotFoundError("Company not found");
    if (agreement.currencyCode !== company.baseCurrencyCode) {
      throw new InvalidInputError(
        "Rental agreements in a foreign currency are not supported yet"
      );
    }
    const decimals = await currencyDecimals(
      trx,
      companyId,
      agreement.currencyCode
    );

    // The classification thresholds.
    const settings = await trx
      .selectFrom("companySettings")
      .select([
        "leaseMajorPartThresholdPercent",
        "leaseSubstantiallyAllThresholdPercent"
      ])
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!settings) throw new NotFoundError("Company settings not found");
    const thresholds = {
      majorPartPercent: Number(settings.leaseMajorPartThresholdPercent),
      substantiallyAllPercent: Number(
        settings.leaseSubstantiallyAllThresholdPercent
      )
    };

    const lines = await trx
      .selectFrom("rentalAgreementLine")
      .select([
        "id",
        "fixedAssetId",
        "itemId",
        "trackedEntityId",
        "rateUnit",
        "rate",
        "fairValue",
        "economicLifeMonths",
        "guaranteedResidualValue",
        "unguaranteedResidualValue",
        "lessorClassification",
        "classificationOverride",
        sql<string | null>`"deliveredAt"::text`.as("deliveredAt")
      ])
      .where("rentalAgreementId", "=", agreement.id)
      .where("companyId", "=", companyId)
      .orderBy("createdAt")
      .forUpdate()
      .execute();
    if (lines.length === 0) {
      throw new InvalidInputError(
        "Add at least one fleet unit before activating the agreement"
      );
    }
    // Every line rents a fleet unit (spec §3). A sales-type lease straight
    // out of stock — a line with a tracked entity and no asset — has no
    // entry point in v1, so it is refused here with every other asset-less
    // line rather than half-supported.
    if (lines.some((line) => !line.fixedAssetId)) {
      throw new InvalidInputError("Every line needs a fleet unit");
    }
    const assetIds = [
      ...new Set(lines.map((line) => line.fixedAssetId as string))
    ];

    // One read for every unit: the view derives Reserved / On Rent from the
    // live line and In Maintenance from the out-of-service columns.
    const units = await trx
      .selectFrom("fleetAssets as fa")
      .leftJoin("rentalAgreement as live", (join) =>
        join
          .onRef("live.id", "=", "fa.rentalAgreementId")
          .onRef("live.companyId", "=", "fa.companyId")
      )
      .select([
        "fa.id",
        "fa.fixedAssetId",
        "fa.itemId",
        "fa.status",
        "fa.fleetStatus",
        "fa.outOfServiceReason",
        "fa.rentalAgreementId as liveAgreementId",
        "live.rentalAgreementId as liveAgreementReadableId"
      ])
      .where("fa.id", "in", assetIds)
      .where("fa.companyId", "=", companyId)
      .execute();
    const unitById = new Map(units.map((unit) => [unit.id, unit]));

    // Every problem at once, so a planner fixes the agreement in one pass.
    const problems: string[] = [];
    const plans: ActivationPlan[] = [];
    for (const line of lines) {
      const unit = unitById.get(line.fixedAssetId as string);
      if (!unit || !unit.itemId) {
        problems.push("A line names an asset that is not a fleet unit");
        continue;
      }
      const name = unit.fixedAssetId ?? unit.id ?? "A fleet unit";
      const unavailable = unitAvailabilityError(
        {
          fixedAssetId: name,
          status: unit.status,
          fleetStatus: unit.fleetStatus,
          outOfServiceReason: unit.outOfServiceReason,
          liveAgreementId: unit.liveAgreementId,
          liveAgreementReadableId: unit.liveAgreementReadableId
        },
        agreement.id
      );
      if (unavailable) {
        problems.push(unavailable);
        continue;
      }
      // The unit's own frequency and rate, fixed from here on: a later change
      // to the rate cards never touches a live line.
      const rate = Number(line.rate);
      const rateUnit = line.rateUnit;
      const unpriced = unpricedUnitError(name, rate);
      if (unpriced) {
        problems.push(unpriced);
        continue;
      }

      // ASC 842 classification, from the unit's rate and the agreement's
      // terms. An overridden line keeps the classification the override
      // stored; its inputs are still recorded.
      if (
        line.classificationOverride &&
        line.lessorClassification === "Financing"
      ) {
        problems.push(
          `${name} is overridden to Financing, which is not supported`
        );
        continue;
      }
      const terms = leasePaymentTerms({
        cycle: agreement.billingCycle,
        rateUnit,
        rate,
        discountRate: agreement.discountRate,
        startDate: agreement.startDate,
        endDate: agreement.endDate,
        decimals
      });
      const lineTerms = {
        fairValue: line.fairValue === null ? null : Number(line.fairValue),
        economicLifeMonths: line.economicLifeMonths,
        guaranteedResidualValue: Number(line.guaranteedResidualValue),
        unguaranteedResidualValue: Number(line.unguaranteedResidualValue)
      };
      const { classification: computed, record } = classifyRentalLine({
        terms,
        timing: agreement.billingTiming,
        agreement,
        line: lineTerms,
        thresholds
      });
      const classification = settledClassification(computed, {
        classificationOverride: line.classificationOverride,
        lessorClassification:
          line.lessorClassification === "Financing"
            ? null
            : line.lessorClassification
      });
      if (classification === "Sale") {
        const requirement = salesTypeRequirementError({
          name,
          cycle: agreement.billingCycle,
          rateUnit,
          startDate: agreement.startDate,
          endDate: agreement.endDate,
          fairValue: lineTerms.fairValue,
          today
        });
        if (requirement) {
          problems.push(requirement);
          continue;
        }
      }

      const { create } = generateRentalBillingPeriods({
        cycle: agreement.billingCycle,
        timing: agreement.billingTiming,
        rateUnit,
        rate,
        startDate: agreement.startDate,
        endDate: agreement.endDate,
        returnedAt: null,
        // A sales-type line bills its term and nothing past it.
        through: activationBillingThrough({
          classification,
          cycle: agreement.billingCycle,
          today,
          endDate: agreement.endDate
        }),
        existing: [],
        decimals
      });
      plans.push({
        lineId: line.id,
        name,
        itemId: unit.itemId,
        fixedAssetId: unit.id as string,
        trackedEntityId: line.trackedEntityId,
        deliveredAt: line.deliveredAt,
        periods: create,
        classification,
        classificationInputs: record,
        terms,
        closingTarget: leaseClosingTarget({
          purchaseOption: certainPurchaseOption(agreement),
          guaranteedResidualValue: lineTerms.guaranteedResidualValue,
          unguaranteedResidualValue: lineTerms.unguaranteedResidualValue
        })
      });
    }
    if (problems.length > 0) throw new InvalidInputError(problems.join("; "));

    const now = datetime.timestamp();

    // Sales-type commencement: what each line books, keyed by line.
    const commenced = await commenceSalesTypeLines(trx, {
      agreement,
      companyId,
      companyGroupId: company.companyGroupId,
      userId,
      today,
      plans: plans.filter((plan) => plan.classification === "Sale")
    });

    // One update per line: each carries its own classification, and an
    // agreement holds a handful of units.
    for (const plan of plans) {
      const commencement = commenced.get(plan.lineId);
      await trx
        .updateTable("rentalAgreementLine")
        .set({
          lessorClassification: plan.classification,
          classificationInputs: toJson(plan.classificationInputs),
          ...(commencement
            ? {
                initialNetInvestment: commencement.netInvestment,
                sellingProfit: commencement.sellingProfit,
                commencementJournalId: commencement.journalId
              }
            : {}),
          status: plan.deliveredAt ? "On Rent" : "Pending",
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", plan.lineId)
        .where("companyId", "=", companyId)
        .execute();
    }

    const periodRows = plans.flatMap((plan) =>
      plan.periods.map((spec) =>
        billingPeriodRow(spec, plan.lineId, companyId, userId)
      )
    );
    if (periodRows.length > 0) {
      await trx.insertInto("rentalBillingPeriod").values(periodRows).execute();
    }

    await trx
      .updateTable("rentalAgreement")
      .set({
        status: "Active",
        activatedAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", agreement.id)
      .where("companyId", "=", companyId)
      .execute();

    return { id: agreement.id };
  });
}

/**
 * Commences every sales-type line of an activating agreement (spec §4), in
 * the caller's transaction: derecognizes the fleet unit (asset Disposed by
 * Sale with a disposal row; the tracked unit Consumed into the lease), posts
 * the 'Lease' commencement journal (Provisional before the accounting
 * cutover, Posted after it), and writes the effective-interest schedule — one
 * `rentalLeaseScheduleLine` per payment and one Planned `Interest`
 * recognition row per line that earns interest (Dr net investment / Cr lease
 * interest income).
 */
async function commenceSalesTypeLines(
  trx: Trx,
  args: {
    agreement: AgreementRow;
    companyId: string;
    companyGroupId: string | null;
    userId: string;
    today: string;
    plans: ActivationPlan[];
  }
): Promise<
  Map<
    string,
    {
      netInvestment: number;
      sellingProfit: number;
      journalId: string | null;
    }
  >
> {
  const { agreement, companyId, userId, today, plans } = args;
  const result = new Map<
    string,
    {
      netInvestment: number;
      sellingProfit: number;
      journalId: string | null;
    }
  >();
  if (plans.length === 0) return result;

  const assets = await trx
    .selectFrom("fixedAsset")
    .select([
      "id",
      "fixedAssetId",
      "fixedAssetClassId",
      "serialNumber",
      "trackedEntityId",
      "status",
      "acquisitionCost",
      "accumulatedDepreciation"
    ])
    .where(
      "id",
      "in",
      plans.map((plan) => plan.fixedAssetId)
    )
    .where("companyId", "=", companyId)
    .forUpdate()
    .execute();
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const classIds = [...new Set(assets.map((asset) => asset.fixedAssetClassId))];
  const classes = await trx
    .selectFrom("fixedAssetClass")
    .select(["id", "assetAccountId", "accumulatedDepreciationAccountId"])
    .where("id", "in", classIds)
    .where("companyId", "=", companyId)
    .execute();
  const classById = new Map(classes.map((row) => [row.id, row]));

  const accounting = await loadLeaseAccounting(trx, {
    companyId,
    companyGroupId: args.companyGroupId,
    today
  });

  const scheduleInserts: Array<{
    rentalAgreementLineId: string;
    periodDate: string;
    openingNetInvestment: number;
    paymentAmount: number;
    interestAmount: number;
    principalAmount: number;
    closingNetInvestment: number;
    companyId: string;
    createdBy: string;
  }> = [];
  const pendingInterest: Array<{
    rentalAgreementLineId: string;
    periodStart: string;
    periodEnd: string;
    scheduledDate: string;
    amount: number;
  }> = [];

  for (const plan of plans) {
    const asset = assetById.get(plan.fixedAssetId);
    if (!asset) throw new NotFoundError("Fixed asset not found");
    const assetClass = classById.get(asset.fixedAssetClassId);
    if (!assetClass) throw new NotFoundError("Fixed asset class not found");
    const { pv } = plan.classificationInputs;
    const acquisitionCost = Number(asset.acquisitionCost);
    const accumulatedDepreciation = Number(asset.accumulatedDepreciation);

    let amounts: ReturnType<typeof commencementAmounts>;
    try {
      amounts = commencementAmounts({
        pvPayments: pv.pvPayments,
        pvResidual: pv.pvResidual,
        acquisitionCost,
        accumulatedDepreciation
      });
    } catch (err) {
      throw new InvalidInputError(`${plan.name}: ${(err as Error).message}`);
    }
    const serial = asset.serialNumber ?? asset.fixedAssetId;
    const tags = {
      customerId: agreement.customerId,
      itemId: plan.itemId,
      locationId: agreement.locationId
    };

    const journalId = await postLeaseJournal(trx, {
      accounting,
      companyId,
      userId,
      postingDate: today,
      description: `Lease commencement ${agreement.rentalAgreementId} ${serial}`,
      lines: buildCommencementLines({
        pvPayments: pv.pvPayments,
        pvResidual: pv.pvResidual,
        acquisitionCost,
        accumulatedDepreciation,
        accounts: {
          netInvestmentInLeasesAccountId:
            accounting.accounts.netInvestmentInLeasesAccount,
          costOfGoodsSoldAccountId: accounting.accounts.costOfGoodsSoldAccount,
          leaseRevenueAccountId: accounting.accounts.leaseRevenueAccount,
          assetAccountId: assetClass.assetAccountId,
          accumulatedDepreciationAccountId:
            assetClass.accumulatedDepreciationAccountId
        },
        accountDefaultRoles: accounting.accountDefaultRoles
      }),
      rentalAgreementId: agreement.id,
      rentalAgreementLineId: plan.lineId,
      tags
    });

    // The unit leaves the register: sold to the lease at its net investment.
    // Guarded on the statuses activation accepted, so a concurrent disposal
    // or return to inventory rolls this back.
    const disposed = await trx
      .updateTable("fixedAsset")
      .set({
        status: "Disposed",
        disposalMethod: "Sale",
        disposalDate: today,
        saleProceeds: amounts.netInvestment,
        updatedAt: datetime.timestamp(),
        updatedBy: userId
      })
      .where("id", "=", asset.id)
      .where("companyId", "=", companyId)
      .where("status", "in", [...RENTABLE_ASSET_STATUSES])
      .executeTakeFirst();
    if (!disposed.numUpdatedRows) {
      throw new InvalidInputError(
        `${plan.name} changed status while the agreement was being activated`
      );
    }
    await trx
      .insertInto("fixedAssetDisposal")
      .values({
        fixedAssetId: asset.id,
        disposalMethod: "Sale",
        disposalDate: today,
        saleProceeds: amounts.netInvestment,
        netBookValueAtDisposal: amounts.carryingAmount,
        gainLoss: amounts.sellingProfit,
        journalId,
        companyId,
        createdBy: userId
      })
      .execute();

    // The serial is consumed into the lease: no longer on the asset, and the
    // agreement and customer on its attributes are how it is found again.
    const trackedEntityId = plan.trackedEntityId ?? asset.trackedEntityId;
    if (trackedEntityId) {
      await trx
        .updateTable("trackedEntity")
        .set({
          status: "Consumed",
          attributes: sql<Json>`(COALESCE("attributes", '{}'::jsonb) - 'Fixed Asset') || jsonb_build_object('Rental Agreement', ${agreement.id}::text, 'Customer', ${agreement.customerId}::text)`
        })
        .where("id", "=", trackedEntityId)
        .where("companyId", "=", companyId)
        .execute();
      await insertUnitActivity(trx, {
        type: "Lease Commencement",
        direction: "input",
        sourceDocument: "Rental Agreement",
        sourceDocumentId: agreement.id,
        sourceDocumentReadableId: agreement.rentalAgreementId,
        attributes: {
          "Rental Agreement": agreement.id,
          Customer: agreement.customerId
        },
        trackedEntityId,
        companyId,
        userId
      });
    }

    // The effective-interest schedule follows the billing periods: one line
    // per payment, dated at its billing period's end.
    const spans = scheduleBillingPeriods(plan.periods, plan.terms.periods);
    const schedule = buildLessorSchedule({
      netInvestment: amounts.netInvestment,
      payment: plan.terms.payment,
      periods: plan.terms.periods,
      annualRate: plan.terms.annualRate,
      timing: agreement.billingTiming,
      closingTarget: plan.closingTarget,
      periodDates: spans.map((span) => span.periodEnd)
    });
    for (const line of schedule) {
      scheduleInserts.push({
        rentalAgreementLineId: plan.lineId,
        periodDate: line.periodDate,
        openingNetInvestment: line.openingNetInvestment,
        paymentAmount: line.paymentAmount,
        interestAmount: line.interestAmount,
        principalAmount: line.principalAmount,
        closingNetInvestment: line.closingNetInvestment,
        companyId,
        createdBy: userId
      });
    }
    for (const row of interestRows(schedule, spans)) {
      pendingInterest.push({
        rentalAgreementLineId: plan.lineId,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        scheduledDate: row.scheduledDate,
        amount: row.amount
      });
    }

    result.set(plan.lineId, {
      netInvestment: amounts.netInvestment,
      sellingProfit: amounts.sellingProfit,
      journalId
    });
  }

  // One insert for every schedule line of the agreement; the Interest rows
  // find theirs by (line, periodDate), unique per line.
  const insertedSchedule =
    scheduleInserts.length === 0
      ? []
      : await trx
          .insertInto("rentalLeaseScheduleLine")
          .values(scheduleInserts)
          .returning([
            "id",
            "rentalAgreementLineId",
            sql<string>`"periodDate"::text`.as("periodDate")
          ])
          .execute();
  const scheduleIdByKey = new Map(
    insertedSchedule.map((row) => [
      `${row.rentalAgreementLineId}|${row.periodDate}`,
      row.id
    ])
  );
  if (pendingInterest.length > 0) {
    // A Planned schedule row is not re-pointed at the cutover, so it names
    // the real accounts or the activation is refused.
    const { interestAccounts } = accounting;
    if (!interestAccounts) {
      throw new InvalidInputError(LEASE_ACCOUNTS_REQUIRED);
    }
    await trx
      .insertInto("revenueRecognitionSchedule")
      .values(
        pendingInterest.map((row) => {
          const rentalLeaseScheduleLineId = scheduleIdByKey.get(
            `${row.rentalAgreementLineId}|${row.scheduledDate}`
          );
          if (!rentalLeaseScheduleLineId) {
            throw new Error("Interest row has no lease schedule line");
          }
          return {
            type: "Interest" as const,
            status: "Planned" as const,
            rentalAgreementLineId: row.rentalAgreementLineId,
            rentalLeaseScheduleLineId,
            periodStart: row.periodStart,
            periodEnd: row.periodEnd,
            scheduledDate: row.scheduledDate,
            amount: row.amount,
            debitAccountId: interestAccounts.debitAccountId,
            creditAccountId: interestAccounts.creditAccountId,
            companyId,
            createdBy: userId
          };
        })
      )
      .execute();
  }

  return result;
}

async function releaseUnit(
  { db, companyId, userId }: RentalScope,
  payload: Extract<RentalAgreementPayload, { type: "release" }>,
  today: string
): Promise<{ id: string }> {
  const future = futureReleaseError(payload.returnedAt, today);
  if (future) throw new InvalidInputError(future);
  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId
    );
    if (agreement.status !== "Active") {
      throw new InvalidInputError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; units are released from an Active agreement`
      );
    }

    const line = await trx
      .selectFrom("rentalAgreementLine")
      .select(["id", "status", "lessorClassification", "fixedAssetId"])
      .where("id", "=", payload.rentalAgreementLineId)
      .where("rentalAgreementId", "=", agreement.id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!line) throw new NotFoundError("Rental agreement line not found");

    const asset = line.fixedAssetId
      ? await trx
          .selectFrom("fixedAsset")
          .select(["fixedAssetId", "name"])
          .where("id", "=", line.fixedAssetId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : undefined;

    // A unit an open rental document still holds would be Returned while
    // the document names it (plan decision P2).
    const openShipment = await trx
      .selectFrom("shipment as s")
      .innerJoin("shipmentFixedAssetLine as l", (join) =>
        join
          .onRef("l.shipmentId", "=", "s.id")
          .onRef("l.companyId", "=", "s.companyId")
      )
      .select("s.shipmentId")
      .where("s.companyId", "=", companyId)
      .where("s.sourceDocument", "=", "Rental Agreement")
      .where("s.sourceDocumentId", "=", agreement.id)
      .where("s.status", "in", ["Draft", "Pending"])
      .where("l.rentalAgreementLineId", "=", line.id)
      .orderBy("s.createdAt")
      .executeTakeFirst();
    const openReceipt = await trx
      .selectFrom("receipt as r")
      .innerJoin("receiptFixedAssetLine as l", (join) =>
        join
          .onRef("l.receiptId", "=", "r.id")
          .onRef("l.companyId", "=", "r.companyId")
      )
      .select("r.receiptId")
      .where("r.companyId", "=", companyId)
      .where("r.sourceDocument", "=", "Rental Agreement")
      .where("r.sourceDocumentId", "=", agreement.id)
      .where("r.status", "in", ["Draft", "Pending"])
      .where("l.rentalAgreementLineId", "=", line.id)
      .orderBy("r.createdAt")
      .executeTakeFirst();
    const openDocument = openShipment
      ? `shipment ${openShipment.shipmentId}`
      : openReceipt
        ? `receipt ${openReceipt.receiptId}`
        : null;

    const blocker = releaseBlocker({
      label: unitLabel(asset, line.id),
      status: line.status,
      classification: line.lessorClassification,
      openDocument
    });
    if (blocker) throw new InvalidInputError(blocker);

    await returnRentalUnit(trx, {
      agreement,
      unit: {
        rentalAgreementLineId: line.id,
        returnedAt: payload.returnedAt
      },
      companyId,
      userId,
      today
    });
    return { id: agreement.id };
  });
}

// Everything close and cancel decide on, in three reads.
async function loadSettlementState(
  trx: Trx,
  companyId: string,
  agreementId: string
) {
  const lines = await trx
    .selectFrom("rentalAgreementLine")
    .select([
      "id",
      "status",
      "lessorClassification",
      "commencementJournalId",
      "initialNetInvestment"
    ])
    .where("rentalAgreementId", "=", agreementId)
    .where("companyId", "=", companyId)
    .forUpdate()
    .execute();
  const lineIds = lines.map((line) => line.id);
  if (lineIds.length === 0) {
    return {
      lines,
      lineIds,
      pendingPeriods: 0,
      invoicedPeriods: 0,
      unbilledCharges: 0,
      billedCharges: 0
    };
  }

  const periods = await trx
    .selectFrom("rentalBillingPeriod")
    .select([
      sql<number>`count(*) FILTER (WHERE status = 'Pending')::int`.as(
        "pending"
      ),
      sql<number>`count(*) FILTER (WHERE status = 'Invoiced')::int`.as(
        "invoiced"
      )
    ])
    .where("rentalAgreementLineId", "in", lineIds)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();
  const charges = await trx
    .selectFrom("rentalAgreementCharge")
    .select([
      sql<number>`count(*) FILTER (WHERE "salesInvoiceLineId" IS NULL)::int`.as(
        "unbilled"
      ),
      sql<number>`count(*) FILTER (WHERE "salesInvoiceLineId" IS NOT NULL)::int`.as(
        "billed"
      )
    ])
    .where("rentalAgreementLineId", "in", lineIds)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();

  return {
    lines,
    lineIds,
    pendingPeriods: Number(periods.pending),
    invoicedPeriods: Number(periods.invoiced),
    unbilledCharges: Number(charges.unbilled),
    billedCharges: Number(charges.billed)
  };
}

async function close(
  { db, companyId, userId }: RentalScope,
  payload: Extract<RentalAgreementPayload, { type: "close" }>
): Promise<{ id: string }> {
  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId
    );
    if (agreement.status !== "Active") {
      throw new InvalidInputError(
        `Rental agreement ${agreement.rentalAgreementId} is ${agreement.status}; only an Active agreement can be closed`
      );
    }

    // A rental document still open holds units the close would strand.
    const openShipment = await trx
      .selectFrom("shipment as s")
      .innerJoin("shipmentFixedAssetLine as l", (join) =>
        join
          .onRef("l.shipmentId", "=", "s.id")
          .onRef("l.companyId", "=", "s.companyId")
      )
      .select("s.shipmentId")
      .where("s.companyId", "=", companyId)
      .where("s.sourceDocument", "=", "Rental Agreement")
      .where("s.sourceDocumentId", "=", agreement.id)
      .where("s.status", "in", ["Draft", "Pending"])
      .orderBy("s.createdAt")
      .executeTakeFirst();
    const openReceipt = await trx
      .selectFrom("receipt as r")
      .innerJoin("receiptFixedAssetLine as l", (join) =>
        join
          .onRef("l.receiptId", "=", "r.id")
          .onRef("l.companyId", "=", "r.companyId")
      )
      .select("r.receiptId")
      .where("r.companyId", "=", companyId)
      .where("r.sourceDocument", "=", "Rental Agreement")
      .where("r.sourceDocumentId", "=", agreement.id)
      .where("r.status", "in", ["Draft", "Pending"])
      .orderBy("r.createdAt")
      .executeTakeFirst();
    const openDocument = openRentalDocumentBlocker({
      shipmentId: openShipment?.shipmentId ?? null,
      receiptId: openReceipt?.receiptId ?? null
    });
    if (openDocument) throw new InvalidInputError(openDocument);

    const state = await loadSettlementState(trx, companyId, agreement.id);
    const blocker = closeBlocker({
      lineStatuses: state.lines.map((line) => line.status),
      pendingPeriods: state.pendingPeriods,
      unbilledCharges: state.unbilledCharges
    });
    if (blocker) throw new InvalidInputError(blocker);

    const now = datetime.timestamp();
    await trx
      .updateTable("rentalAgreement")
      .set({
        status: "Closed",
        closedAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", agreement.id)
      .where("companyId", "=", companyId)
      .execute();

    return { id: agreement.id };
  });
}

async function cancel(
  { db, companyId, userId }: RentalScope,
  payload: Extract<RentalAgreementPayload, { type: "cancel" }>
): Promise<{ id: string }> {
  return db.transaction().execute(async (trx) => {
    const agreement = await lockAgreement(
      trx,
      companyId,
      payload.rentalAgreementId
    );

    const state = await loadSettlementState(trx, companyId, agreement.id);
    // An accrual (Task 40) already booked income against a line; dropping its
    // unbilled periods would strand that contract asset.
    const recognized =
      state.lineIds.length === 0
        ? { count: 0 }
        : await trx
            .selectFrom("revenueRecognitionSchedule")
            .select(sql<number>`count(*)::int`.as("count"))
            .where("rentalAgreementLineId", "in", state.lineIds)
            .where("companyId", "=", companyId)
            .executeTakeFirstOrThrow();

    const blocker = cancelBlocker({
      status: agreement.status,
      lineStatuses: state.lines.map((line) => line.status),
      invoicedPeriods: state.invoicedPeriods,
      billedCharges: state.billedCharges,
      recognizedRows: Number(recognized.count),
      // Booked at activation: the journal and the net investment (the
      // unit was disposed).
      commencedSalesTypeLines: state.lines.filter(
        (line) =>
          line.lessorClassification === "Sale" &&
          (line.commencementJournalId !== null ||
            line.initialNetInvestment !== null)
      ).length
    });
    if (blocker) throw new InvalidInputError(blocker);

    if (state.lineIds.length > 0) {
      // Nothing is invoiced (the blocker above), so every period left is
      // Pending and none will ever be billed.
      await trx
        .deleteFrom("rentalBillingPeriod")
        .where("rentalAgreementLineId", "in", state.lineIds)
        .where("companyId", "=", companyId)
        .where("status", "=", "Pending")
        .execute();

      // A Pending line holds its unit (the live-line unique index and the
      // fleetAssets view key on status, not on the agreement's), and the line
      // status enum has no Cancelled value. The never-delivered lines go, so
      // their units read Available again; their unbilled charges cascade.
      // Returned lines stay as the record of what the customer had.
      await trx
        .deleteFrom("rentalAgreementLine")
        .where("rentalAgreementId", "=", agreement.id)
        .where("companyId", "=", companyId)
        .where("status", "in", LIVE_LINE_STATUSES)
        .execute();
    }

    const now = datetime.timestamp();
    await trx
      .updateTable("rentalAgreement")
      .set({
        status: "Cancelled",
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", agreement.id)
      .where("companyId", "=", companyId)
      .execute();

    return { id: agreement.id };
  });
}

export const postRentalAgreementInput = payloadValidator;

export type PostRentalAgreementInput = RentalAgreementPayload;

export const postRentalAgreementPermission = {
  update: "sales"
} satisfies PermissionRule<z.output<typeof postRentalAgreementInput>>;

/** Activates, releases a unit of, closes or cancels a rental agreement, per
 *  `type` — each one transaction that locks the agreement row first. */
export async function postRentalAgreement(
  ctx: ServiceContext,
  raw: z.input<typeof postRentalAgreementInput>
) {
  const payload = postRentalAgreementInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const scope = { db, companyId, userId };
  switch (payload.type) {
    case "activate": {
      const today = datetime
        .today(await getCompanyTimeZone(db, companyId))
        .toString();
      return activate(scope, payload, today);
    }
    case "release": {
      const today = datetime
        .today(await getCompanyTimeZone(db, companyId))
        .toString();
      return releaseUnit(scope, payload, today);
    }
    case "close":
      return close(scope, payload);
    case "cancel":
      return cancel(scope, payload);
  }
}
export type BilledTotals = {
  /** Σ every schedule row of the line (adjustments and memo credits included). */
  totals: Map<string, number>;
  /** The last `periodEnd` of the line's schedule rows. */
  lastPeriodEnds: Map<string, string>;
};

/** Plans the invoice schedule live when none is stored (an unedited Draft):
 *  the contract, its lines and how far to plan (`horizon`). */
export type LiveSchedule = {
  contract: ContractRow;
  lines: ContractLineRow[];
  through: string;
};

export type StoredRevenueRow = {
  id: string;
  lineId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: ContractRevenueStatus;
};

/**
 * What the invoice schedule bills each line. Reads the stored schedule rows;
 * with `live`, a contract that has none (an unedited Draft) is planned the
 * way the page plans it.
 */
export async function billedTotals(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  live?: LiveSchedule
): Promise<BilledTotals> {
  const rows = await trx
    .selectFrom("customerContractInvoiceLine")
    .select([
      "customerContractLineId",
      sql<number>`SUM("amount")`.as("total"),
      sql<string>`MAX("periodEnd")::text`.as("lastPeriodEnd")
    ])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", scope.companyId)
    .groupBy("customerContractLineId")
    .execute();

  const totals = new Map<string, number>();
  const lastPeriodEnds = new Map<string, string>();
  if (rows.length === 0 && live) {
    const planned = planInvoiceSchedule(
      toTerms(live.contract),
      toLineTerms(live.lines),
      live.through
    );
    for (const [lineId, total] of lineTotals(planned))
      totals.set(lineId, total);
    for (const row of planned.flatMap((invoice) => invoice.rows)) {
      const last = lastPeriodEnds.get(row.lineId);
      if (!last || row.periodEnd > last) {
        lastPeriodEnds.set(row.lineId, row.periodEnd);
      }
    }
    return { totals, lastPeriodEnds };
  }
  for (const row of rows) {
    totals.set(row.customerContractLineId, round(Number(row.total)));
    lastPeriodEnds.set(row.customerContractLineId, row.lastPeriodEnd);
  }
  return { totals, lastPeriodEnds };
}

function toPlanLines(lines: ContractLineRow[]): RevenuePlanLine[] {
  return lines.map((line) => ({
    id: line.id,
    revenueType: line.revenueType,
    revenueMethod: line.revenueMethod,
    startDate: line.startDate,
    endDate: line.endDate,
    goLiveDate: line.goLiveDate,
    revenueStartDate: line.revenueStartDate,
    revenueEndDate: line.revenueEndDate
  }));
}

/** The revenue plan of `lines` from what the invoice schedule bills them. */
export async function plannedRevenue(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow,
  lines: ContractLineRow[],
  live?: Omit<LiveSchedule, "contract" | "lines">
): Promise<ContractRevenueRow[]> {
  const billed = await billedTotals(
    trx,
    scope,
    contract.id,
    live ? { contract, lines, through: live.through } : undefined
  );
  return planRevenueSchedule({
    lines: toPlanLines(lines),
    totals: billed.totals,
    fallbackEnds: billed.lastPeriodEnds,
    recognizeRevenueFrom: contract.recognizeRevenueFrom
  });
}

type RevenueValues = {
  customerContractId: string;
  customerContractLineId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  status: ContractRevenueStatus;
  companyId: string;
  createdBy: string;
};

function revenueValues(
  scope: Scope,
  contractId: string,
  row: ContractRevenueRow
): RevenueValues {
  return {
    customerContractId: contractId,
    customerContractLineId: row.lineId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    amount: round(row.amount),
    status: row.status,
    companyId: scope.companyId,
    createdBy: scope.userId
  };
}

async function insertRevenueRows(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  rows: ContractRevenueRow[]
): Promise<void> {
  if (rows.length === 0) return;
  await trx
    .insertInto("customerContractRevenue")
    .values(rows.map((row) => revenueValues(scope, contractId, row)))
    .execute();
}

/** Persists the live revenue plan. Called on a contract with no stored
 *  revenue rows — by the first revenue edit, at Confirm, or before an Active
 *  contract confirmed before Phase B is first reconciled. */
export async function materializeRevenue(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow,
  lines: ContractLineRow[],
  live?: Omit<LiveSchedule, "contract" | "lines">
): Promise<ContractRevenueRow[]> {
  const rows = await plannedRevenue(trx, scope, contract, lines, live);
  await insertRevenueRows(trx, scope, contract.id, rows);
  return rows;
}

/** The contract's stored revenue rows, in line and month order. */
export async function loadRevenue(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  lineIds?: string[]
): Promise<StoredRevenueRow[]> {
  if (lineIds && lineIds.length === 0) return [];
  let query = trx
    .selectFrom("customerContractRevenue")
    .select([
      "id",
      "customerContractLineId",
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd"),
      "amount",
      "status"
    ])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", scope.companyId);
  if (lineIds) query = query.where("customerContractLineId", "in", lineIds);
  const rows = await query
    .orderBy("customerContractLineId")
    .orderBy("periodStart")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    lineId: row.customerContractLineId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    amount: Number(row.amount),
    status: row.status
  }));
}

/** Whether the contract has any stored revenue row. */
export async function hasStoredRevenue(
  trx: KyselyTx,
  scope: Scope,
  contractId: string
): Promise<boolean> {
  const row = await trx
    .selectFrom("customerContractRevenue")
    .select("id")
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", scope.companyId)
    .limit(1)
    .executeTakeFirst();
  return !!row;
}

/** Materializes the revenue plan when none is stored. Returns true when it
 *  wrote one. */
export async function ensureRevenue(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow,
  lines: ContractLineRow[]
): Promise<boolean> {
  if (await hasStoredRevenue(trx, scope, contract.id)) return false;
  await materializeRevenue(trx, scope, contract, lines);
  return true;
}

/**
 * Reconcile, never rewrite (D9), for each line in `lineIds`: kept rows
 * (Recognized, Recognized Externally, Planned before `from`'s month) stay; the
 * line's Planned rows from that month on are replaced by the new plan; any
 * difference to the new plan's total lands on the first month on or after
 * `from` that is not kept. One delete and one insert for every line.
 */
export async function reconcileRevenue(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow,
  lines: ContractLineRow[],
  lineIds: string[],
  from: string
): Promise<void> {
  const known = new Set(lines.map((line) => line.id));
  const ids = [...new Set(lineIds)].filter((id) => known.has(id));
  if (ids.length === 0) return;

  // A Planned month the recognition run has already synthesized (its schedule
  // rows wait in a Draft run) is in flight: it is kept like a Recognized one,
  // so the run never loses the month it is about to post.
  const inFlight = new Set(
    (
      await trx
        .selectFrom("revenueRecognitionSchedule")
        .select("customerContractRevenueId")
        .where("companyId", "=", scope.companyId)
        .where("customerContractLineId", "in", ids)
        .where("customerContractRevenueId", "is not", null)
        .execute()
    ).map((row) => row.customerContractRevenueId!)
  );
  const existing = (await loadRevenue(trx, scope, contract.id, ids)).map(
    (row) =>
      row.status === "Planned" && inFlight.has(row.id)
        ? { ...row, status: "Recognized" as const }
        : row
  );
  const planned = await plannedRevenue(trx, scope, contract, lines);

  const replaced: { lineId: string; replaceFrom: string }[] = [];
  const inserts: ContractRevenueRow[] = [];
  for (const lineId of ids) {
    const result = reconcileRevenueSchedule({
      lineId,
      existing: existing.filter((row) => row.lineId === lineId),
      planned,
      from
    });
    replaced.push({ lineId, replaceFrom: result.replaceFrom });
    inserts.push(...result.rows);
  }

  const values = replaced.map(
    (row) => sql`(${row.lineId}::text, ${row.replaceFrom}::date)`
  );
  await sql`
    DELETE FROM "customerContractRevenue" AS r
    USING (VALUES ${sql.join(values)}) AS v("lineId", "replaceFrom")
    WHERE r."customerContractLineId" = v."lineId"
      AND r."periodStart" >= v."replaceFrom"
      AND r."status" = 'Planned'
      AND r."companyId" = ${scope.companyId}
      AND r."customerContractId" = ${contract.id}
      AND NOT EXISTS (
        SELECT 1 FROM "revenueRecognitionSchedule" s
        WHERE s."customerContractRevenueId" = r."id"
          AND s."companyId" = r."companyId"
      )
  `.execute(trx);
  await insertRevenueRows(trx, scope, contract.id, inserts);
}

/** The lines whose revenue plan may have changed between two states of a
 *  contract: a line that is new, whose terms changed, or whose billed total
 *  or last billed period moved. */
export function changedRevenueLines(
  before: { lines: ContractLineRow[]; billed: BilledTotals },
  after: { lines: ContractLineRow[]; billed: BilledTotals }
): string[] {
  const previous = new Map(before.lines.map((line) => [line.id, line]));
  const changed: string[] = [];
  for (const line of after.lines) {
    const old = previous.get(line.id);
    const termsChanged =
      !old ||
      old.startDate !== line.startDate ||
      old.endDate !== line.endDate ||
      old.goLiveDate !== line.goLiveDate ||
      old.revenueStartDate !== line.revenueStartDate ||
      old.revenueEndDate !== line.revenueEndDate ||
      old.revenueMethod !== line.revenueMethod;
    const billedChanged =
      !equals(
        before.billed.totals.get(line.id) ?? 0,
        after.billed.totals.get(line.id) ?? 0
      ) ||
      before.billed.lastPeriodEnds.get(line.id) !==
        after.billed.lastPeriodEnds.get(line.id);
    if (termsChanged || billedChanged) changed.push(line.id);
  }
  return changed;
}

/**
 * D8 — the opening position of a migrated contract, written at Confirm: per
 * line, Σ its `Billed Externally` schedule rows − Σ its `Recognized
 * Externally` revenue rows, applied to an empty position at the contract's
 * rate. No journal: the customer's own opening journal carries the balance.
 */
export async function writeOpeningEntries(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow
): Promise<void> {
  const billed = await trx
    .selectFrom("customerContractInvoiceLine as r")
    .innerJoin("customerContractInvoice as i", (join) =>
      join
        .onRef("i.id", "=", "r.customerContractInvoiceId")
        .onRef("i.companyId", "=", "r.companyId")
    )
    .select([
      "r.customerContractLineId",
      sql<number>`SUM(r."amount")`.as("total")
    ])
    .where("r.customerContractId", "=", contract.id)
    .where("r.companyId", "=", scope.companyId)
    .where("i.status", "=", "Billed Externally")
    .groupBy("r.customerContractLineId")
    .execute();
  const recognized = await trx
    .selectFrom("customerContractRevenue")
    .select(["customerContractLineId", sql<number>`SUM("amount")`.as("total")])
    .where("customerContractId", "=", contract.id)
    .where("companyId", "=", scope.companyId)
    .where("status", "=", "Recognized Externally")
    .groupBy("customerContractLineId")
    .execute();

  const opening = new Map<string, number>();
  for (const row of billed) {
    opening.set(row.customerContractLineId, Number(row.total));
  }
  for (const row of recognized) {
    opening.set(
      row.customerContractLineId,
      (opening.get(row.customerContractLineId) ?? 0) - Number(row.total)
    );
  }

  const entries = [...opening]
    .map(([lineId, amount]) => ({ lineId, amount: round(amount) }))
    .filter(({ amount }) => !equals(amount, 0))
    .map(({ lineId, amount }) => {
      const movement = applyContractMovement({
        position: EMPTY_POSITION,
        amount,
        rate: Number(contract.exchangeRate),
        counterpart: "receivable"
      });
      return {
        customerContractId: contract.id,
        customerContractLineId: lineId,
        entryType: "Opening" as const,
        postingDate: contract.startDate,
        journalId: null,
        deferredAmount: movement.deferredAmount,
        deferredBase: movement.deferredBase,
        assetAmount: movement.assetAmount,
        assetBase: movement.assetBase,
        companyId: scope.companyId,
        createdBy: scope.userId
      };
    });
  if (entries.length === 0) return;
  await trx.insertInto("customerContractLedgerEntry").values(entries).execute();
}
type scheduleWritesEnums = Database["public"]["Enums"];

export type Scope = { companyId: string; userId: string };

export type ContractRow = Selectable<KyselyDatabase["customerContract"]>;

export type ContractLineRow = Selectable<
  KyselyDatabase["customerContractLine"]
>;

export type ContractInvoiceRow = {
  id: string;
  invoiceDate: string;
  status: scheduleWritesEnums["contractInvoiceStatus"];
  isEdited: boolean;
  salesInvoiceId: string | null;
};

export type LoadedContract = {
  contract: ContractRow;
  lines: ContractLineRow[];
  /** Every persisted schedule row (memo-borne ones included), as the planner
   *  reads it. */
  existing: ExistingRow[];
  /** Every planned invoice, including any left without rows. */
  invoices: ContractInvoiceRow[];
};

const DATE_TEXT = (column: string) => sql<string>`${sql.ref(column)}::text`;

/** The columns a line copy (or an added line) carries over. */
export type LineFields = Omit<
  ContractLineRow,
  | "id"
  | "companyId"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "salesOrderLineId"
>;

/** Insert values for a contract line copied from `line` with `overrides`.
 *  Every copy sets the same keys, so copies and added lines insert in one
 *  statement. The sales-order link never moves to a copy (it is unique per
 *  order line). */
export function copyLineValues(
  scope: Scope,
  line: LineFields,
  overrides: Partial<LineFields>
) {
  const merged = { ...line, ...overrides };
  return {
    customerContractId: merged.customerContractId,
    revenueType: merged.revenueType,
    itemId: merged.itemId,
    description: merged.description,
    quantity: merged.quantity,
    rate: merged.rate,
    rateUnit: merged.rateUnit,
    discountPercent: merged.discountPercent,
    discountEndsOn: merged.discountEndsOn,
    taxPercent: merged.taxPercent,
    startDate: merged.startDate,
    endDate: merged.endDate,
    goLiveDate: merged.goLiveDate,
    revenueMethod: merged.revenueMethod,
    revenueStartDate: merged.revenueStartDate,
    revenueEndDate: merged.revenueEndDate,
    amendmentId: merged.amendmentId,
    amendsLineId: merged.amendsLineId,
    salesOrderLineId: null,
    projectId: merged.projectId,
    sortOrder: merged.sortOrder,
    customFields: toJson(merged.customFields) ?? null,
    companyId: scope.companyId,
    createdBy: scope.userId
  };
}

/** The revenue dates a Recurring line's copy from `newStart` keeps. A go-live
 *  or revenue start on or before the cutover belongs to the line it was set
 *  on — inherited, the copy would recognize from that date again, on top of
 *  the line it replaces. One after the cutover has not happened yet and
 *  still applies; so does a revenue end on or after it. A One-time copy
 *  replaces its line whole, so it keeps every date. */
export function carriedRevenueDates(
  line: Pick<
    LineFields,
    "revenueType" | "goLiveDate" | "revenueStartDate" | "revenueEndDate"
  >,
  newStart: string
): Pick<LineFields, "goLiveDate" | "revenueStartDate" | "revenueEndDate"> {
  if (line.revenueType !== "Recurring") {
    return {
      goLiveDate: line.goLiveDate,
      revenueStartDate: line.revenueStartDate,
      revenueEndDate: line.revenueEndDate
    };
  }
  const after = (date: string | null) =>
    date !== null && date > newStart ? date : null;
  return {
    goLiveDate: after(line.goLiveDate),
    revenueStartDate: after(line.revenueStartDate),
    revenueEndDate:
      line.revenueEndDate !== null && line.revenueEndDate >= newStart
        ? line.revenueEndDate
        : null
  };
}

/** Lines in their display order: sort order, start date, id. */
async function loadLines(
  trx: KyselyTx,
  companyId: string,
  contractId: string
): Promise<ContractLineRow[]> {
  const lines = await trx
    .selectFrom("customerContractLine")
    .selectAll()
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", companyId)
    .orderBy("sortOrder")
    .orderBy("startDate")
    .orderBy("id")
    .execute();
  return lines.map((line) => ({
    ...line,
    quantity: Number(line.quantity),
    rate: Number(line.rate),
    discountPercent: Number(line.discountPercent),
    taxPercent: Number(line.taxPercent)
  }));
}

/** The persisted schedule rows and invoices of a contract (no lock: the
 *  caller already holds the header lock, which serializes every writer). */
export async function loadSchedule(
  trx: KyselyTx,
  companyId: string,
  contractId: string
): Promise<{ existing: ExistingRow[]; invoices: ContractInvoiceRow[] }> {
  const invoices = await trx
    .selectFrom("customerContractInvoice")
    .select([
      "id",
      DATE_TEXT("invoiceDate").as("invoiceDate"),
      "status",
      "isEdited",
      "salesInvoiceId"
    ])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", companyId)
    .orderBy("invoiceDate")
    .execute();

  const rows = await trx
    .selectFrom("customerContractInvoiceLine as r")
    .leftJoin("customerContractInvoice as i", (join) =>
      join
        .onRef("i.id", "=", "r.customerContractInvoiceId")
        .onRef("i.companyId", "=", "r.companyId")
    )
    .select([
      "r.id",
      "r.customerContractInvoiceId",
      sql<string | null>`i."invoiceDate"::text`.as("invoiceDate"),
      "i.status as invoiceStatus",
      "i.isEdited as invoiceIsEdited",
      "r.customerContractLineId",
      sql<string>`r."periodStart"::text`.as("periodStart"),
      sql<string>`r."periodEnd"::text`.as("periodEnd"),
      "r.units",
      "r.unitPrice",
      "r.amount",
      "r.isAdjustment",
      "r.memoId"
    ])
    .where("r.customerContractId", "=", contractId)
    .where("r.companyId", "=", companyId)
    .orderBy("r.periodStart")
    .orderBy("r.id")
    .execute();

  return {
    invoices: invoices.map((invoice) => ({
      ...invoice,
      isEdited: invoice.isEdited ?? false
    })),
    existing: rows.map((row) => ({
      id: row.id,
      invoiceId: row.customerContractInvoiceId,
      invoiceDate: row.invoiceDate,
      invoiceStatus: row.invoiceStatus ?? null,
      invoiceIsEdited: row.invoiceIsEdited ?? false,
      lineId: row.customerContractLineId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      units: Number(row.units),
      unitPrice: Number(row.unitPrice),
      amount: Number(row.amount),
      isAdjustment: row.isAdjustment ?? false,
      memoId: row.memoId
    }))
  };
}

/** Locks the contract header (`FOR UPDATE`) under `companyId` and loads its
 *  lines and every schedule row joined to its invoice. The lock serializes
 *  every action on one contract: a double-clicked Confirm, an amendment racing
 *  the daily invoicing job. Throws `NotFoundError` when the id is not a
 *  contract of the company. */
export async function loadContractForUpdate(
  trx: KyselyTx,
  companyId: string,
  id: string
): Promise<LoadedContract> {
  const contract = await trx
    .selectFrom("customerContract")
    .selectAll()
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!contract) throw new NotFoundError("Contract not found");

  const lines = await loadLines(trx, companyId, contract.id);
  const { existing, invoices } = await loadSchedule(
    trx,
    companyId,
    contract.id
  );
  return {
    contract: {
      ...contract,
      exchangeRate: Number(contract.exchangeRate),
      renewalUplift: Number(contract.renewalUplift)
    },
    lines,
    existing,
    invoices
  };
}

/** The contract's billing terms, as the planner reads them. */
export function toTerms(
  contract: Pick<
    ContractRow,
    | "startDate"
    | "endDate"
    | "billingFrequency"
    | "billingAlignment"
    | "billingTiming"
    | "firstInvoiceDate"
    | "billedThrough"
  >
): ContractTerms {
  return {
    startDate: contract.startDate,
    endDate: contract.endDate,
    billingFrequency: contract.billingFrequency,
    billingAlignment: contract.billingAlignment,
    billingTiming: contract.billingTiming,
    firstInvoiceDate: contract.firstInvoiceDate,
    billedThrough: contract.billedThrough
  };
}

/** The lines, as the planner reads them (input order is kept). */
export function toLineTerms(
  lines: Pick<
    ContractLineRow,
    | "id"
    | "revenueType"
    | "quantity"
    | "rate"
    | "rateUnit"
    | "discountPercent"
    | "startDate"
    | "endDate"
  >[]
): ContractLineTerms[] {
  return lines.map((line) => ({
    id: line.id,
    revenueType: line.revenueType,
    quantity: Number(line.quantity),
    rate: Number(line.rate),
    rateUnit: line.rateUnit,
    discountPercent: Number(line.discountPercent),
    startDate: line.startDate,
    endDate: line.endDate
  }));
}

/** How far a reconciliation plans: the horizon, or further when the persisted
 *  Recurring periods already reach past it — so a reconciliation never deletes
 *  rows an earlier horizon roll planned. A One-time row's service window is
 *  not a planned period (`lastRecurringPeriodEnd`): counting it would plan an
 *  open-ended contract's months out to the end of that window.
 *  `planInvoiceSchedule` still clips at the contract's end date. */
export function reconcileThrough(
  horizonDate: string,
  existing: Pick<ExistingRow, "lineId" | "periodEnd" | "isAdjustment">[],
  lines: Pick<ContractLineRow, "id" | "revenueType">[]
): string {
  const planned = lastRecurringPeriodEnd(existing, lines);
  return planned !== null && planned > horizonDate ? planned : horizonDate;
}

/** Sets each line's `endDate` in one statement. A `revenueEndDate` past the
 *  new end is clamped to it — a line recognizes nothing after it ends —
 *  unless the entry sets `revenueEndDate` itself (a reverted cancellation
 *  restoring what it clamped). */
export async function setLineEndDates(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  ends: {
    id: string;
    endDate: string | null;
    revenueEndDate?: string | null;
  }[]
): Promise<void> {
  if (ends.length === 0) return;
  const values = ends.map(
    (end) =>
      sql`(${end.id}::text, ${end.endDate}::date, ${end.revenueEndDate !== undefined}::boolean, ${end.revenueEndDate ?? null}::date)`
  );
  await sql`
    UPDATE "customerContractLine" AS l
    SET "endDate" = v."endDate",
        "revenueEndDate" = CASE
          WHEN v."setsRevenueEnd" THEN v."revenueEndDate"
          WHEN l."revenueEndDate" > v."endDate" THEN v."endDate"
          ELSE l."revenueEndDate"
        END,
        "updatedBy" = ${scope.userId},
        "updatedAt" = now()
    FROM (VALUES ${sql.join(values)}) AS v("id", "endDate", "setsRevenueEnd", "revenueEndDate")
    WHERE l."id" = v."id"
      AND l."companyId" = ${scope.companyId}
      AND l."customerContractId" = ${contractId}
  `.execute(trx);
}

/** Turns every "discount ends" date that now falls inside its line into an
 *  amendment: the line ends that day and a full-price copy starts the next
 *  (`discountEndSplits`, idempotent). Shared by confirm, amendments and
 *  renewal, so a discount ends however the line came to be. Reads the lines
 *  itself (after the caller's own writes); returns the earliest date a copy
 *  starts — the caller reconciles from there, or from earlier — or null when
 *  nothing was split. */
export async function applyDiscountEnds(
  trx: KyselyTx,
  scope: Scope,
  contract: Pick<ContractRow, "id" | "endDate" | "billingFrequency">
): Promise<string | null> {
  const lines = await loadLines(trx, scope.companyId, contract.id);
  const splits = discountEndSplits(lines, contract.endDate);
  if (splits.length === 0) return null;

  const lineTerms = toLineTerms(lines);
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const amendments = await trx
    .insertInto("customerContractAmendment")
    .values(
      splits.map((split) => {
        const before = recurringValuePerPeriod(
          lineTerms,
          contract.billingFrequency,
          split.resumesOn
        );
        const after = recurringValuePerPeriod(
          [
            ...lineTerms.filter((l) => l.id !== split.lineId),
            {
              ...lineTerms.find((l) => l.id === split.lineId)!,
              discountPercent: 0,
              startDate: split.resumesOn
            }
          ],
          contract.billingFrequency,
          split.resumesOn
        );
        return {
          customerContractId: contract.id,
          amendmentDate: split.resumesOn,
          effect: "Change Date" as const,
          contractType: suggestAmendmentType(before, after),
          reason: "Discount ends",
          previousState: null,
          companyId: scope.companyId,
          createdBy: scope.userId
        };
      })
    )
    .returning(["id"])
    .execute();

  await setLineEndDates(
    trx,
    scope,
    contract.id,
    splits.map((split) => ({ id: split.lineId, endDate: split.discountEndsOn }))
  );
  await trx
    .insertInto("customerContractLine")
    .values(
      splits.map((split, index) =>
        copyLineValues(scope, lineById.get(split.lineId)!, {
          ...carriedRevenueDates(lineById.get(split.lineId)!, split.resumesOn),
          startDate: split.resumesOn,
          discountPercent: 0,
          discountEndsOn: null,
          amendmentId: amendments[index]!.id,
          amendsLineId: split.lineId
        })
      )
    )
    .execute();

  return splits
    .map((split) => split.resumesOn)
    .reduce((earliest, date) => (date < earliest ? date : earliest));
}

type RowValues = {
  customerContractId: string;
  customerContractInvoiceId: string | null;
  customerContractLineId: string;
  periodStart: string;
  periodEnd: string;
  units: number;
  unitPrice: number;
  amount: number;
  isAdjustment: boolean;
  memoId: string | null;
  companyId: string;
  createdBy: string;
};

/** One `customerContractInvoiceLine` insert value. Every row sets the same
 *  keys, so a multi-row insert never mixes a column's DEFAULT with values. */
export function scheduleRowValues(
  scope: Scope,
  contractId: string,
  row: Pick<
    PlannedRow,
    | "lineId"
    | "periodStart"
    | "periodEnd"
    | "units"
    | "unitPrice"
    | "amount"
    | "isAdjustment"
  >,
  parent: { invoiceId: string | null; memoId: string | null }
): RowValues {
  return {
    customerContractId: contractId,
    customerContractInvoiceId: parent.invoiceId,
    customerContractLineId: row.lineId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    units: round(row.units),
    unitPrice: round(row.unitPrice),
    amount: round(row.amount),
    isAdjustment: row.isAdjustment,
    memoId: parent.memoId,
    companyId: scope.companyId,
    createdBy: scope.userId
  };
}

export async function insertScheduleRows(
  trx: KyselyTx,
  rows: RowValues[]
): Promise<void> {
  if (rows.length === 0) return;
  await trx.insertInto("customerContractInvoiceLine").values(rows).execute();
}

export const invoiceKey = (invoiceDate: string, status: string) =>
  `${invoiceDate}|${status}`;

/** Inserts one invoice per `(invoiceDate, status)` and returns their ids by
 *  that key. The keys must be unique in `wanted`. */
export async function insertContractInvoices(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  wanted: {
    invoiceDate: string;
    status: "Planned" | "Billed Externally";
    isEdited?: boolean;
  }[]
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (wanted.length === 0) return ids;
  const inserted = await trx
    .insertInto("customerContractInvoice")
    .values(
      wanted.map((invoice) => ({
        customerContractId: contractId,
        invoiceDate: invoice.invoiceDate,
        status: invoice.status,
        isEdited: invoice.isEdited ?? false,
        companyId: scope.companyId,
        createdBy: scope.userId
      }))
    )
    .returning(["id", DATE_TEXT("invoiceDate").as("invoiceDate"), "status"])
    .execute();
  for (const invoice of inserted) {
    ids.set(invoiceKey(invoice.invoiceDate, invoice.status), invoice.id);
  }
  return ids;
}

/** Writes planned invoices and their rows. */
async function insertPlannedInvoices(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  planned: ContractPlannedInvoice[]
): Promise<void> {
  const ids = await insertContractInvoices(trx, scope, contractId, planned);
  await insertScheduleRows(
    trx,
    planned.flatMap((invoice) => {
      const invoiceId = ids.get(
        invoiceKey(invoice.invoiceDate, invoice.status)
      )!;
      return invoice.rows.map((row) =>
        scheduleRowValues(scope, contractId, row, { invoiceId, memoId: null })
      );
    })
  );
}

/** Persists the computed schedule (`planInvoiceSchedule` through `through`):
 *  one `customerContractInvoice` per planned invoice, carrying its status
 *  (`Planned` / `Billed Externally`), and its rows. Called on a contract with
 *  no persisted rows — at Confirm, or by the first schedule edit. */
export async function materializeSchedule(
  trx: KyselyTx,
  scope: Scope,
  contract: ContractRow,
  lines: ContractLineRow[],
  through: string
): Promise<void> {
  const planned = planInvoiceSchedule(
    toTerms(contract),
    toLineTerms(lines),
    through
  );
  await insertPlannedInvoices(trx, scope, contract.id, planned);
}

/** Bulk update of re-cut rows: one statement for all of them. */
async function recutRows(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  recut: ContractScheduleReconciliation["recut"]
): Promise<void> {
  if (recut.length === 0) return;
  const values = recut.map(
    (row) =>
      sql`(${row.id}::text, ${row.periodEnd}::date, ${round(row.units)}::numeric, ${round(row.unitPrice)}::numeric, ${round(row.amount)}::numeric)`
  );
  await sql`
    UPDATE "customerContractInvoiceLine" AS r
    SET "periodEnd" = v."periodEnd",
        "units" = v."units",
        "unitPrice" = v."unitPrice",
        "amount" = v."amount",
        "updatedBy" = ${scope.userId},
        "updatedAt" = now()
    FROM (VALUES ${sql.join(values)}) AS v("id", "periodEnd", "units", "unitPrice", "amount")
    WHERE r."id" = v."id"
      AND r."companyId" = ${scope.companyId}
      AND r."customerContractId" = ${contractId}
  `.execute(trx);
}

/** Applies a `reconcileContractSchedule` result, in this order:
 *
 *  1. deletes the rows in `deleteRowIds`, then the `Planned` invoices in
 *     `deleteInvoiceIds` (their rows cascade);
 *  2. re-cuts the rows in `recut`;
 *  3. inserts `create` — a group joins a kept invoice with the same date and
 *     status, else it gets a new invoice;
 *  4. inserts `adjustments`. With `adjustmentMemoId` they are memo-borne
 *     (no invoice). Otherwise each attaches to the `Planned` invoice of its
 *     `invoiceDate` (a created or kept one), inserting one when none exists. */
export async function applyReconciliation(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  result: ContractScheduleReconciliation,
  options: { adjustmentMemoId?: string | null } = {}
): Promise<void> {
  const { companyId } = scope;

  if (result.deleteRowIds.length > 0) {
    await trx
      .deleteFrom("customerContractInvoiceLine")
      .where("id", "in", result.deleteRowIds)
      .where("customerContractId", "=", contractId)
      .where("companyId", "=", companyId)
      .execute();
  }
  if (result.deleteInvoiceIds.length > 0) {
    await trx
      .deleteFrom("customerContractInvoice")
      .where("id", "in", result.deleteInvoiceIds)
      .where("customerContractId", "=", contractId)
      .where("companyId", "=", companyId)
      .where("status", "=", "Planned")
      .execute();
  }

  await recutRows(trx, scope, contractId, result.recut);

  const memoId = options.adjustmentMemoId ?? null;
  const adjustmentsOnInvoices = memoId ? [] : result.adjustments;
  const invoiceIds =
    result.create.length > 0 || adjustmentsOnInvoices.length > 0
      ? await resolveInvoiceIds(trx, scope, contractId, [
          ...result.create,
          ...adjustmentsOnInvoices.map((row) => ({
            invoiceDate: row.invoiceDate,
            status: "Planned" as const
          }))
        ])
      : new Map<string, string>();

  const rows: RowValues[] = [];
  for (const invoice of result.create) {
    const invoiceId = invoiceIds.get(
      invoiceKey(invoice.invoiceDate, invoice.status)
    )!;
    for (const row of invoice.rows) {
      rows.push(
        scheduleRowValues(scope, contractId, row, { invoiceId, memoId: null })
      );
    }
  }
  for (const row of adjustmentsOnInvoices) {
    rows.push(
      scheduleRowValues(scope, contractId, row, {
        invoiceId: invoiceIds.get(invoiceKey(row.invoiceDate, "Planned"))!,
        memoId: null
      })
    );
  }
  if (memoId) {
    for (const row of result.adjustments) {
      rows.push(
        scheduleRowValues(scope, contractId, row, { invoiceId: null, memoId })
      );
    }
  }
  await insertScheduleRows(trx, rows);
}

/** The id of the contract's invoice for each wanted `(invoiceDate, status)`:
 *  an existing `Planned` / `Billed Externally` invoice with that date and
 *  status, else a new one (one insert for all the missing ones). */
export async function resolveInvoiceIds(
  trx: KyselyTx,
  scope: Scope,
  contractId: string,
  wanted: {
    invoiceDate: string;
    status: "Planned" | "Billed Externally";
  }[],
  options: { isEdited?: boolean } = {}
): Promise<Map<string, string>> {
  const existing = await trx
    .selectFrom("customerContractInvoice")
    .select(["id", DATE_TEXT("invoiceDate").as("invoiceDate"), "status"])
    .where("customerContractId", "=", contractId)
    .where("companyId", "=", scope.companyId)
    .where("status", "in", ["Planned", "Billed Externally"])
    .orderBy("id")
    .execute();
  const ids = new Map<string, string>();
  for (const invoice of existing) {
    const key = invoiceKey(invoice.invoiceDate, invoice.status);
    if (!ids.has(key)) ids.set(key, invoice.id);
  }

  const missing = new Map<
    string,
    {
      invoiceDate: string;
      status: "Planned" | "Billed Externally";
      isEdited?: boolean;
    }
  >();
  for (const invoice of wanted) {
    const key = invoiceKey(invoice.invoiceDate, invoice.status);
    if (!ids.has(key) && !missing.has(key)) {
      missing.set(key, {
        invoiceDate: invoice.invoiceDate,
        status: invoice.status,
        isEdited: options.isEdited
      });
    }
  }
  const inserted = await insertContractInvoices(trx, scope, contractId, [
    ...missing.values()
  ]);
  for (const [key, id] of inserted) ids.set(key, id);
  return ids;
}

/** Deletes the contract's `Planned` invoices that have no rows left. */
export async function deleteEmptyPlannedInvoices(
  trx: KyselyTx,
  scope: Scope,
  contractId: string
): Promise<void> {
  await trx
    .deleteFrom("customerContractInvoice as i")
    .where("i.customerContractId", "=", contractId)
    .where("i.companyId", "=", scope.companyId)
    .where("i.status", "=", "Planned")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("customerContractInvoiceLine as r")
            .select("r.id")
            .whereRef("r.customerContractInvoiceId", "=", "i.id")
            .whereRef("r.companyId", "=", "i.companyId")
        )
      )
    )
    .execute();
}

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

async function cancelContractWrites(
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

export const postCustomerContractPermission = {
  update: "sales"
} satisfies PermissionRule<z.output<typeof postCustomerContractInput>>;

/** Confirms, edits the schedule of, amends, cancels or reverts the
 *  cancellation of a customer contract, per `type`. */
export async function postCustomerContract(
  ctx: ServiceContext,
  raw: z.input<typeof postCustomerContractInput>
) {
  const payload = postCustomerContractInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
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
      return cancelContractWrites(db, scope, payload);
    case "revert-cancellation":
      return revertCancellation(db, scope, payload);
  }
}

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
          copied.map((line) => {
            // A discount that ended in the old term does not come back: the
            // copy is full price, not a discount that now never ends.
            const discountEnded =
              line.discountEndsOn !== null && line.discountEndsOn < newStart;
            return copyLineValues(scope, line, {
              rate: round(line.rate * (1 + uplift)),
              startDate: newStart,
              endDate: null,
              discountPercent: discountEnded ? 0 : line.discountPercent,
              discountEndsOn: discountEnded ? null : line.discountEndsOn,
              // The old term's go-live and revenue dates do not carry over.
              goLiveDate: null,
              revenueStartDate: null,
              revenueEndDate: null,
              amendmentId: amendment.id,
              amendsLineId: line.id
            });
          })
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
      // The contract's customer ship-to; sales rules evaluate the invoice's
      // lines against it.
      customerLocationId: contract.shipToCustomerLocationId,
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

export const createContractInvoicesPermission = {
  update: "sales",
  create: "invoicing"
} satisfies PermissionRule<z.output<typeof createContractInvoicesInput>>;

/** Drafts the contract invoices due on or before `asOf` (see
 *  `createContractInvoicesForDueInvoices`). A contract that fails is reported
 *  in `failures`, never thrown, so the others still draft. */
export async function createContractInvoices(
  ctx: ServiceContext,
  raw: z.input<typeof createContractInvoicesInput>
) {
  const { asOf, customerContractId } = createContractInvoicesInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  return createContractInvoicesForDueInvoices(db, {
    companyId,
    userId,
    asOf,
    customerContractId
  });
}
