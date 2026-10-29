// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { PartSummary } from "../../types";
import ItemRecordHeader, {
  type ItemSupersession
} from "../Item/ItemRecordHeader";
import { usePartNavigation } from "./usePartNavigation";

const PartHeader = () => {
  const links = usePartNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{
    partSummary: PartSummary;
    supersession: ItemSupersession;
  }>(path.to.part(itemId));

  return (
    <ItemRecordHeader
      itemId={itemId}
      readableId={routeData?.partSummary?.readableIdWithRevision}
      subtitle={routeData?.partSummary?.name}
      withChangeNotice
      detailsTo={path.to.partDetails(itemId)}
      links={links}
      supersession={routeData?.supersession}
      deleteLabel={<Trans>Delete Part</Trans>}
      deleteFallbackName="part"
    />
  );
};

export default PartHeader;
