import { useRouteData } from "@carbon/remix";
import { Plan } from "@carbon/utils";

export function usePlan() {
  const routeData = useRouteData<{ plan?: Plan }>("/x");
  return routeData?.plan ?? Plan.Unknown;
}
