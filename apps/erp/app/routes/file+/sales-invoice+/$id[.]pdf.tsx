// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SUPABASE_URL } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  loadSalesInvoiceDocument,
  renderSalesInvoicePdf
} from "@carbon/lib/sales-invoice-document.server";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "sales"
    }
  );

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const { locale } = getPreferenceHeaders(request);

  const { pdfProps, fileName } = await loadSalesInvoiceDocument({
    client,
    companyId,
    companyGroupId,
    invoiceId: id,
    locale,
    storageUrl: SUPABASE_URL ?? ""
  });

  const body = await renderSalesInvoicePdf(pdfProps);

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${fileName}"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
