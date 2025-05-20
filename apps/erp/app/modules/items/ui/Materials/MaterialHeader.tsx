import { Copy, HStack, Heading, VStack } from "@carbon/react";

import { Link, useParams } from "@remix-run/react";
import { DetailsTopbar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Material } from "../../types";
import { useMaterialNavigation } from "./useMaterialNavigation";

const MaterialHeader = () => {
  const links = useMaterialNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{ materialSummary: Material }>(
    path.to.material(itemId)
  );

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Link to={path.to.materialDetails(itemId)}>
            <Heading size="h4" className="flex items-center gap-2">
              {/* <ModuleIcon icon={<MethodItemTypeIcon type="Material" />} /> */}
              <span>{routeData?.materialSummary?.readableIdWithRevision}</span>
            </Heading>
          </Link>
          <Copy
            text={routeData?.materialSummary?.readableIdWithRevision ?? ""}
          />
        </HStack>
      </VStack>
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        <DetailsTopbar links={links} />
      </VStack>
    </div>
  );
};

export default MaterialHeader;
