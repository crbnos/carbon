// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { draftRentalAgreementSetupPath } from "~/modules/sales/sales.server";
import { path } from "~/utils/path";

/** Opening an agreement: a Draft continues its setup, anything else shows
 *  its page. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "sales"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");
  throw redirect(
    (await draftRentalAgreementSetupPath(client, { companyId, userId, id })) ??
      path.to.rentalAgreementDetails(id)
  );
}

export const middleware = [redirectBeforeLoaders(loader)];
