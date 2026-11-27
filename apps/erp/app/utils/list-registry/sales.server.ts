// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  CONTRACTS_PAGING,
  CUSTOMER_STATUSES_PAGING,
  CUSTOMER_TYPES_PAGING,
  CUSTOMERS_PAGING,
  getBaseCatalog,
  getContracts,
  getCustomerStatuses,
  getCustomers,
  getCustomerTypes,
  getNoQuoteReasons,
  getPricingRules,
  getQuotes,
  getRentalAgreements,
  getReturnReasons,
  getSalesOrders,
  getSalesReturnOrders,
  getSalesRFQs,
  NO_QUOTE_REASONS_PAGING,
  PRICE_LIST_PAGING,
  PRICING_RULES_PAGING,
  QUOTES_PAGING,
  RENTAL_AGREEMENTS_PAGING,
  RETURN_REASONS_PAGING,
  resolvePriceList,
  SALES_ORDERS_PAGING,
  SALES_RETURN_ORDERS_PAGING,
  SALES_RFQS_PAGING
} from "~/modules/sales/sales.service";
import {
  CUSTOMER_PORTALS_PAGING,
  getCustomerPortals
} from "~/modules/shared/shared.service";
import type { ListDefinition } from "./index.server";
import { searchList } from "./index.server";

export const salesOrdersList = searchList({
  key: "sales-orders",
  gate: { "sales.salesOrders": "View" },
  paging: SALES_ORDERS_PAGING,
  service: getSalesOrders,
  params: { status: "status", customerId: "customerId" }
});

export const quotesList = searchList({
  key: "quotes",
  gate: { "sales.quotes": "View" },
  paging: QUOTES_PAGING,
  service: getQuotes
});

export const salesRfqsList = searchList({
  key: "sales-rfqs",
  gate: { "sales.rfqs": "View" },
  paging: SALES_RFQS_PAGING,
  service: getSalesRFQs
});

export const salesReturnOrdersList = searchList({
  key: "sales-return-orders",
  gate: { "sales.returns": "View" },
  paging: SALES_RETURN_ORDERS_PAGING,
  service: getSalesReturnOrders,
  params: { status: "status", customerId: "customerId" }
});

export const customersList = searchList({
  key: "customers",
  gate: { "sales.customers": "View" },
  paging: CUSTOMERS_PAGING,
  service: getCustomers
});

// Service contracts and project contracts share one query; each billing
// basis is its own list.
export const contractsList = searchList({
  key: "contracts",
  gate: { "sales.serviceContracts": "View" },
  paging: CONTRACTS_PAGING,
  service: getContracts,
  params: { billingBasis: () => "Schedule" }
});

export const projectContractsList = searchList({
  key: "project-contracts",
  gate: { "sales.projectContracts": "View" },
  paging: CONTRACTS_PAGING,
  service: getContracts,
  params: { billingBasis: () => "Project" }
});

export const rentalAgreementsList = searchList({
  key: "rental-agreements",
  gate: { "sales.rentalAgreements": "View" },
  paging: RENTAL_AGREEMENTS_PAGING,
  service: getRentalAgreements
});

// With a customer, a customer type or `scope=all` (every customer) in the URL,
// the list resolves that scope's prices; without one, it shows the base catalog.
export const priceListList = {
  key: "price-list",
  gate: { "sales.priceLists": "View" },
  ...PRICE_LIST_PAGING,
  query: async (
    client,
    companyId,
    { params, limit, cursor, exactCount, sorts, filters }
  ) => {
    const search = params.get("search") ?? undefined;
    const customerId = params.get("customerId") ?? undefined;
    const customerTypeId = params.get("customerTypeId") ?? undefined;
    const allCustomers = params.get("scope") === "all";
    const rawQuantity = Number(params.get("quantity") ?? "1");
    const quantity =
      Number.isFinite(rawQuantity) && rawQuantity >= 0 ? rawQuantity : 1;

    const result =
      customerId || customerTypeId || allCustomers
        ? await resolvePriceList(client, companyId, {
            customerId,
            customerTypeId,
            allCustomers,
            quantity,
            search,
            limit,
            cursor,
            exactCount,
            sorts,
            filters
          })
        : await getBaseCatalog(client, companyId, {
            search,
            limit,
            cursor,
            exactCount,
            sorts,
            filters
          });

    return result;
  }
} satisfies ListDefinition;

export const pricingRulesList = searchList({
  key: "pricing-rules",
  gate: { "sales.pricingRules": "View" },
  paging: PRICING_RULES_PAGING,
  service: getPricingRules,
  params: { search: (params) => params.get("search") ?? undefined }
});

export const customerPortalsList = searchList({
  key: "customer-portals",
  gate: { "sales.portals": "View" },
  paging: CUSTOMER_PORTALS_PAGING,
  service: getCustomerPortals
});

export const customerStatusesList = searchList({
  key: "customer-statuses",
  gate: { "sales.statuses": "View" },
  paging: CUSTOMER_STATUSES_PAGING,
  service: getCustomerStatuses
});

export const customerTypesList = searchList({
  key: "customer-types",
  gate: { "sales.types": "View" },
  paging: CUSTOMER_TYPES_PAGING,
  service: getCustomerTypes
});

export const noQuoteReasonsList = searchList({
  key: "no-quote-reasons",
  gate: { "sales.noQuoteReasons": "View" },
  paging: NO_QUOTE_REASONS_PAGING,
  service: getNoQuoteReasons
});

export const returnReasonsList = searchList({
  key: "return-reasons",
  gate: { "sales.returnReasons": "View" },
  paging: RETURN_REASONS_PAGING,
  service: getReturnReasons
});

export const salesLists: Record<string, ListDefinition> = {
  [salesOrdersList.key]: salesOrdersList,
  [quotesList.key]: quotesList,
  [salesRfqsList.key]: salesRfqsList,
  [salesReturnOrdersList.key]: salesReturnOrdersList,
  [customersList.key]: customersList,
  [contractsList.key]: contractsList,
  [projectContractsList.key]: projectContractsList,
  [rentalAgreementsList.key]: rentalAgreementsList,
  [priceListList.key]: priceListList,
  [pricingRulesList.key]: pricingRulesList,
  [customerPortalsList.key]: customerPortalsList,
  [customerStatusesList.key]: customerStatusesList,
  [customerTypesList.key]: customerTypesList,
  [noQuoteReasonsList.key]: noQuoteReasonsList,
  [returnReasonsList.key]: returnReasonsList
};
