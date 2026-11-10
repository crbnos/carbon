// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { CONTRACT_READ_GATE } from "~/modules/sales/sales.models";
import { draftContractSetupPath } from "~/modules/sales/sales.service";
import { path } from "~/utils/path";

/** Opening a contract: a Draft continues its setup, anything else shows its
 *  page. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, permissions } = await authorize(
    request,
    // Both contract lists open the same contract page.
    CONTRACT_READ_GATE
  );
  const { id } = params;
  if (!id) throw new Error("Could not find id");
  throw redirect(
    (await draftContractSetupPath(client, { companyId, permissions, id })) ??
      path.to.contractDetails(id)
  );
}

export const middleware = [redirectBeforeLoaders(loader)];
