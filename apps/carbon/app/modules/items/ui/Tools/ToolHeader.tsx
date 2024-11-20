import { HStack, Heading, VStack } from "@carbon/react";

import { Link, useParams } from "@remix-run/react";
import { Copy } from "~/components";
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
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px]">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Link to={path.to.toolDetails(itemId)}>
            <Heading size="h3" className="flex items-center gap-2">
              {/* <ModuleIcon icon={<MethodItemTypeIcon type="Tool" />} /> */}
              <span>{routeData?.toolSummary?.id}</span>
            </Heading>
          </Link>
          <Copy text={routeData?.toolSummary?.id ?? ""} />
        </HStack>
      </VStack>
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        <DetailsTopbar links={links} />
      </VStack>
    </div>
  );
};

export default ToolHeader;
