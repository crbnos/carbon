// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getGaugesList, getGaugeTypesList } from "~/modules/quality";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality"
  });

  const [gauges, gaugeTypes] = await Promise.all([
    getGaugesList(client, companyId),
    getGaugeTypesList(client, companyId)
  ]);

  return { gauges: gauges.data ?? [], gaugeTypes: gaugeTypes.data ?? [] };
}
