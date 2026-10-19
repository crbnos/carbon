// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { renderPurchaseOrderPdf } from "~/modules/purchasing/purchasing.pdf";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "purchasing"
    }
  );

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const pdf = await renderPurchaseOrderPdf(client, {
    companyId,
    companyGroupId,
    purchaseOrderId: orderId,
    locale: getPreferenceHeaders(request).locale
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${pdf.fileName}"`
  });
  return new Response(new Uint8Array(pdf.body), { status: 200, headers });
}
