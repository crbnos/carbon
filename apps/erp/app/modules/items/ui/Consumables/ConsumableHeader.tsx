// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Consumable } from "../../types";
import ItemRecordHeader, {
  type ItemSupersession
} from "../Item/ItemRecordHeader";
import { useConsumableNavigation } from "./useConsumableNavigation";

const ConsumableHeader = () => {
  const links = useConsumableNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{
    consumableSummary: Consumable;
    supersession: ItemSupersession;
  }>(path.to.consumable(itemId));

  return (
    <ItemRecordHeader
      itemId={itemId}
      readableId={routeData?.consumableSummary?.readableIdWithRevision}
      detailsTo={path.to.consumableDetails(itemId)}
      links={links}
      supersession={routeData?.supersession}
      deleteLabel={<Trans>Delete Consumable</Trans>}
      deleteFallbackName="consumable"
    />
  );
};

export default ConsumableHeader;
