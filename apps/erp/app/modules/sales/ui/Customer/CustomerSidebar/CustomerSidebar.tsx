import { useParams } from "@remix-run/react";
import { DetailSidebar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type {
  CustomerContact,
  CustomerDetail,
  CustomerLocation,
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
    locations: routeData?.locations.length ?? 0,
  });

  return <DetailSidebar links={links} />;
};

export default CustomerSidebar;
