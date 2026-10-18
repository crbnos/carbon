// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {});
  const url = new URL(request.url);
  const table = url.searchParams.get("table");

  return await api.shared.getTagsList({ table: table as string | null });
}
