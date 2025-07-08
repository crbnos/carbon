import { useRouteData } from "@carbon/remix";
import { Edition } from "@carbon/utils";

export function useEdition() {
  const routeData = useRouteData<{ env: { CARBON_EDITION: Edition } }>("/");
  return routeData?.env?.CARBON_EDITION ?? Edition.Community;
}
