// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { hasAccountingCutover } from "~/modules/accounting/accounting.utils";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "accounting"
  });

  const companySettings = await api.settings.getCompanySettings({});

  throw redirect(
    hasAccountingCutover(companySettings.data)
      ? path.to.reports
      : path.to.accountingActivation
  );
}

export const middleware = [redirectBeforeLoaders(loader)];
