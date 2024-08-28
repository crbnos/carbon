import {
  Badge,
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  cn,
} from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import { LuCopy, LuExternalLink, LuLink, LuMove3D } from "react-icons/lu";
import {
  Assignee,
  CustomerAvatar,
  useOptimisticAssignment,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useRouteData } from "~/hooks";
import { MethodBadge, MethodIcon, TrackingTypeIcon } from "~/modules/shared";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import type { BuyMethod, Fixture, ItemFile, PickMethod } from "../../types";
import { FileBadge } from "../Item";

const FixtureProperties = () => {
  const permissions = usePermissions();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const sharedFixturesData = useRouteData<{ locations: ListItem[] }>(
    path.to.fixtureRoot
  );
  const routeData = useRouteData<{
    fixtureSummary: Fixture;
    files: ItemFile[];
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
                    copyToClipboard(
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
                    copyToClipboard(routeData?.fixtureSummary?.id ?? "")
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
        {routeData?.fixtureSummary?.thumbnailPath && (
          <img
            alt="thumbnail"
            src={`/file/preview/private/${routeData.fixtureSummary.thumbnailPath}`}
            className="w-full h-auto bg-gradient-to-bl from-muted to-muted/40 rounded-lg border border-border"
          />
        )}
      </VStack>
      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee
          id={itemId}
          table="item"
          value={assignee ?? ""}
          isReadOnly={!permissions.can("update", "parts")}
        />
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
        {routeData?.fixtureSummary?.replenishmentSystem?.includes("Make") && (
          <MethodBadge
            type="Make"
            text={routeData?.fixtureSummary?.id ?? ""}
            to={path.to.fixtureManufacturing(itemId)}
          />
        )}
        {routeData?.fixtureSummary?.replenishmentSystem?.includes("Buy") &&
          buyMethods.map((method) => (
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

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Files</h3>
        </HStack>
        {routeData?.fixtureSummary?.autodeskUrn && (
          <HStack className="group" spacing={1}>
            <Badge variant="secondary">
              <LuMove3D className="w-3 h-3 mr-1 text-green-500" />
              3D Model
            </Badge>
            <Link
              className="group-hover:opacity-100 opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground"
              to={path.to.file.cadModel(routeData?.fixtureSummary.autodeskUrn!)}
              target="_blank"
            >
              <LuExternalLink />
            </Link>
          </HStack>
        )}
        {routeData?.files.map((file) => {
          return <FileBadge key={file.id} file={file} itemId={itemId} />;
        })}
      </VStack>
    </VStack>
  );
};

export default FixtureProperties;
