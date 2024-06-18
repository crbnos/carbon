import { Enumerable, HStack, Heading, VStack } from "@carbon/react";

import { useParams } from "@remix-run/react";
import { DetailsTopbar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import type { Tool } from "~/modules/items";
import { path } from "~/utils/path";
import { useToolNavigation } from "./useToolNavigation";

const ToolHeader = () => {
  const links = useToolNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ toolSummary: Tool }>(path.to.tool(itemId));

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Heading size="h2">{routeData?.toolSummary?.id}</Heading>
          <Enumerable value="Tool" />
        </HStack>
      </VStack>
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        <DetailsTopbar links={links} />
      </VStack>
    </div>
  );
};

export default ToolHeader;
