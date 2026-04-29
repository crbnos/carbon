import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { PickPartial } from "@carbon/utils";
import { getLocalTimeZone, now, today } from "@internationalized/date";
import type {
  PostgrestError,
  PostgrestSingleResponse,
  SupabaseClient
} from "@supabase/supabase-js";
import type { z } from "zod";
import { getSupplierPriceBreaksForItems } from "~/modules/items/items.service";
import { getEmployeeJob } from "~/modules/people";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getCurrencyByCode } from "../accounting";
import type {
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator
} from "../shared";
import {
  lookupBuyPriceFromMap,
  upsertExternalLink
} from "../shared/shared.service";
import type {
  customerAccountingValidator,
  customerContactValidator,
  customerPaymentValidator,
  customerShippingValidator,
  customerStatusValidator,
  customerTypeValidator,
  customerValidator,
  getMethodValidator,
  noQuoteReasonValidator,
  pricingRuleValidator,
  quoteLineAdditionalChargesValidator,
  quoteLineValidator,
  quoteMaterialValidator,
  quoteOperationValidator,
  quotePaymentValidator,
  quoteShipmentValidator,
  quoteStatusType,
  quoteValidator,
  salesOrderLineValidator,
  salesOrderPaymentValidator,
  salesOrderShipmentValidator,
  salesOrderStatusType,
  salesOrderValidator,
  salesRFQStatusType,
  salesRfqLineValidator,
  salesRfqValidator,
  selectedLinesValidator
} from "./sales.models";
import { costCategoryKeys } from "./sales.models";
import type {
  MatchedRule,
  OverrideEntry,
  PriceListResult,
  PriceListRow,
  PriceOverrideBreak,
  PriceResolutionInput,
  PriceResolutionResult,
  PriceSource,
  PriceTraceStep,
  Quotation,
  SalesOrder,
  SalesRFQ
} from "./types";

export function applyPriceRules(
  startingPrice: number,
  matchedRules: MatchedRule[],
  unitCost: number | null = null
): { finalPrice: number; appendedTrace: PriceTraceStep[] } {
  const appendedTrace: PriceTraceStep[] = [];
  let finalPrice = startingPrice;

  const markupRules = matchedRules.filter((r) => r.ruleType === "Markup");
  const discountRules = matchedRules.filter((r) => r.ruleType === "Discount");

  // Discounts: highest priority wins (non-stacking); ties broken by best
  // effective amount against the current running price.
  if (discountRules.length > 0) {
    const ranked = discountRules
      .map((rule) => ({
        rule,
        effective:
          rule.amountType === "Percentage"
            ? finalPrice * rule.amount
            : rule.amount
      }))
      .sort((a, b) => {
        if (b.rule.priority !== a.rule.priority) {
          return b.rule.priority - a.rule.priority;
        }
        return b.effective - a.effective;
      });

    const winner = ranked[0];
    if (winner && winner.effective > 0) {
      finalPrice = clampAndTrace(
        finalPrice - winner.effective,
        unitCost,
        winner.rule,
        appendedTrace,
        {
          step: "Discount",
          source: `Rule: ${winner.rule.name}`,
          adjustment: -winner.effective,
          ruleId: winner.rule.id
        }
      );
    }
  }

  // Markups: stack in priority order (highest first), compounding on the
  // running price so ordering + basis are both deterministic.
  const sortedMarkups = [...markupRules].sort(
    (a, b) => b.priority - a.priority
  );
  for (const rule of sortedMarkups) {
    const adjustment =
      rule.amountType === "Percentage" ? finalPrice * rule.amount : rule.amount;

    finalPrice = clampAndTrace(
      finalPrice + adjustment,
      unitCost,
      rule,
      appendedTrace,
      {
        step: "Markup",
        source: `Rule: ${rule.name}`,
        adjustment,
        ruleId: rule.id
      }
    );
  }

  if (finalPrice < 0) {
    appendedTrace.push({
      step: "Floor",
      source: "Clamped to 0 (rules drove price negative)",
      amount: 0,
      adjustment: -finalPrice
    });
    finalPrice = 0;
  }

  return { finalPrice, appendedTrace };
}

// If the rule carries a minMarginPercent and cost is known, enforce the floor
// (price >= cost / (1 - margin)) and log a trace entry on clamp.
function clampAndTrace(
  proposedPrice: number,
  unitCost: number | null,
  rule: MatchedRule,
  trace: PriceTraceStep[],
  baseEntry: Omit<PriceTraceStep, "amount">
): number {
  const margin = rule.minMarginPercent;
  if (margin !== null && margin < 1 && unitCost !== null && unitCost > 0) {
    const floor = unitCost / (1 - margin);
    if (proposedPrice < floor) {
      trace.push({ ...baseEntry, amount: floor });
      trace.push({
        step: "Min Margin",
        source: `Rule: ${rule.name} (floor ${(margin * 100).toFixed(1)}%)`,
        amount: floor,
        adjustment: floor - proposedPrice,
        ruleId: rule.id
      });
      return floor;
    }
  }
  trace.push({ ...baseEntry, amount: proposedPrice });
  return proposedPrice;
}

export async function closeSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string,
  userId: string
) {
  return client
    .from("salesOrder")
    .update({
      closed: true,
      closedAt: today(getLocalTimeZone()).toString(),
      closedBy: userId
    })
    .eq("id", salesOrderId)
    .select("id")
    .single();
}

export async function convertSalesRfqToQuote(
  client: SupabaseClient<Database>,
  payload: {
    id: string;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke<{ convertedId: string }>("convert", {
    body: {
      type: "salesRfqToQuote",
      ...payload
    }
  });
}

export async function convertQuoteToOrder(
  client: SupabaseClient<Database>,
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
  return client.functions.invoke<{ convertedId: string }>("convert", {
    body: {
      type: "quoteToSalesOrder",
      ...payload
    }
  });
}

export async function copyQuoteLine(
  client: SupabaseClient<Database>,
  payload: z.infer<typeof getMethodValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke<{ copiedId: string }>("get-method", {
    body: {
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
    }
  });
}

export async function copyQuote(
  client: SupabaseClient<Database>,
  payload: Omit<z.infer<typeof getMethodValidator>, "type"> & {
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke<{ newQuoteId: string }>("get-method", {
    body: {
      ...payload,
      type: "quoteToQuote"
    }
  });
}

export async function createPricingRule(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  data: z.infer<typeof pricingRuleValidator>
) {
  return client
    .from("pricingRule")
    .insert([
      {
        name: data.name,
        ruleType: data.ruleType,
        amountType: data.amountType,
        amount: data.amount,
        minQuantity: data.minQuantity ?? null,
        maxQuantity: data.maxQuantity ?? null,
        customerIds: data.customerIds ?? [],
        customerTypeIds: data.customerTypeIds ?? [],
        itemIds: data.itemIds ?? [],
        itemPostingGroupId: data.itemPostingGroupId ?? null,
        validFrom: data.validFrom || null,
        validTo: data.validTo || null,
        priority: data.priority ?? 0,
        minMarginPercent: data.minMarginPercent ?? null,
        active: data.active ?? true,
        companyId,
        createdBy: userId
      }
    ])
    .select("id")
    .single();
}

export async function deleteCustomer(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client.from("customer").delete().eq("id", customerId);
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

export async function deleteQuoteMakeMethod(
  client: SupabaseClient<Database>,
  quoteMakeMethodId: string
) {
  return client.from("quoteMakeMethod").delete().eq("id", quoteMakeMethodId);
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

export async function deleteQuoteOperation(
  client: SupabaseClient<Database>,
  quoteOperationId: string
) {
  return client.from("quoteOperation").delete().eq("id", quoteOperationId);
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
        minMarginPercent: original.minMarginPercent,
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
    console.error(parameters.error);
    return { groups: [], parameters: [] };
  }

  if (groups.error) {
    console.error(groups.error);
    return { groups: [], parameters: [] };
  }

  return { groups: groups.data ?? [], parameters: parameters.data ?? [] };
}

export async function getCustomer(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client.from("customers").select("*").eq("id", customerId).single();
}

export async function getCustomerContact(
  client: SupabaseClient<Database>,
  customerContactId: string
) {
  return client
    .from("customerContact")
    .select(
      "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes)"
    )
    .eq("id", customerContactId)
    .single();
}

export async function getCustomerContacts(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerContact")
    .select(
      "*, contact(id, fullName, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes), user(id, active)"
    )
    .eq("customerId", customerId);
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
  customerLocationId: string
) {
  return client
    .from("customerLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, stateProvince, countryCode, country(alpha2, name), postalCode)"
    )
    .eq("id", customerLocationId)
    .single();
}

export async function getCustomerLocations(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, stateProvince, country(alpha2, name), postalCode)"
    )
    .eq("customerId", customerId);
}

export async function getCustomerPayment(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerPayment")
    .select("*")
    .eq("customerId", customerId)
    .single();
}

export async function getCustomerShipping(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerShipping")
    .select("*")
    .eq("customerId", customerId)
    .single();
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
      count: "exact"
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
    .select("id, name, customFields", { count: "exact" })
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
    .select("*", { count: "exact" })
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
      count: "exact"
    }
  );

  if (args.search) {
    query = query.or(
      `readableId.ilike.%${args.search}%,customerReference.ilike.%${args.search}%,salesOrderId.ilike.%${args.search}%`
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

  const item = await client
    .from("item")
    .select("id, type, modelUploadId")
    .eq("id", quoteLine.data.itemId)
    .single();

  if (!item.data || !item.data.modelUploadId) {
    return {
      itemId: item.data?.id ?? null,
      type: item.data?.type ?? null,
      modelPath: null
    };
  }

  const model = await client
    .from("modelUpload")
    .select("*")
    .eq("id", item.data.modelUploadId)
    .maybeSingle();

  if (!model.data) {
    return {
      itemId: item.data?.id ?? null,
      type: item.data?.type ?? null,
      modelSize: null
    };
  }

  return {
    itemId: item.data!.id,
    type: item.data!.type,
    ...model.data
  };
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
    .select("*", { count: "exact" })
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
  const result = await client.storage
    .from("private")
    .list(`${companyId}/opportunity/${opportunityId}`);

  if (result.error) {
    console.error("Failed to list opportunity documents", result.error);
    return [];
  }

  return result.data?.map((f) => ({ ...f, bucket: "opportunity" })) ?? [];
}

export async function getOpportunityLineDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  lineId: string,
  itemId?: string | null
) {
  const [opportunityLineResult, itemResult] = await Promise.all([
    client.storage
      .from("private")
      .list(`${companyId}/opportunity-line/${lineId}`),
    itemId
      ? client.storage.from("private").list(`${companyId}/parts/${itemId}`)
      : Promise.resolve({ data: [] as any[], error: null })
  ]);

  if (opportunityLineResult.error) {
    console.error(
      "Failed to list opportunity line documents",
      opportunityLineResult.error
    );
  }
  if (itemResult.error) {
    console.error("Failed to list item documents", itemResult.error);
  }

  const opportunityLineDocs =
    opportunityLineResult.data?.map((f) => ({
      ...f,
      bucket: "opportunity-line"
    })) ?? [];
  const itemDocs =
    itemResult.data?.map((f) => ({ ...f, bucket: "parts" })) ?? [];

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
    .select("*", { count: "exact" })
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

export async function getQuoteFavorites(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
) {
  return client
    .from("quoteFavorite")
    .select("*")
    .eq("companyId", companyId)
    .eq("userId", userId);
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
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `quoteId.ilike.%${args.search}%,customerReference.ilike.%${args.search}%`
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

export async function getQuoteAssembliesByLine(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client
    .from("quoteMakeMethod")
    .select("*")
    .eq("quoteLineId", quoteLineId);
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
      // @ts-ignore
      lookup[itemId] = { id: itemId, children: [] };
    }

    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore
        lookup[parentId] = { id: parentId, children: [] };
      }

      // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
      lookup[parentId]["children"].push(treeItem);
    }
  }
  return rootItems;
  // return rootItems.map((item) => traverseAndRenameIds(item));
}

export async function getQuoteLines(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client
    .from("quoteLines")
    .select("*")
    .eq("quoteId", quoteId)
    .order("itemReadableId", { ascending: true });
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

export async function getQuoteLinePricesByQuoteId(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteId", quoteId)
    .order("quoteLineId", { ascending: true });
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

export async function getQuoteMaterials(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quoteMaterial").select("*").eq("quoteId", quoteId);
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

export async function getQuoteOperations(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quoteOperation").select("*").eq("quoteId", quoteId);
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

export async function getSalesOrderFavorites(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
) {
  return client
    .from("salesOrderFavorite")
    .select("*")
    .eq("companyId", companyId)
    .eq("userId", userId);
}

export async function getSalesOrderRelatedItems(
  client: SupabaseClient<Database>,
  salesOrderId: string,
  opportunityId: string
) {
  const [jobs, shipments, invoices] = await Promise.all([
    client.from("job").select("*").eq("salesOrderId", salesOrderId),
    client
      .from("shipment")
      .select("*, shipmentLine(*)")
      .eq("opportunityId", opportunityId),
    client
      .from("salesInvoice")
      .select("id, invoiceId, status")
      .eq("opportunityId", opportunityId)
  ]);

  return {
    jobs: jobs.data ?? [],
    shipments: shipments.data ?? [],
    invoices: invoices.data ?? []
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
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `salesOrderId.ilike.%${args.search}%,customerReference.ilike.%${args.search}%`
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
    .select("id, invoiceTotal, status, currencyCode")
    .in("id", invoiceIds);
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

export async function getSalesRFQFavorites(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
) {
  return client
    .from("salesRfqFavorite")
    .select("*")
    .eq("companyId", companyId)
    .eq("userId", userId);
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
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `rfqId.ilike.%${args.search}%,customerReference.ilike.%${args.search}%`
    );
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
        customFields: customerLocation.customFields
      }
    ])
    .select("id")
    .single();
}

export async function insertSalesOrderLines(
  client: SupabaseClient<Database>,
  salesOrderLines: (Omit<z.infer<typeof salesOrderLineValidator>, "id"> & {
    companyId: string;
    createdBy: string;
    customFields?: Json;
  })[]
) {
  return client.from("salesOrderLine").insert(salesOrderLines).select("id");
}

export async function finalizeQuote(
  client: SupabaseClient<Database>,
  quoteId: string,
  userId: string
) {
  const quoteUpdate = await client
    .from("quote")
    .update({
      status: "Sent",
      updatedAt: today(getLocalTimeZone()).toString(),
      updatedBy: userId
    })
    .eq("id", quoteId);

  if (quoteUpdate.error) {
    return quoteUpdate;
  }

  return client
    .from("quoteLine")
    .update({
      status: "Complete",
      updatedAt: today(getLocalTimeZone()).toString(),
      updatedBy: userId
    })
    .neq("status", "No Quote")
    .eq("quoteId", quoteId);
}

export async function releaseSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string,
  userId: string
) {
  return client
    .from("salesOrder")
    .update({
      status: "To Ship and Invoice",
      updatedAt: today(getLocalTimeZone()).toString(),
      updatedBy: userId
    })
    .eq("id", salesOrderId);
}

export async function resolvePrice(
  client: SupabaseClient<Database>,
  companyId: string,
  input: PriceResolutionInput
): Promise<PriceResolutionResult> {
  const date = input.date ?? new Date().toISOString().split("T")[0]!;
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

  // Pull posting group + unit cost from itemCost. The posting group is needed
  // to match rules scoped to itemPostingGroupId; the unit cost feeds
  // rule-level minMarginPercent clamps.
  let resolvedItemPostingGroupId = input.itemPostingGroupId ?? null;
  let unitCost: number | null = null;
  const { data: costRow } = await client
    .from("itemCost")
    .select("itemPostingGroupId, unitCost")
    .eq("itemId", input.itemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (costRow) {
    if (!resolvedItemPostingGroupId) {
      resolvedItemPostingGroupId = costRow.itemPostingGroupId ?? null;
    }
    unitCost = costRow.unitCost ?? null;
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

  let finalPrice = startingPrice;
  if (!skipRules) {
    let rulesQuery = client
      .from("pricingRule")
      .select("*")
      .eq("companyId", companyId)
      .eq("active", true);

    rulesQuery = rulesQuery.or(`validFrom.is.null,validFrom.lte.${date}`);
    rulesQuery = rulesQuery.or(`validTo.is.null,validTo.gte.${date}`);

    const { data: allRules } = await rulesQuery;

    const matchedRules: MatchedRule[] = (allRules ?? []).filter((rule) => {
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
    }) as MatchedRule[];

    const ruleResult = applyPriceRules(startingPrice, matchedRules, unitCost);
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
  const date = new Date().toISOString().split("T")[0]!;
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
      "id, readableId, name, thumbnailPath, itemUnitSalePrice(unitSalePrice), itemCost(itemPostingGroupId, unitCost)",
      { count: "exact" }
    )
    .eq("active", true)
    .in("id", overriddenItemIds);

  if (args.search) {
    itemQuery = itemQuery.or(
      `name.ilike.%${args.search}%,readableId.ilike.%${args.search}%`
    );
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
    const unitCost = itemCostRow?.unitCost ?? null;
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
      const matchedRules: MatchedRule[] = (allRules ?? []).filter((rule) => {
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

      const ruleResult = applyPriceRules(startingPrice, matchedRules, unitCost);
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
      { count: "exact" }
    )
    .eq("companyId", companyId)
    .eq("active", true);

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableId.ilike.%${args.search}%`
    );
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
      .select("id, name")
      .single();
  }
  return client
    .from("customer")
    .update({
      ...sanitize(customer),
      updatedAt: today(getLocalTimeZone()).toString()
    })
    .eq("id", customer.id)
    .select("id")
    .single();
}

export async function upsertCustomerItemPriceOverride(
  client: SupabaseClient<Database>,
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

  const sortedBreaks = [...data.breaks].sort((a, b) => a.quantity - b.quantity);

  const parentFields = {
    notes: data.notes ?? null,
    validFrom: data.validFrom ?? null,
    validTo: data.validTo ?? null,
    active: data.active,
    applyRulesOnTop: data.applyRulesOnTop
  };

  let parentId: string | null = null;
  let parentError: unknown = null;

  if (data.id) {
    const { data: row, error } = await client
      .from("customerItemPriceOverride")
      .update({
        ...parentFields,
        customerId: data.customerId ?? null,
        customerTypeId: data.customerTypeId ?? null,
        itemId: data.itemId,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .eq("companyId", companyId)
      .select("id")
      .single();
    parentId = row?.id ?? null;
    parentError = error;
  } else {
    // Collapse onto an existing (scope, item) row if one exists — the partial
    // unique indexes would reject a duplicate insert anyway.
    const lookup = client
      .from("customerItemPriceOverride")
      .select("id")
      .eq("itemId", data.itemId)
      .eq("companyId", companyId);

    const scopedLookup = data.customerId
      ? lookup.eq("customerId", data.customerId)
      : data.customerTypeId
        ? lookup.eq("customerTypeId", data.customerTypeId)
        : lookup.is("customerId", null).is("customerTypeId", null);
    const { data: existing } = await scopedLookup.maybeSingle();

    if (existing) {
      const { data: row, error } = await client
        .from("customerItemPriceOverride")
        .update({
          ...parentFields,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", existing.id)
        .select("id")
        .single();
      parentId = row?.id ?? null;
      parentError = error;
    } else {
      const { data: row, error } = await client
        .from("customerItemPriceOverride")
        .insert({
          ...parentFields,
          customerId: data.customerId ?? null,
          customerTypeId: data.customerTypeId ?? null,
          itemId: data.itemId,
          companyId,
          createdBy: userId
        })
        .select("id")
        .single();
      parentId = row?.id ?? null;
      parentError = error;
    }
  }

  if (parentError || !parentId) {
    return { data: null, error: parentError };
  }

  // Identity-preserving sync so the audit log shows one UPDATE per actually-
  // changed rung instead of a churn of DELETE+INSERT on every save. The form
  // round-trips each break's id — rows with known ids update in place, rows
  // without ids insert, rows missing from the submission delete.
  const { data: existingRows, error: fetchExistingError } = await client
    .from("customerItemPriceOverrideBreak")
    .select("id")
    .eq("customerItemPriceOverrideId", parentId)
    .eq("companyId", companyId);
  if (fetchExistingError) {
    return { data: null, error: fetchExistingError };
  }

  const existingIds = new Set((existingRows ?? []).map((r) => r.id));
  const submittedIds = new Set(
    sortedBreaks
      .map((b) => b.id)
      .filter((id): id is string => typeof id === "string")
  );

  const toDelete = [...existingIds].filter((id) => !submittedIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await client
      .from("customerItemPriceOverrideBreak")
      .delete()
      .in("id", toDelete)
      .eq("companyId", companyId);
    if (error) return { data: null, error };
  }

  // Updates go one-at-a-time. Edge case: if the user swaps quantities between
  // two existing rungs (A 5↔10 B), the mid-batch state transiently violates
  // the (parent, quantity) UNIQUE constraint. In that narrow case the save
  // returns an error and the user saves again. Worth it for the clean audit.
  const updateTimestamp = new Date().toISOString();
  for (const b of sortedBreaks) {
    if (!b.id || !existingIds.has(b.id)) continue;
    const { error } = await client
      .from("customerItemPriceOverrideBreak")
      .update({
        quantity: b.quantity,
        overridePrice: b.overridePrice,
        active: b.active,
        updatedBy: userId,
        updatedAt: updateTimestamp
      })
      .eq("id", b.id)
      .eq("companyId", companyId);
    if (error) return { data: null, error };
  }

  const toInsert = sortedBreaks.filter((b) => !b.id || !existingIds.has(b.id));
  if (toInsert.length > 0) {
    const { error } = await client
      .from("customerItemPriceOverrideBreak")
      .insert(
        toInsert.map((b) => ({
          customerItemPriceOverrideId: parentId as string,
          quantity: b.quantity,
          overridePrice: b.overridePrice,
          active: b.active,
          companyId,
          createdBy: userId
        }))
      );
    if (error) return { data: null, error };
  }

  return { data: { id: parentId }, error: null };
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

export async function getCustomerItemPriceOverrideById(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("customerItemPriceOverride")
    .select(
      `
      *,
      customer:customerId(id, name),
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
      customer:customerId(id, name),
      customerType:customerTypeId(id, name),
      item:itemId(id, name, unitSalePrice:itemUnitSalePrice(unitSalePrice))
    `,
      { count: "exact" }
    )
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `item.name.ilike.%${args.search}%,customer.name.ilike.%${args.search}%,notes.ilike.%${args.search}%`
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

export async function updateCustomerAccounting(
  client: SupabaseClient<Database>,
  customerAccounting: z.infer<typeof customerAccountingValidator> & {
    updatedBy: string;
  }
) {
  return client
    .from("customer")
    .update(sanitize(customerAccounting))
    .eq("id", customerAccounting.id);
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
  return client
    .from("contact")
    .update(sanitize(customerContact.contact))
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
        ...data,
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

export async function updateSalesRFQLineOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("salesRfqLine").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
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
  client: SupabaseClient<Database>,
  quoteLineId: string,
  precision: number
) {
  return client
    .from("quoteLine")
    .update({ unitPricePrecision: precision })
    .eq("id", quoteLineId)
    .select("id")
    .single();
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
      ? { completedDate: now(getLocalTimeZone()).toAbsoluteString() }
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
    ...(status === "Sent"
      ? { completedDate: now(getLocalTimeZone()).toAbsoluteString() }
      : {})
  };
  return client.from("quote").update(updateData).eq("id", update.id);
}

export async function upsertMakeMethodFromQuoteLine(
  client: SupabaseClient<Database>,
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
  return client.functions.invoke("get-method", {
    body: {
      type: "quoteLineToItem",
      sourceId: `${lineMethod.quoteId}:${lineMethod.quoteLineId}`,
      targetId: lineMethod.itemId,
      companyId: lineMethod.companyId,
      userId: lineMethod.userId,
      parts: lineMethod.parts
    }
  });
}

export async function upsertMakeMethodFromQuoteMethod(
  client: SupabaseClient<Database>,
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
  const { error } = await client.functions.invoke("get-method", {
    body: {
      type: "quoteMakeMethodToItem",
      sourceId: quoteMethod.sourceId,
      targetId: quoteMethod.targetId,
      companyId: quoteMethod.companyId,
      userId: quoteMethod.userId,
      parts: quoteMethod.parts
    }
  });

  if (error) {
    return {
      data: null,
      error: { message: "Failed to save method" } as PostgrestError
    };
  }

  return { data: null, error: null };
}

export async function upsertQuote(
  client: SupabaseClient<Database>,
  quote:
    | (Omit<z.infer<typeof quoteValidator>, "id" | "quoteId"> & {
        quoteId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quoteValidator>, "id" | "quoteId"> & {
        id: string;
        quoteId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in quote) {
    const [customerPayment, customerShipping, employee, opportunity] =
      await Promise.all([
        getCustomerPayment(client, quote.customerId),
        getCustomerShipping(client, quote.customerId),
        getEmployeeJob(client, quote.createdBy, quote.companyId),
        client
          .from("opportunity")
          .insert([
            { companyId: quote.companyId, customerId: quote.customerId }
          ])
          .select("id")
          .single()
      ]);

    if (customerPayment.error) return customerPayment;
    if (customerShipping.error) return customerShipping;

    const {
      paymentTermId,
      invoiceCustomerId,
      invoiceCustomerContactId,
      invoiceCustomerLocationId
    } = customerPayment.data;

    const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
      customerShipping.data;

    if (quote.currencyCode) {
      const currency = await getCurrencyByCode(
        client,
        quote.companyId,
        quote.currencyCode
      );
      if (currency.data) {
        quote.exchangeRate = currency.data.exchangeRate ?? undefined;
        quote.exchangeRateUpdatedAt = new Date().toISOString();
      }
    } else {
      quote.exchangeRate = 1;
      quote.exchangeRateUpdatedAt = new Date().toISOString();
    }

    const locationId = employee?.data?.locationId ?? null;
    const insert = await client
      .from("quote")
      .insert([
        {
          ...quote,
          opportunityId: opportunity.data?.id
        }
      ])
      .select("id, quoteId");
    if (insert.error) {
      return insert;
    }

    const quoteId = insert.data?.[0]?.id;
    if (!quoteId) return insert;

    const [shipment, payment, externalLink] = await Promise.all([
      client.from("quoteShipment").insert([
        {
          id: quoteId,
          locationId: locationId,
          shippingMethodId: shippingMethodId,
          shippingTermId: shippingTermId,
          incoterm: incoterm,
          incotermLocation: incotermLocation,
          companyId: quote.companyId
        }
      ]),
      client.from("quotePayment").insert([
        {
          id: quoteId,
          invoiceCustomerId: invoiceCustomerId,
          invoiceCustomerContactId: invoiceCustomerContactId,
          invoiceCustomerLocationId: invoiceCustomerLocationId,
          paymentTermId: paymentTermId,
          companyId: quote.companyId
        }
      ]),
      upsertExternalLink(client, {
        documentType: "Quote",
        documentId: quoteId,
        customerId: quote.customerId,
        expiresAt: quote.expirationDate,
        companyId: quote.companyId
      })
    ]);

    if (shipment.error) {
      await deleteQuote(client, quoteId);
      return payment;
    }
    if (payment.error) {
      await deleteQuote(client, quoteId);
      return payment;
    }
    if (opportunity.error) {
      await deleteQuote(client, quoteId);
      return opportunity;
    }
    if (externalLink.data) {
      await client
        .from("quote")
        .update({ externalLinkId: externalLink.data.id })
        .eq("id", quoteId);
    }

    return insert;
  } else {
    // Only update the exchange rate if the currency code has changed
    const existingQuote = await client
      .from("quote")
      .select("companyId, currencyCode, opportunityId")
      .eq("id", quote.id)
      .single();

    if (existingQuote.error) return existingQuote;

    const { companyId, currencyCode, opportunityId } = existingQuote.data;

    if (quote.currencyCode && currencyCode !== quote.currencyCode) {
      const currency = await getCurrencyByCode(
        client,
        companyId,
        quote.currencyCode
      );
      if (currency.data) {
        quote.exchangeRate = currency.data.exchangeRate ?? undefined;
        quote.exchangeRateUpdatedAt = new Date().toISOString();
      }
    }

    // If customerId is being updated, also update the opportunity's customerId
    if (quote.customerId && opportunityId) {
      await client
        .from("opportunity")
        .update({ customerId: quote.customerId })
        .eq("id", opportunityId);
    }

    return client
      .from("quote")
      .update({
        ...sanitize(quote),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", quote.id);
  }
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
  return client.from("quoteLine").insert([quotationLine]).select("*").single();
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

export async function upsertQuoteLinePrices(
  client: SupabaseClient<Database>,
  quoteId: string,
  lineId: string,
  quoteLinePrices: {
    quoteLineId: string;
    unitPrice: number;
    leadTime: number;
    discountPercent: number;
    quantity: number;
    createdBy: string;
    categoryMarkups?: Record<string, number>;
  }[]
) {
  const existingPrices = await client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteLineId", lineId);
  if (existingPrices.error) {
    return existingPrices;
  }

  const deletePrices = await client
    .from("quoteLinePrice")
    .delete()
    .eq("quoteLineId", lineId);
  if (deletePrices.error) {
    return deletePrices;
  }

  const quoteExchangeRate = await client
    .from("quote")
    .select("id, exchangeRate")
    .eq("id", quoteId)
    .single();

  const quoteLineUnitPricePrecision = await client
    .from("quoteLine")
    .select("unitPricePrecision")
    .eq("id", lineId)
    .single();

  const pricesByQuantity = existingPrices.data.reduce<
    Record<
      number,
      {
        discountPercent: number;
        leadTime: number;
        categoryMarkups: unknown;
      }
    >
  >((acc, price) => {
    acc[price.quantity] = price;
    return acc;
  }, {});

  const pricesWithExistingDiscountsAndLeadTimes = quoteLinePrices.map((p) => {
    const existing = pricesByQuantity[p.quantity];
    const roundedUnitPrice = Number(
      p.unitPrice.toFixed(
        quoteLineUnitPricePrecision.data?.unitPricePrecision ?? 2
      )
    );

    return {
      ...p,
      unitPrice: roundedUnitPrice,
      discountPercent: existing?.discountPercent ?? p.discountPercent,
      leadTime: existing?.leadTime ?? p.leadTime,
      categoryMarkups: p.categoryMarkups ?? existing?.categoryMarkups ?? {},
      quoteId: quoteId,
      exchangeRate: quoteExchangeRate.data?.exchangeRate ?? 1
    };
  });

  return (
    client
      .from("quoteLinePrice")
      // @ts-expect-error - categoryMarkups is a Json object
      .insert(pricesWithExistingDiscountsAndLeadTimes)
  );
}

async function buildCostEffects(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  const operationsResult = await client
    .from("quoteOperation")
    .select("*")
    .eq("quoteLineId", quoteLineId);

  const operations = operationsResult.data ?? [];

  // Fix Buy material costs
  const buyMaterials = await client
    .from("quoteMaterial")
    .select("id, itemId, unitCost")
    .eq("quoteLineId", quoteLineId)
    .eq("methodType", "Purchase to Order");

  const buyItemIds = [
    ...new Set((buyMaterials.data ?? []).map((m) => m.itemId))
  ];
  const priceMap = await getSupplierPriceBreaksForItems(client, buyItemIds);

  for (const mat of buyMaterials.data ?? []) {
    const price = lookupBuyPriceFromMap(mat.itemId, 1, priceMap, mat.unitCost);
    if (price !== mat.unitCost) {
      await client
        .from("quoteMaterial")
        .update({ unitCost: price })
        .eq("id", mat.id);
    }
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
    unitCost: number
  ) {
    const costFn = (outerQty: number) => {
      const requestedQty = quantity * outerQty;
      return (
        lookupBuyPriceFromMap(itemId, requestedQty, priceMap, unitCost) *
        requestedQty
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
      pushBuyCostEffect(d.itemId, d.itemType, qty, d.unitCost);
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
      if (op.operationType === "Inside") {
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
      } else if (op.operationType === "Outside") {
        effects.outsideCost.push((outerQty) => {
          const cost = op.operationUnitCost * qty * outerQty;
          return Math.max(op.operationMinimumCost, cost);
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

export async function calculatePricesForQuantities(
  client: SupabaseClient<Database>,
  quoteId: string,
  quoteLineId: string,
  quantities: number[],
  userId: string
) {
  if (!quantities.length) return { error: null };

  // 1. Fetch quote (with companyId + customerId) and line in parallel
  const [quoteResult, lineResult] = await Promise.all([
    client
      .from("quote")
      .select("companyId, customerId, exchangeRate")
      .eq("id", quoteId)
      .single(),
    client
      .from("quoteLine")
      .select("itemId, unitPricePrecision")
      .eq("id", quoteLineId)
      .single()
  ]);

  if (quoteResult.error) return { error: quoteResult.error };
  if (lineResult.error) return { error: lineResult.error };

  // Fetch settings filtered by company (required for service-role access)
  const settingsResult = await client
    .from("companySettings")
    .select("quoteLineCategoryMarkups")
    .eq("id", quoteResult.data.companyId)
    .single();

  if (settingsResult.error) return { error: settingsResult.error };

  const companyId = quoteResult.data.companyId;
  const customerId = quoteResult.data.customerId ?? undefined;
  const itemId = lineResult.data.itemId ?? undefined;
  const exchangeRate = quoteResult.data.exchangeRate ?? 1;
  const precision = lineResult.data.unitPricePrecision ?? 2;

  // Parse default markups (settings stores decimals, convert to whole numbers)
  const rawMarkups =
    (settingsResult.data.quoteLineCategoryMarkups as Record<string, number>) ??
    {};
  const defaultMarkups: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawMarkups)) {
    defaultMarkups[key] = value * 100;
  }

  // 2. Build cost effects
  const result = await buildCostEffects(client, quoteLineId);
  // buildCostEffects returns null when the line has no costed method yet —
  // treat as a no-op so partial drafts don't block the save.
  if (!result) return { error: null };

  const { effects } = result;

  const priceRows = [];
  for (const qty of quantities) {
    const categoryCosts: Record<string, number> = {};
    for (const key of costCategoryKeys) {
      const total = effects[key].reduce((acc, fn) => acc + fn(qty), 0);
      categoryCosts[key] = qty > 0 ? total / qty : 0;
    }

    const rollupPrice = costCategoryKeys.reduce((sum, key) => {
      const cost = categoryCosts[key] ?? 0;
      const markup = defaultMarkups[key] ?? 0;
      return sum + cost * (1 + markup / 100);
    }, 0);

    const finalPrice = itemId
      ? (
          await resolvePrice(client, companyId, {
            itemId,
            quantity: qty,
            customerId,
            existingBasePrice: rollupPrice
          })
        ).finalPrice
      : rollupPrice;

    priceRows.push({
      quoteId,
      quoteLineId,
      quantity: qty,
      unitPrice: Number(finalPrice.toFixed(precision)),
      categoryMarkups: defaultMarkups,
      exchangeRate,
      createdBy: userId,
      leadTime: 0,
      discountPercent: 0
    });
  }

  const insertResult = await client.from("quoteLinePrice").insert(priceRows);
  if (insertResult.error) {
    console.error("[qpricing][MtO calc] INSERT ERROR", {
      quoteLineId,
      error: insertResult.error
    });
    return { error: insertResult.error };
  }
  return { error: null };
}

export async function resolveQuoteLinePrices(
  client: SupabaseClient<Database>,
  companyId: string,
  quoteId: string,
  quoteLineId: string,
  quantities: number[],
  userId: string
) {
  if (!quantities.length) return { error: null };

  const [quoteResult, lineResult] = await Promise.all([
    client
      .from("quote")
      .select("customerId, exchangeRate")
      .eq("id", quoteId)
      .single(),
    client
      .from("quoteLine")
      .select("itemId, unitPricePrecision")
      .eq("id", quoteLineId)
      .single()
  ]);

  if (quoteResult.error) return { error: quoteResult.error };
  if (lineResult.error) return { error: lineResult.error };
  // Missing itemId is a benign draft state, not an error.
  if (!lineResult.data.itemId) return { error: null };

  const itemId = lineResult.data.itemId;
  const exchangeRate = quoteResult.data.exchangeRate ?? 1;
  const precision = lineResult.data.unitPricePrecision ?? 2;
  const customerId = quoteResult.data.customerId ?? undefined;

  const priceRows = [];
  for (const qty of quantities) {
    const resolved = await resolvePrice(client, companyId, {
      itemId,
      quantity: qty,
      customerId
    });

    priceRows.push({
      quoteId,
      quoteLineId,
      quantity: qty,
      unitPrice: Number(resolved.finalPrice.toFixed(precision)),
      exchangeRate,
      createdBy: userId,
      leadTime: 0,
      discountPercent: 0
    });
  }

  const insertResult = await client.from("quoteLinePrice").insert(priceRows);
  if (insertResult.error) {
    console.error("[qpricing][Pull] INSERT ERROR", {
      quoteLineId,
      error: insertResult.error
    });
    return { error: insertResult.error };
  }
  return { error: null };
}

export async function resolvePurchaseToOrderPrices(
  client: SupabaseClient<Database>,
  companyId: string,
  quoteId: string,
  quoteLineId: string,
  quantities: number[],
  userId: string
) {
  if (!quantities.length) return { error: null };

  const [quoteResult, lineResult] = await Promise.all([
    client
      .from("quote")
      .select("customerId, exchangeRate")
      .eq("id", quoteId)
      .single(),
    client
      .from("quoteLine")
      .select("itemId, unitPricePrecision")
      .eq("id", quoteLineId)
      .single()
  ]);

  if (quoteResult.error) return { error: quoteResult.error };
  if (lineResult.error) return { error: lineResult.error };
  if (!lineResult.data.itemId) return { error: null };

  const itemId = lineResult.data.itemId;
  const exchangeRate = quoteResult.data.exchangeRate ?? 1;
  const precision = lineResult.data.unitPricePrecision ?? 2;
  const customerId = quoteResult.data.customerId ?? undefined;

  const priceMap = await getSupplierPriceBreaksForItems(client, [itemId]);

  const priceRows = [];
  for (const qty of quantities) {
    const supplierPrice = lookupBuyPriceFromMap(itemId, qty, priceMap, 0);
    const resolved = await resolvePrice(client, companyId, {
      itemId,
      quantity: qty,
      customerId,
      existingBasePrice: supplierPrice
    });

    priceRows.push({
      quoteId,
      quoteLineId,
      quantity: qty,
      unitPrice: Number(resolved.finalPrice.toFixed(precision)),
      exchangeRate,
      createdBy: userId,
      leadTime: 0,
      discountPercent: 0
    });
  }

  const insertResult = await client.from("quoteLinePrice").insert(priceRows);
  if (insertResult.error) {
    console.error("[qpricing][P2O] INSERT ERROR", {
      quoteLineId,
      error: insertResult.error
    });
    return { error: insertResult.error };
  }
  return { error: null };
}

export async function recalculateQuoteLinePrices(
  client: SupabaseClient<Database>,
  quoteId: string,
  quoteLineId: string,
  userId: string
) {
  // 1. Fetch existing price rows
  const existingPrices = await client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteLineId", quoteLineId);

  if (existingPrices.error) return { error: existingPrices.error };
  if (!existingPrices.data?.length) return { error: null };

  // 2. Fetch line precision and company + customer context for engine pipe-through
  const [lineResult, quoteResult] = await Promise.all([
    client
      .from("quoteLine")
      .select("itemId, unitPricePrecision")
      .eq("id", quoteLineId)
      .single(),
    client
      .from("quote")
      .select("companyId, customerId")
      .eq("id", quoteId)
      .single()
  ]);

  const precision = lineResult.data?.unitPricePrecision ?? 2;
  const itemId = lineResult.data?.itemId ?? undefined;
  const companyId = quoteResult.data?.companyId;
  const customerId = quoteResult.data?.customerId ?? undefined;

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
  const result = await buildCostEffects(client, quoteLineId);
  if (!result) return { error: null };

  const { effects } = result;

  const updatedRows = [];
  for (const row of existingPrices.data) {
    const qty = row.quantity;
    const rowMarkups = (row.categoryMarkups as Record<string, number>) ?? {};
    const markups =
      Object.keys(rowMarkups).length > 0 ? rowMarkups : defaultMarkups;

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

    const finalPrice =
      itemId && companyId
        ? (
            await resolvePrice(client, companyId, {
              itemId,
              quantity: qty,
              customerId,
              existingBasePrice: rollupPrice
            })
          ).finalPrice
        : rollupPrice;

    updatedRows.push({
      quoteId: row.quoteId,
      quoteLineId: row.quoteLineId,
      quantity: row.quantity,
      unitPrice: Number(finalPrice.toFixed(precision)),
      categoryMarkups: markups,
      exchangeRate: row.exchangeRate,
      createdBy: row.createdBy,
      updatedBy: userId,
      leadTime: row.leadTime,
      discountPercent: row.discountPercent
    });
  }

  // 5. Delete existing and re-insert with updated prices
  const deleteResult = await client
    .from("quoteLinePrice")
    .delete()
    .eq("quoteLineId", quoteLineId);

  if (deleteResult.error) {
    console.error("[qpricing][recalc] DELETE ERROR", {
      quoteLineId,
      error: deleteResult.error
    });
    return { error: deleteResult.error };
  }

  const insertResult = await client.from("quoteLinePrice").insert(updatedRows);
  if (insertResult.error) {
    console.error("[qpricing][recalc] INSERT ERROR", {
      quoteLineId,
      error: insertResult.error
    });
    return { error: insertResult.error };
  }
  return { error: null };
}

export async function upsertQuoteLineMethod(
  client: SupabaseClient<Database>,
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

  return client.functions.invoke("get-method", {
    body
  });
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
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("updatedBy" in quoteMaterial) {
    return client
      .from("quoteMaterial")
      .update(sanitize(quoteMaterial))
      .eq("id", quoteMaterial.id)
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

  const { error } = await client.functions.invoke("get-method", {
    body
  });

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
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in operation) {
    return client
      .from("quoteOperation")
      .insert([operation])
      .select("id")
      .single();
  }
  return client
    .from("quoteOperation")
    .update(sanitize(operation))
    .eq("id", operation.id)
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
      ? { completedDate: now(getLocalTimeZone()).toAbsoluteString() }
      : {})
  };

  return client.from("salesOrder").update(updateData).eq("id", update.id);
}

export async function upsertSalesOrder(
  client: SupabaseClient<Database>,
  salesOrder:
    | (Omit<z.infer<typeof salesOrderValidator>, "id" | "salesOrderId"> & {
        salesOrderId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesOrderValidator>, "id" | "salesOrderId"> & {
        id: string;
        salesOrderId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesOrder) {
    // Only update the exchange rate if the currency code has changed
    const existingSalesOrder = await client
      .from("salesOrder")
      .select("companyId, currencyCode, opportunityId")
      .eq("id", salesOrder.id)
      .single();

    if (existingSalesOrder.error) return existingSalesOrder;

    const { companyId, currencyCode, opportunityId } = existingSalesOrder.data;

    if (salesOrder.currencyCode && currencyCode !== salesOrder.currencyCode) {
      const currency = await getCurrencyByCode(
        client,
        companyId,
        salesOrder.currencyCode
      );
      if (currency.data) {
        salesOrder.exchangeRate = currency.data.exchangeRate ?? undefined;
        salesOrder.exchangeRateUpdatedAt = new Date().toISOString();
      }
    }

    // If customerId is being updated, also update the opportunity's customerId
    if (salesOrder.customerId && opportunityId) {
      await client
        .from("opportunity")
        .update({ customerId: salesOrder.customerId })
        .eq("id", opportunityId);
    }

    return client
      .from("salesOrder")
      .update(sanitize(salesOrder))
      .eq("id", salesOrder.id)
      .select("id, salesOrderId");
  }

  const [customerPayment, customerShipping, employee, opportunity] =
    await Promise.all([
      getCustomerPayment(client, salesOrder.customerId),
      getCustomerShipping(client, salesOrder.customerId),
      getEmployeeJob(client, salesOrder.createdBy, salesOrder.companyId),
      client
        .from("opportunity")
        .insert([
          {
            companyId: salesOrder.companyId,
            customerId: salesOrder.customerId
          }
        ])
        .select("id")
        .single()
    ]);

  if (customerPayment.error) return customerPayment;
  if (customerShipping.error) return customerShipping;

  const {
    paymentTermId,
    invoiceCustomerId,
    invoiceCustomerContactId,
    invoiceCustomerLocationId
  } = customerPayment.data;

  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    customerShipping.data;

  const locationId = employee?.data?.locationId ?? null;

  if (salesOrder.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      salesOrder.companyId,
      salesOrder.currencyCode
    );
    if (currency.data) {
      salesOrder.exchangeRate = currency.data.exchangeRate ?? undefined;
      salesOrder.exchangeRateUpdatedAt = new Date().toISOString();
    }
  } else {
    salesOrder.exchangeRate = 1;
    salesOrder.exchangeRateUpdatedAt = new Date().toISOString();
  }

  const { requestedDate, promisedDate, ...orderData } = salesOrder;

  const order = await client
    .from("salesOrder")
    .insert([{ ...orderData, opportunityId: opportunity.data?.id }])
    .select("id, salesOrderId");

  if (order.error) {
    return order;
  }

  if (!order.data || order.data.length === 0) {
    return {
      error: {
        message: "Sales order insert returned no data",
        details:
          "The insert operation completed but returned an empty result set"
      } as PostgrestError,
      data: null
    };
  }

  const salesOrderId = order.data[0].id;

  const [shipment, payment] = await Promise.all([
    client.from("salesOrderShipment").insert([
      {
        id: salesOrderId,
        locationId: locationId,
        shippingMethodId: shippingMethodId,
        receiptRequestedDate: requestedDate,
        receiptPromisedDate: promisedDate,
        shippingTermId: shippingTermId,
        incoterm: incoterm,
        incotermLocation: incotermLocation,
        companyId: salesOrder.companyId
      }
    ]),
    client.from("salesOrderPayment").insert([
      {
        id: salesOrderId,
        invoiceCustomerId: invoiceCustomerId,
        invoiceCustomerContactId: invoiceCustomerContactId,
        invoiceCustomerLocationId: invoiceCustomerLocationId,
        paymentTermId: paymentTermId,
        companyId: salesOrder.companyId
      }
    ])
  ]);

  if (shipment.error) {
    await deleteSalesOrder(client, salesOrderId);
    return shipment;
  }
  if (payment.error) {
    await deleteSalesOrder(client, salesOrderId);
    return payment;
  }
  if (opportunity.error) {
    await deleteSalesOrder(client, salesOrderId);
    return opportunity;
  }

  return order;
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
  if ("id" in salesOrderLine) {
    return client
      .from("salesOrderLine")
      .update(sanitize(salesOrderLine))
      .eq("id", salesOrderLine.id)
      .select("id")
      .single();
  }
  const salesOrder = await getSalesOrder(client, salesOrderLine.salesOrderId);
  if (salesOrder.error) return salesOrder;

  salesOrderLine.exchangeRate = salesOrder.data?.exchangeRate ?? 1;

  return client
    .from("salesOrderLine")
    .insert([salesOrderLine])
    .select("id")
    .single();
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
  if ("id" in salesOrderPayment) {
    return client
      .from("salesOrderPayment")
      .update(sanitize(salesOrderPayment))
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
        updatedAt: today(getLocalTimeZone()).toString()
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
    return client
      .from("salesRfqLine")
      .insert([salesRfqLine])
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
