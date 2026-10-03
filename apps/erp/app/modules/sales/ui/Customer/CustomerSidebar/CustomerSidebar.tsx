// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useParams } from "react-router";
import { DetailSidebar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type {
  CustomerContact,
  CustomerDetail,
  CustomerLocation
} from "../../../types";
import { useCustomerSidebar } from "./useCustomerSidebar";

const CustomerSidebar = () => {
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const routeData = useRouteData<{
    purchaseOrder: CustomerDetail;
    contacts: CustomerContact[];
    locations: CustomerLocation[];
  }>(path.to.customer(customerId));
  const links = useCustomerSidebar({
    contacts: routeData?.contacts.length ?? 0,
    locations: routeData?.locations.length ?? 0
  });

  return <DetailSidebar links={links} />;
};

export default CustomerSidebar;
