// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { hasAccountingCutover } from "~/modules/accounting/accounting.utils";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const companySettings = await getCompanySettings(client, companyId);

  throw redirect(
    hasAccountingCutover(companySettings.data)
      ? path.to.reports
      : path.to.accountingActivation
  );
}

export const middleware = [redirectBeforeLoaders(loader)];
