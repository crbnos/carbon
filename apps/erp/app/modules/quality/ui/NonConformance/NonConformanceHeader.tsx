import { Button, Copy, HStack, Heading, VStack } from "@carbon/react";

import { Link, useParams } from "@remix-run/react";
import { LuCircleCheck } from "react-icons/lu";
import { DetailsTopbar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { NonConformance } from "../../types";
import { useNonConformanceNavigation } from "./useNonConformanceNavigation";

const NonConformanceHeader = () => {
  const links = useNonConformanceNavigation();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{ nonConformance: NonConformance }>(
    path.to.nonConformance(id)
  );

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
      <VStack spacing={0}>
        <HStack>
          <Link to={path.to.nonConformanceDetails(id)}>
            <Heading size="h4" className="flex items-center gap-2">
              {/* <ModuleIcon icon={<MethodItemTypeIcon type="Part" />} /> */}
              <span>{routeData?.nonConformance?.nonConformanceId}</span>
            </Heading>
          </Link>
          <Copy text={routeData?.nonConformance?.nonConformanceId ?? ""} />
        </HStack>
      </VStack>

      <HStack>
        <DetailsTopbar links={links} />
        <Button
          leftIcon={<LuCircleCheck />}
          variant="secondary"
          isDisabled={true}
        >
          Complete
        </Button>
      </HStack>
    </div>
  );
};

export default NonConformanceHeader;
