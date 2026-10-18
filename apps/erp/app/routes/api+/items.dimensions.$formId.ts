// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });
  const api = carbonFor(auth);

  if (!params.formId) {
    return data({ error: "Form ID is required" }, { status: 400 });
  }

  const settings = await api.settings.getCompanySettings({});

  return await api.items.getMaterialDimensionList({
    materialFormId: params.formId,
    isMetric: settings?.data?.useMetric ?? false
  });
}
