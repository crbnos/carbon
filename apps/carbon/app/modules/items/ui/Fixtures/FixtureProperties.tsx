import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  cn,
  toast,
} from "@carbon/react";
import { Await, Link, useFetcher, useParams } from "@remix-run/react";
import { Suspense, useCallback, useEffect } from "react";
import { LuCopy, LuExternalLink, LuLink, LuMove3D } from "react-icons/lu";
import {
  CustomerAvatar,
  MethodBadge,
  MethodIcon,
  TrackingTypeIcon,
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ItemThumbnailUpload } from "~/components/ItemThumnailUpload";
import { useRouteData } from "~/hooks";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import {
  itemReplenishmentSystems,
  itemTrackingTypes,
} from "../../items.models";
import type { BuyMethod, Fixture, ItemFile, PickMethod } from "../../types";
import { FileBadge } from "../Item";

const FixtureProperties = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const sharedFixturesData = useRouteData<{ locations: ListItem[] }>(
    path.to.fixtureRoot
  );
  const routeData = useRouteData<{
    fixtureSummary: Fixture;
    files: Promise<ItemFile[]>;
    buyMethods: BuyMethod[];
    pickMethods: PickMethod[];
  }>(path.to.fixture(itemId));

  const locations = sharedFixturesData?.locations ?? [];
  const buyMethods = routeData?.buyMethods ?? [];
  const pickMethods = routeData?.pickMethods ?? [];

  // const optimisticAssignment = useOptimisticAssignment({
  //   id: itemId,
  //   table: "item",
  // });
  // const assignee =
  //   optimisticAssignment !== undefined
  //     ? optimisticAssignment
  //     : routeData?.fixtureSummary?.assignee;

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);
  const onUpdate = useCallback(
    (
      field: "replenishmentSystem" | "defaultMethodType" | "itemTrackingType",
      value: string
    ) => {
      const formData = new FormData();

      formData.append("items", itemId);
      formData.append("field", field);
      formData.append("value", value);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateItems,
      });
    },
    [fetcher, itemId]
  );

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
        <ItemThumbnailUpload
          path={routeData?.fixtureSummary?.thumbnailPath}
          itemId={itemId}
          modelId={routeData?.fixtureSummary?.modelId}
        />
      </VStack>
      {/* <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee
          id={itemId}
          table="item"
          value={assignee ?? ""}
          isReadOnly={!permissions.can("update", "parts")}
        />
      </VStack> */}

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Tracking Type</h3>
        <DropdownMenu>
          <DropdownMenuTrigger>
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
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {itemTrackingTypes.map((type) => (
              <DropdownMenuItem
                key={type}
                onClick={() => onUpdate("itemTrackingType", type)}
              >
                <DropdownMenuIcon icon={<TrackingTypeIcon type={type} />} />
                <span>{type}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Default Method Type</h3>
        <DropdownMenu>
          <DropdownMenuTrigger>
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
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {methodType.map((type) => (
              <DropdownMenuItem
                key={type}
                onClick={() => onUpdate("defaultMethodType", type)}
              >
                <DropdownMenuIcon icon={<MethodIcon type={type} />} />
                <span>{type}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Replenishment</h3>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Enumerable
              value={routeData?.fixtureSummary?.replenishmentSystem ?? null}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {itemReplenishmentSystems.map((system) => (
              <DropdownMenuItem
                key={system}
                onClick={() => onUpdate("replenishmentSystem", system)}
              >
                <Enumerable value={system} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
            text={locations.find((l) => l.id === method.locationId)?.name ?? ""}
            to={path.to.fixtureInventoryLocation(itemId, method.locationId)}
          />
        ))}
      </VStack>

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Files</h3>
        </HStack>
        {routeData?.fixtureSummary?.modelId && (
          <HStack className="group" spacing={1}>
            <Badge variant="secondary">
              <LuMove3D className="w-3 h-3 mr-1 text-emerald-500" />
              3D Model
            </Badge>
            <Link
              className="group-hover:opacity-100 opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground"
              to={path.to.file.cadModel(routeData?.fixtureSummary.modelId)}
              target="_blank"
            >
              <LuExternalLink />
            </Link>
          </HStack>
        )}
        <Suspense fallback={null}>
          <Await resolve={routeData?.files}>
            {(files) =>
              files?.map((file) => (
                <FileBadge
                  key={file.id}
                  file={file}
                  itemId={itemId}
                  itemType="Fixture"
                />
              ))
            }
          </Await>
        </Suspense>
      </VStack>
    </VStack>
  );
};

export default FixtureProperties;
