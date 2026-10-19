// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { renderPurchaseReturnOrderPdf } from "~/modules/purchasing/purchasing.pdf";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "purchasing"
    }
  );

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const pdf = await renderPurchaseReturnOrderPdf(client, {
    companyId,
    companyGroupId,
    purchaseReturnOrderId: id,
    locale: getPreferenceHeaders(request).locale
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${pdf.fileName}"`
  });
  return new Response(new Uint8Array(pdf.body), { status: 200, headers });
}
