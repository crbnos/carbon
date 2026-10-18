// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getMaterialFormsList } from "~/modules/items/items.service";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {});
  const { client, companyId } = auth;
  return await getMaterialFormsList(client, companyId);
}
