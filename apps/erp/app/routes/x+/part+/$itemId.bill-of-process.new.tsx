// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { PartMethodPage } from "~/modules/items/items.service";
import { OperationWorkspace } from "~/modules/items/ui/Item/OperationWorkspace";
import { path } from "~/utils/path";

export default function PartBillOfProcessNewRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const page = useRouteData<PartMethodPage>(path.to.partBillOfProcess(itemId));
  if (!page) return null;

  return <OperationWorkspace itemId={itemId} page={page} />;
}
