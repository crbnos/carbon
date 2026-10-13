// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import PurchaseInvoicingStatus from "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicingStatus";
import type { LeasePurchaseInvoice } from "./types";

/** A lease invoice's status. The app's status list has no "Return" (a
 *  status a lease invoice never takes), so it renders nothing. */
const LeaseInvoiceStatus = ({
  status
}: {
  status: LeasePurchaseInvoice["status"] | null | undefined;
}) => (
  <PurchaseInvoicingStatus
    status={!status || status === "Return" ? null : status}
  />
);

export default LeaseInvoiceStatus;
