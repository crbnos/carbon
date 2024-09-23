import { HStack, Heading, VStack } from "@carbon/react";

import { Link, useParams } from "@remix-run/react";
import { Copy, MethodItemTypeIcon } from "~/components";
import { DetailsTopbar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import type { PartSummary } from "~/modules/items";
import { path } from "~/utils/path";
import { usePartNavigation } from "./usePartNavigation";

const PartHeader = () => {
  const links = usePartNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ partSummary: PartSummary }>(
    path.to.part(itemId)
  );

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Link to={path.to.partDetails(itemId)}>
            <Heading size="h2" className="flex items-center gap-1">
              <MethodItemTypeIcon type="Part" />
              <span>{routeData?.partSummary?.id}</span>
            </Heading>
          </Link>
          <Copy text={routeData?.partSummary?.id ?? ""} />
        </HStack>
      </VStack>
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        <DetailsTopbar links={links} />
      </VStack>
    </div>
  );
};

export default PartHeader;
