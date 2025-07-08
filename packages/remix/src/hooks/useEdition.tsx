import { Edition } from "@carbon/auth";
import { useRouteData } from "@carbon/remix";

export function useEdition() {
  const routeData = useRouteData<{ env: { CARBON_EDITION: Edition } }>("/");
  return routeData?.env?.CARBON_EDITION ?? Edition.Community;
}
