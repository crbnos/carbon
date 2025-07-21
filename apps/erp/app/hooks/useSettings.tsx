import type { Database } from "@carbon/database";
import { useRouteData } from "@carbon/remix";
import { path } from "~/utils/path";

export function useSettings(): Database["public"]["Tables"]["companySettings"]["Row"] {
  const routeData = useRouteData<{
    companySettings: Database["public"]["Tables"]["companySettings"]["Row"];
  }>(path.to.authenticatedRoot);

  if (!routeData?.companySettings) {
    throw new Error("Company settings not found");
  }

  return routeData.companySettings;
}
