// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LoaderFunctionArgs } from "react-router";
import {
  invoiceCsvResponse,
  loadInvoiceExportTable
} from "./invoice-export.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return invoiceCsvResponse(
    "purchase-invoices.csv",
    await loadInvoiceExportTable(request, "purchase")
  );
}
