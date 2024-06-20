import {
  Button,
  Enumerable,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  cn,
} from "@carbon/react";
import { useParams } from "@remix-run/react";
import { LuCopy, LuLink } from "react-icons/lu";
import { useOptimisticAssignment } from "~/components";
import Assignee from "~/components/Assignee";
import { useRouteData } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import type { BuyMethod, Material, PickMethod } from "../../types";
import { MethodBadge } from "../Item/MethodBadge";

const MaterialProperties = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const sharedMaterialsData = useRouteData<{ locations: ListItem[] }>(
    path.to.materialRoot
  );
  const routeData = useRouteData<{
    materialSummary: Material;
    buyMethods: BuyMethod[];
    pickMethods: PickMethod[];
  }>(path.to.material(itemId));

  const locations = sharedMaterialsData?.locations ?? [];
  const buyMethods = routeData?.buyMethods ?? [];
  const pickMethods = routeData?.pickMethods ?? [];

  const optimisticAssignment = useOptimisticAssignment({
    id: itemId,
    table: "item",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.materialSummary?.assignee;

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
                      window.location.origin + path.to.material(itemId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to material</span>
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
                    navigator.clipboard.writeText(
                      routeData?.materialSummary?.id ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy material number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{routeData?.materialSummary?.name}</span>
      </VStack>
      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee id={itemId} table="item" value={assignee ?? ""} />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Shape</h3>
        <Enumerable value={routeData?.materialSummary?.materialForm ?? null} />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Substance</h3>
        <Enumerable
          value={routeData?.materialSummary?.materialSubstance ?? null}
        />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Tracking Type</h3>
        <Enumerable
          className={cn(
            routeData?.materialSummary?.active === false && "opacity-50"
          )}
          value={routeData?.materialSummary?.itemInventoryType ?? null}
        />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Unit of Measure</h3>
        <Enumerable value={routeData?.materialSummary?.unitOfMeasure ?? null} />
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
            to={path.to.materialPurchasing(itemId)}
          />
        ))}
        {pickMethods.map((method) => (
          <MethodBadge
            key={method.locationId}
            type="Pick"
            text={
              method.defaultShelfId ??
              locations.find((l) => l.id === method.locationId)?.name ??
              ""
            }
            to={path.to.materialInventoryLocation(itemId, method.locationId)}
          />
        ))}
      </VStack>
    </VStack>
  );
};

export default MaterialProperties;
