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
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, Outlet, useMatches, useParams } from "@remix-run/react";
import { LuCopy, LuExternalLink, LuLink } from "react-icons/lu";
import Assignee, { useOptimisticAssignment } from "~/components/Assignee";
import { useRouteData } from "~/hooks";
import type { BuyMethod, PartSummary, PickMethod } from "~/modules/items";
import {
  MethodIcon,
  PartHeader,
  getBuyMethods,
  getPart,
  getPickMethods,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { ListItem } from "~/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Parts",
  to: path.to.parts,
  module: "parts",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [partSummary, buyMethods, pickMethods] = await Promise.all([
    getPart(client, itemId, companyId),
    getBuyMethods(client, itemId, companyId),
    getPickMethods(client, itemId, companyId),
  ]);

  if (partSummary.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(partSummary.error, "Failed to load part summary")
      )
    );
  }

  return json({
    partSummary: partSummary.data,
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
  });
}

export default function PartRoute() {
  const matches = useMatches();
  const isManufacturing = matches.some(
    (match) => match.id === "routes/x+/part+/$itemId.manufacturing"
  );

  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <PartHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <Outlet />
        </div>
        {!isManufacturing && <PartProperties />}
      </div>
    </div>
  );
}

export const PartProperties = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const sharedPartsData = useRouteData<{ locations: ListItem[] }>(
    path.to.partRoot
  );
  const routeData = useRouteData<{
    partSummary: PartSummary;
    buyMethods: BuyMethod[];
    pickMethods: PickMethod[];
  }>(path.to.part(itemId));

  const locations = sharedPartsData?.locations ?? [];
  const buyMethods = routeData?.buyMethods ?? [];
  const pickMethods = routeData?.pickMethods ?? [];

  const optimisticAssignment = useOptimisticAssignment({
    id: itemId,
    table: "item",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.partSummary?.assignee;

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto border-l border-border p-4"
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
                      window.location.origin + path.to.part(itemId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to part</span>
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
                      routeData?.partSummary?.id ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy part number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{routeData?.partSummary?.name}</span>
      </VStack>
      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee id={itemId} table="item" value={assignee ?? ""} />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Replenishment</h3>
        <Enumerable
          className={cn(
            (routeData?.partSummary?.active === false ||
              routeData?.partSummary?.blocked) &&
              "opacity-50"
          )}
          value={routeData?.partSummary?.replenishmentSystem ?? null}
        />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Inventory Type</h3>
        <Enumerable
          className={cn(
            (routeData?.partSummary?.active === false ||
              routeData?.partSummary?.blocked) &&
              "opacity-50"
          )}
          value={routeData?.partSummary?.itemInventoryType ?? null}
        />
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Unit of Measure</h3>
        <Enumerable value={routeData?.partSummary?.unitOfMeasure ?? null} />
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
            to={path.to.partPurchasing(itemId)}
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
            to={path.to.partInventoryLocation(itemId, method.locationId)}
          />
        ))}
      </VStack>
    </VStack>
  );
};

type MethodBadgeProps = {
  type: "Buy" | "Make" | "Pick";
  text: string;
  to: string;
  className?: string;
};

function MethodBadge({ type, text, to, className }: MethodBadgeProps) {
  return (
    <HStack className="group" spacing={1}>
      <Badge className={cn(getBadgeColor(type), className)}>
        <MethodIcon type={type} className="w-3 h-3 mr-1 text-white" />
        {text}
      </Badge>
      <Link
        className="group-hover:opacity-100 opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground"
        to={to}
        prefetch="intent"
      >
        <LuExternalLink />
      </Link>
    </HStack>
  );
}

function getBadgeColor(type: "Buy" | "Make" | "Pick") {
  return type === "Buy"
    ? "bg-blue-500 hover:bg-blue-600 text-white"
    : type === "Make"
    ? "bg-green-500 hover:bg-green-600 text-white"
    : "bg-orange-500 hover:bg-orange-600 text-white";
}
