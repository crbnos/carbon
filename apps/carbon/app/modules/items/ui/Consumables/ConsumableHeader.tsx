import { HStack, Heading, VStack } from "@carbon/react";

import { Link, useParams } from "@remix-run/react";
import { Copy, MethodItemTypeIcon } from "~/components";
import { DetailsTopbar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Consumable } from "../../types";
import { useConsumableNavigation } from "./useConsumableNavigation";

const ConsumableHeader = () => {
  const links = useConsumableNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ consumableSummary: Consumable }>(
    path.to.consumable(itemId)
  );

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Link to={path.to.consumableDetails(itemId)}>
            <Heading size="h3" className="flex items-center gap-2">
              <MethodItemTypeIcon type="Consumable" className="text-primary" />
              <span>{routeData?.consumableSummary?.id}</span>
            </Heading>
          </Link>
          <Copy text={routeData?.consumableSummary?.id ?? ""} />
        </HStack>
      </VStack>
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        <DetailsTopbar links={links} />
      </VStack>
    </div>
  );
};

export default ConsumableHeader;
