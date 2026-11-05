// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { getPartMethodPage } from "~/modules/items/items.service";
import { getModelByItemId } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const { searchParams } = new URL(request.url);
  const page = await getPartMethodPage(client, {
    itemId,
    companyId,
    methodId: searchParams.get("methodId"),
    makeMethodId: searchParams.get("makeMethodId")
  });
  if (!page) throw redirect(path.to.partDetails(itemId));

  // A sub-assembly has no Details tab here, so its CAD model shows on this tab.
  return {
    ...page,
    subAssemblyModel: page.isSubAssembly
      ? getModelByItemId(client, page.makeMethod.itemId)
      : null
  };
}

export default function PartBillOfMaterialRoute() {
  return <RecordOutlet />;
}
