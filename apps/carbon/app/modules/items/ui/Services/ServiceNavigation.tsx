import { useParams } from "@remix-run/react";
import { LuFileText, LuShare2 } from "react-icons/lu";
import { DetailSidebar } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import type { Service, ServiceType } from "~/modules/items/types";
import type { Role } from "~/types";
import { path } from "~/utils/path";

export function useServiceNavigation(type: ServiceType) {
  const permissions = usePermissions();
  return [
    {
      name: "Details",
      to: "details",
      icon: LuFileText,
    },
    {
      name: "Suppliers",
      to: "suppliers",
      isDisabled: type === "Internal",
      role: ["employee", "supplier"],
      icon: LuShare2,
    },
  ].filter(
    (item) =>
      !item.isDisabled &&
      (item.role === undefined ||
        item.role.some((role) => permissions.is(role as Role)))
  );
}

const ServiceNavigation = () => {
  const { itemId } = useParams();

  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ service: Service }>(path.to.service(itemId));
  if (!routeData?.service?.serviceType)
    throw new Error("Could not find service type in routeData");

  const links = useServiceNavigation(routeData.service.serviceType);

  return <DetailSidebar links={links} />;
};

export default ServiceNavigation;
