// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { renderSalesReturnOrderPdf } from "~/modules/sales/sales.pdf";

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
  return renderSalesReturnOrderPdf(client, {
    id,
    companyId,
    companyGroupId,
    locale
  });
}
