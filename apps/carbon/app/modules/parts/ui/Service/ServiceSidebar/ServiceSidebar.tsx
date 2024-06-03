import { useParams } from "@remix-run/react";
import { DetailSidebar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import type { Service } from "~/modules/parts/types";
import { path } from "~/utils/path";
import { useServiceSidebar } from "./useServiceSidebar";

const ServiceSidebar = () => {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ service: Service }>(path.to.service(itemId));
  if (!routeData?.service?.serviceType)
    throw new Error("Could not find service type in routeData");

  const links = useServiceSidebar(routeData.service.serviceType);

  return <DetailSidebar links={links} />;
};

export default ServiceSidebar;
