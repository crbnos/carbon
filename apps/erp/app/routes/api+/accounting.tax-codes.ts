// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { cachedClientLoader } from "@carbon/query/cache";
import { chargedTaxPercent, datetime } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { toTaxCodeInput } from "~/modules/accounting/accounting.utils";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";

export async function loader({ request }: LoaderFunctionArgs) {
  const { api, client, companyId } = await authorize(request, {});

  const [taxCodes, timeZone] = await Promise.all([
    // Retired codes too: a picker still shows one a record already names.
    api.accounting.getTaxCodesList({ includeRetired: true }),
    getCompanyTimeZone(client, companyId)
  ]);
  const today = datetime.today(timeZone).toString();

  return {
    data: (taxCodes.data ?? []).map((code) => ({
      ...code,
      // Today's charged rate (0 for Reverse Charge). Line forms take the rate
      // on the document's date (`useTaxCodeRateOn`) and fall back to this.
      rate: chargedTaxPercent(toTaxCodeInput(code), today)
    })),
    error: taxCodes.error
  };
}

export const clientLoader = cachedClientLoader<typeof loader>();
