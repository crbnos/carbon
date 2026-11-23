// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LoaderFunctionArgs } from "react-router";
import { agingCsvResponse, loadAgingExportTable } from "./aging.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { asOfDate, table } = await loadAgingExportTable(request, "ar");
  return agingCsvResponse(`ar-aging-${asOfDate}.csv`, table);
}
