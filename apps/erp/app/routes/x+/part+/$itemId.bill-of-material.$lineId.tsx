// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { PartMethodPage } from "~/modules/items/items.service";
import type { PartSummary } from "~/modules/items/types";
import { MaterialLineWorkspace } from "~/modules/items/ui/Item/MaterialLineWorkspace";
import { path } from "~/utils/path";

export default function PartBillOfMaterialLineRoute() {
  const { itemId, lineId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  if (!lineId) throw new Error("Could not find lineId");

  const partData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );
  const page = useRouteData<PartMethodPage>(path.to.partBillOfMaterial(itemId));
  if (!page) return null;

  return (
    <MaterialLineWorkspace
      itemId={itemId}
      page={page}
      lineId={lineId}
      replenishmentSystem={partData?.partSummary?.replenishmentSystem}
    />
  );
}
