// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useParams } from "react-router";
import { DetailSidebar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import type {
  SupplierContact,
  SupplierDetail,
  SupplierLocation
} from "~/modules/purchasing";
import { path } from "~/utils/path";
import { useSupplierSidebar } from "./useSupplierSidebar";

const SupplierSidebar = () => {
  const { supplierId } = useParams();

  if (!supplierId)
    throw new Error(
      "SupplierSidebar requires an supplierId and could not find supplierId in params"
    );

  const routeData = useRouteData<{
    purchaseOrder: SupplierDetail;
    contacts: SupplierContact[];
    locations: SupplierLocation[];
  }>(path.to.supplier(supplierId));

  const links = useSupplierSidebar({
    contacts: routeData?.contacts.length ?? 0,
    locations: routeData?.locations.length ?? 0
  });

  return <DetailSidebar links={links} />;
};

export default SupplierSidebar;
