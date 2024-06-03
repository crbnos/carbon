import { useParams } from "@remix-run/react";
import { DetailSidebar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import type { PartSummary } from "~/modules/parts/types";
import { path } from "~/utils/path";
import { usePartSidebar } from "./usePartSidebar";

const PartSidebar = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );
  if (!routeData?.partSummary?.replenishmentSystem)
    throw new Error("Could not find replenishmentSystem in routeData");

  const links = usePartSidebar(routeData.partSummary.replenishmentSystem);

  return <DetailSidebar links={links} />;
};

export default PartSidebar;
