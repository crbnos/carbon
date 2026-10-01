// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getMaterialDimensionList } from "~/modules/items";
import { getCompanySettings } from "~/modules/settings";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  if (!params.formId) {
    return data({ error: "Form ID is required" }, { status: 400 });
  }

  const settings = await getCompanySettings(client, companyId);

  return await getMaterialDimensionList(
    client,
    params.formId,
    settings?.data?.useMetric ?? false,
    companyId
  );
}
