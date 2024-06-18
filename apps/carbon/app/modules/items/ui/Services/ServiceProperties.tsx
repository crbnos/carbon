import {
  Button,
  Enumerable,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
} from "@carbon/react";
import { useParams } from "@remix-run/react";
import { LuCopy, LuLink } from "react-icons/lu";
import { useOptimisticAssignment } from "~/components";
import Assignee from "~/components/Assignee";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { BuyMethod, PickMethod, Service } from "../../types";
import { MethodBadge } from "../Item/MethodBadge";

const ServiceProperties = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const routeData = useRouteData<{
    service: Service;
    buyMethods: BuyMethod[];
    pickMethods: PickMethod[];
  }>(path.to.service(itemId));

  const buyMethods = routeData?.buyMethods ?? [];

  const optimisticAssignment = useOptimisticAssignment({
    id: itemId,
    table: "item",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.service?.assignee;

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto border-l border-border px-4 py-2"
    >
      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Properties</h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Link"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      window.location.origin + path.to.service(itemId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to service</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    navigator.clipboard.writeText(routeData?.service?.id ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy service number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{routeData?.service?.name}</span>
      </VStack>
      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee id={itemId} table="item" value={assignee ?? ""} />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Service Type</h3>
        <Enumerable value={routeData?.service?.serviceType ?? null} />
      </VStack>

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Methods</h3>
        </HStack>
        {buyMethods.map((method) => (
          <MethodBadge
            key={method.id}
            type="Buy"
            text={method?.supplier?.name ?? ""}
            to={path.to.servicePurchasing(itemId)}
          />
        ))}
      </VStack>
    </VStack>
  );
};

export default ServiceProperties;
