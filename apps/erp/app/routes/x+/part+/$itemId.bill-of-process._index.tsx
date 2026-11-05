// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { PartMethodPage } from "~/modules/items/items.service";
import { BillOfProcessTable } from "~/modules/items/ui/Item/BillOfProcessTable";
import { path } from "~/utils/path";

export default function PartBillOfProcessIndexRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const page = useRouteData<PartMethodPage>(path.to.partBillOfProcess(itemId));
  if (!page) return null;

  return <BillOfProcessTable itemId={itemId} page={page} />;
}
