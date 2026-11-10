// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { useLingui } from "@lingui/react/macro";

type RentalInvoiceLineType =
  Database["public"]["Enums"]["rentalInvoiceLineType"];

/** The label a rental invoice line shows for its rental line type. */
export function useRentalLineTypeLabel() {
  const { t } = useLingui();
  return (lineType: RentalInvoiceLineType | null | undefined) => {
    switch (lineType) {
      case "Rent":
        return t`Rent`;
      case "Charge":
        return t`Rental Charge`;
      case "Purchase Option":
        return t`Purchase Option`;
      default:
        return t`Rental`;
    }
  };
}
