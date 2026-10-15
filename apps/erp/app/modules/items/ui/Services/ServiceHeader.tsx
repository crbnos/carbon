// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Service } from "../../types";
import ItemRecordHeader, {
  type ItemSupersession
} from "../Item/ItemRecordHeader";
import { useServiceNavigation } from "./useServiceNavigation";

const ServiceHeader = () => {
  const links = useServiceNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{
    serviceSummary: Service;
    supersession: ItemSupersession;
  }>(path.to.service(itemId));

  return (
    <ItemRecordHeader
      itemId={itemId}
      readableId={routeData?.serviceSummary?.readableIdWithRevision}
      detailsTo={path.to.serviceDetails(itemId)}
      links={links}
      supersession={routeData?.supersession}
      deleteLabel={<Trans>Delete Service</Trans>}
      deleteFallbackName="service"
    />
  );
};

export default ServiceHeader;
