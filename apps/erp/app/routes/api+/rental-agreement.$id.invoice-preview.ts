// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { rentalEarlyInvoiceValidator } from "~/modules/sales/sales.models";

const logger = getLogger("erp", "rental-invoice-preview");

// What "Invoice the next N periods" would draft. A read, so the Invoice
// dialog caches it by URL and the agreement page does not revalidate on each
// change of N, as an action would make it.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { id } = params;
  const input = rentalEarlyInvoiceValidator.safeParse({
    periods: new URL(request.url).searchParams.get("periods")
  });
  if (!id || !input.success) {
    return {
      data: null,
      error: { message: "Choose how many periods to invoice" }
    };
  }

  const { api } = await authorize(request);
  const result = await api.sales.previewRentalAgreementInvoice({
    rentalAgreementId: id,
    periods: input.data.periods
  });
  if (result.error) {
    logger.warning("Rental invoice preview refused", {
      rentalAgreementId: id,
      error: result.error
    });
  }
  return result;
}

export const clientLoader = cachedClientLoader<typeof loader>();
