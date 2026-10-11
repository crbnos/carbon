// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Material } from "../../types";
import ItemRecordHeader, {
  type ItemSupersession
} from "../Item/ItemRecordHeader";
import { useMaterialNavigation } from "./useMaterialNavigation";

const MaterialHeader = () => {
  const links = useMaterialNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{
    materialSummary: Material;
    supersession: ItemSupersession;
  }>(path.to.material(itemId));

  return (
    <ItemRecordHeader
      itemId={itemId}
      readableId={routeData?.materialSummary?.readableIdWithRevision}
      detailsTo={path.to.materialDetails(itemId)}
      links={links}
      supersession={routeData?.supersession}
      deleteLabel={<Trans>Delete Material</Trans>}
      deleteFallbackName="material"
    />
  );
};

export default MaterialHeader;
