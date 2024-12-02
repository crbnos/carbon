import { HStack, Heading, VStack } from "@carbon/react";

import { Link, useParams } from "@remix-run/react";
import { Copy } from "~/components";
import { DetailsTopbar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import type { Material } from "~/modules/items";
import { path } from "~/utils/path";
import { useMaterialNavigation } from "./useMaterialNavigation";

const MaterialHeader = () => {
  const links = useMaterialNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ materialSummary: Material }>(
    path.to.material(itemId)
  );

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Link to={path.to.materialDetails(itemId)}>
            <Heading size="h3" className="flex items-center gap-2">
              {/* <ModuleIcon icon={<MethodItemTypeIcon type="Material" />} /> */}
              <span>{routeData?.materialSummary?.id}</span>
            </Heading>
          </Link>
          <Copy text={routeData?.materialSummary?.id ?? ""} />
        </HStack>
      </VStack>
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        <DetailsTopbar links={links} />
      </VStack>
    </div>
  );
};

export default MaterialHeader;
