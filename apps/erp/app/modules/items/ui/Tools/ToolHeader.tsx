// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Tool } from "../../types";
import ItemRecordHeader, {
  type ItemSupersession
} from "../Item/ItemRecordHeader";
import { useToolNavigation } from "./useToolNavigation";

const ToolHeader = () => {
  const links = useToolNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{
    toolSummary: Tool;
    supersession: ItemSupersession;
  }>(path.to.tool(itemId));

  return (
    <ItemRecordHeader
      itemId={itemId}
      readableId={routeData?.toolSummary?.readableIdWithRevision}
      withChangeNotice
      detailsTo={path.to.toolDetails(itemId)}
      links={links}
      supersession={routeData?.supersession}
      deleteLabel={<Trans>Delete Tool</Trans>}
      deleteFallbackName="tool"
    />
  );
};

export default ToolHeader;
