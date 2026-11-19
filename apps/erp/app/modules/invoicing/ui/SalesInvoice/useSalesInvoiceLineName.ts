// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getItemReadableId } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useItems } from "~/stores";
import { isItemlessServiceLine } from "../../invoicing.models";
import type { SalesInvoiceLine } from "../../types";
import { useRentalLineTypeLabel } from "./useRentalLineTypeLabel";

/**
 * The name a sales invoice line is shown under, wherever the invoice lists
 * its lines: the rental charge, the fixed asset, an itemless service's
 * description, or the item's readable id. Pair it with `distinctItemText` to
 * show the line description only when it says something more.
 */
export function useSalesInvoiceLineName() {
  const { t } = useLingui();
  const [items] = useItems();
  const rentalLineTypeLabel = useRentalLineTypeLabel();

  return (line: SalesInvoiceLine): string | undefined => {
    if (line.invoiceLineType === "Rental") {
      return rentalLineTypeLabel(line.rentalLineType);
    }
    if (line.invoiceLineType === "Fixed Asset") {
      return line.assetReadableId || t`Fixed Asset`;
    }
    if (isItemlessServiceLine(line)) return line.description || t`Service`;
    return getItemReadableId(items, line.itemId);
  };
}
