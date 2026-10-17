// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { cachedClientLoader } from "@carbon/query/cache";
import { chargedTaxPercent, datetime } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { getTaxCodesList } from "~/modules/accounting";
import { toTaxCodeInput } from "~/modules/accounting/accounting.utils";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const [taxCodes, timeZone] = await Promise.all([
    getTaxCodesList(client, companyId),
    getCompanyTimeZone(client, companyId)
  ]);
  const today = datetime.today(timeZone).toString();

  return {
    data: (taxCodes.data ?? []).map((code) => ({
      ...code,
      // The rate a line using the code is charged — 0 for a Reverse Charge
      // code. The forms default a line's `taxPercent` from it.
      rate: chargedTaxPercent(toTaxCodeInput(code), today)
    })),
    error: taxCodes.error
  };
}

export const clientLoader = cachedClientLoader<typeof loader>();
