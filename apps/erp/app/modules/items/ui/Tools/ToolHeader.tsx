import { HStack, Heading, VStack } from "@carbon/react";

import { Link, useParams } from "@remix-run/react";
import { Copy } from "~/components";
import { DetailsTopbar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Tool } from "../../types";
import { useToolNavigation } from "./useToolNavigation";

const ToolHeader = () => {
  const links = useToolNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ toolSummary: Tool }>(path.to.tool(itemId));

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08),_0px_0px_10px_rgba(0,_0,_0,_0.12),_0px_0px_24px_rgba(0,_0,_0,_0.16),_0px_0px_80px_rgba(0,_0,_0,_0.2)]">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Link to={path.to.toolDetails(itemId)}>
            <Heading size="h4" className="flex items-center gap-2">
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
