// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, { "sales.quotes": "View" });

  const { id } = params;
  if (!id) return { data: [], error: null };

  return await api.sales.getQuoteLinesList({ quoteId: id });
}
