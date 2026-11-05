// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { convertUnitPrice } from "@carbon/database/supplier-part-price";
import type { SupplierPartPricing } from "~/modules/shared/shared.models";
import { resolveSupplierPrice } from "~/modules/shared/shared.utils";
import { purchaseQuantityFor } from "../../projects.models";

/** What the modal knows about an item, from the Add Purchase Order loader. */
export type PurchaseLineItemTerms = {
  conversionFactor: number;
  minimumOrderQuantity: number;
  inventoryUnit: string;
  purchaseUnit: string;
  /** Base currency, per the item's own unit. */
  unitCost: number;
  pricing: SupplierPartPricing | null;
};

type OrderCurrency = { currencyCode: string; exchangeRate: number };

export function purchaseQuantityOfItem(
  terms: PurchaseLineItemTerms,
  quantity: number
) {
  return purchaseQuantityFor(
    quantity,
    terms.conversionFactor,
    terms.minimumOrderQuantity
  );
}

/**
 * The price an item's line starts with, per purchase unit, in the order's
 * currency: the supplier's price for the quantity, else the item's unit cost.
 */
export function suggestedUnitPrice(
  terms: PurchaseLineItemTerms,
  quantity: number,
  order: OrderCurrency,
  baseCurrencyCode: string
) {
  return resolveSupplierPrice(
    terms.pricing,
    purchaseQuantityOfItem(terms, quantity),
    order,
    convertUnitPrice(
      terms.unitCost * terms.conversionFactor,
      { currencyCode: baseCurrencyCode, exchangeRate: 1 },
      order
    )
  );
}
