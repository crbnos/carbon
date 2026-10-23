// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { useCallback } from "react";
import { useUser } from "~/hooks";

/**
 * Reads an item's sale price and unit of measure, so a charge or estimate line
 * defaults its unit price when the item is picked.
 */
export function useItemSalePrice() {
  const { carbon } = useCarbon();
  const { company } = useUser();

  return useCallback(
    async (
      itemId: string
    ): Promise<{ unitPrice: number; unitOfMeasureCode: string | null }> => {
      if (!carbon || !itemId) return { unitPrice: 0, unitOfMeasureCode: null };
      const [price, item] = await Promise.all([
        carbon
          .from("itemUnitSalePrice")
          .select("unitSalePrice")
          .eq("itemId", itemId)
          .eq("companyId", company.id)
          .maybeSingle(),
        carbon
          .from("item")
          .select("unitOfMeasureCode")
          .eq("id", itemId)
          .eq("companyId", company.id)
          .maybeSingle()
      ]);
      return {
        unitPrice: price.data?.unitSalePrice ?? 0,
        unitOfMeasureCode: item.data?.unitOfMeasureCode ?? null
      };
    },
    [carbon, company.id]
  );
}
