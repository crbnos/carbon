import {
  Badge,
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
import { CustomerAvatar, useOptimisticAssignment } from "~/components";
import Assignee from "~/components/Assignee";
import { useRouteData } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import type { BuyMethod, Fixture, PickMethod } from "../../types";
import { MethodIcon, TrackingTypeIcon } from "../Item";
import { MethodBadge } from "../Item/MethodBadge";

const FixtureProperties = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const sharedFixturesData = useRouteData<{ locations: ListItem[] }>(
    path.to.fixtureRoot
  );
  const routeData = useRouteData<{
    fixtureSummary: Fixture;
    buyMethods: BuyMethod[];
    pickMethods: PickMethod[];
  }>(path.to.fixture(itemId));

  const locations = sharedFixturesData?.locations ?? [];
  const buyMethods = routeData?.buyMethods ?? [];
  const pickMethods = routeData?.pickMethods ?? [];

  const optimisticAssignment = useOptimisticAssignment({
    id: itemId,
    table: "item",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.fixtureSummary?.assignee;

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
                      window.location.origin + path.to.fixture(itemId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to fixture</span>
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
                      routeData?.fixtureSummary?.id ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy fixture number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{routeData?.fixtureSummary?.name}</span>
      </VStack>
      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee id={itemId} table="item" value={assignee ?? ""} />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Tracking Type</h3>
        <Badge variant="secondary">
          <TrackingTypeIcon
            type={routeData?.fixtureSummary?.itemTrackingType!}
            className={cn(
              "mr-2",
              routeData?.fixtureSummary?.active === false && "opacity-50"
            )}
          />
          <span>{routeData?.fixtureSummary?.itemTrackingType!}</span>
        </Badge>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Default Method Type</h3>
        <Badge variant="secondary">
          <MethodIcon
            type={routeData?.fixtureSummary?.defaultMethodType!}
            className={cn(
              "mr-2",
              routeData?.fixtureSummary?.active === false && "opacity-50"
            )}
          />
          <span>{routeData?.fixtureSummary?.defaultMethodType!}</span>
        </Badge>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Replenishment</h3>
        <Enumerable
          className={cn(
            routeData?.fixtureSummary?.active === false && "opacity-50"
          )}
          value={routeData?.fixtureSummary?.replenishmentSystem ?? null}
        />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Customer</h3>
        {routeData?.fixtureSummary?.customerId ? (
          <CustomerAvatar customerId={routeData?.fixtureSummary?.customerId} />
        ) : (
          <span>--</span>
        )}
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
            to={path.to.fixturePurchasing(itemId)}
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
            to={path.to.fixtureInventoryLocation(itemId, method.locationId)}
          />
        ))}
      </VStack>
    </VStack>
  );
};

export default FixtureProperties;
