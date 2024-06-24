import { Badge, HStack, Heading, VStack } from "@carbon/react";

import { useParams } from "@remix-run/react";
import { DetailsTopbar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import { MethodItemTypeIcon, type Consumable } from "~/modules/items";
import { path } from "~/utils/path";
import { useConsumableNavigation } from "./useConsumableNavigation";

const ConsumableHeader = () => {
  const links = useConsumableNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ consumableSummary: Consumable }>(
    path.to.consumable(itemId)
  );

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Heading size="h2">{routeData?.consumableSummary?.id}</Heading>
          <Badge variant="secondary">
            <MethodItemTypeIcon type="Consumable" />
          </Badge>
        </HStack>
      </VStack>
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        <DetailsTopbar links={links} />
      </VStack>
    </div>
  );
};

export default ConsumableHeader;
