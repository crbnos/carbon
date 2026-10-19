// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { renderQuotePdf } from "~/modules/sales/sales.pdf";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await authorize(request, {
    "sales.quotes": "View"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const { locale } = getPreferenceHeaders(request);
  return renderQuotePdf(client, { id, companyId, companyGroupId, locale });
}
