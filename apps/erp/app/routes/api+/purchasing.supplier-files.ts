// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const itemIds = new URL(request.url).searchParams.getAll("itemId");
  const api = await carbon(request);
  const result = await api.purchasing.listItemSupplierFiles({ itemIds });
  return { files: result.data ?? [] };
}
