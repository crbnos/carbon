import { Badge, HStack, Heading, VStack } from "@carbon/react";

import { Link, useParams } from "@remix-run/react";
import { DetailsTopbar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import type { Material } from "~/modules/items";
import { MethodItemTypeIcon } from "~/modules/shared";
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
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Link to={path.to.materialDetails(itemId)}>
            <Heading size="h2">{routeData?.materialSummary?.id}</Heading>
          </Link>
          <Badge variant="secondary">
            <MethodItemTypeIcon type="Material" />
          </Badge>
        </HStack>
      </VStack>
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        <DetailsTopbar links={links} />
      </VStack>
    </div>
  );
};

export default MaterialHeader;
