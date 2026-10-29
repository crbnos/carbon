// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { draftLeaseSetupPath } from "~/modules/purchasing/purchasing.service";
import { path } from "~/utils/path";

/** Opening a lease: a Draft continues its setup, anything else shows its
 *  page. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");
  throw redirect(
    (await draftLeaseSetupPath(client, { companyId, userId, id })) ??
      path.to.leaseDetails(id)
  );
}

export const middleware = [redirectBeforeLoaders(loader)];
