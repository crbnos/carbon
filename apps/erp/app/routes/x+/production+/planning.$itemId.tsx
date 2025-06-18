import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  VStack,
} from "@carbon/react";
import { useRouteData, useUrlParams } from "@carbon/remix";
import { Link, useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { LuExternalLink, LuX } from "react-icons/lu";
import { useUser } from "~/hooks/useUser";
import { getItem, getItemPlanning } from "~/modules/items/items.service";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import type { ProductionPlanningItem } from "~/modules/production/types";
import { getLocationsList } from "~/modules/resources/resources.service";
import { getUserDefaults } from "~/modules/users/users.server";
import { path } from "~/utils/path";
import { error } from "../../../../../../packages/auth/src/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) {
    throw new Error("itemId not found");
  }

  const searchParams = new URL(request.url).searchParams;

  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.productionPlanning,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }

    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  const [item, itemPlanning] = await Promise.all([
    getItem(client, itemId),
    getItemPlanning(client, itemId, companyId, locationId),
  ]);

  return json({ item: item.data, itemPlanning: itemPlanning.data });
}

export default function ProductionPlanningDetailsRoute() {
  const { itemId } = useParams();
  if (!itemId) {
    throw new Error("itemId not found");
  }

  const { item, itemPlanning } = useLoaderData<typeof loader>();

  const routeData = useRouteData<{
    locationId: string;
    itemPlanning: ProductionPlanningItem;
  }>(path.to.productionPlanning);

  const navigate = useNavigate();
  const [params] = useUrlParams();
  const { defaults } = useUser();

  return (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel
        defaultSize={50}
        maxSize={70}
        minSize={25}
        className="bg-muted"
      >
        <ScrollArea className="h-[calc(100dvh-49px)]">
          <div className="w-full">
            <div className="flex justify-between items-center border-b border-border p-2 bg-card w-full">
              <Button
                isIcon
                variant="ghost"
                onClick={() =>
                  navigate(`${path.to.productionPlanning}?${params.toString()}`)
                }
              >
                <LuX className="w-4 h-4" />
              </Button>
              {item && (
                <span className="flex items-center font-semibold text-center">
                  {item.readableIdWithRevision ?? item.readableId}{" "}
                  <Link
                    to={getLinkToItemDetails(item.type as "Part", itemId)}
                    className="ml-2"
                  >
                    <LuExternalLink />
                  </Link>
                </span>
              )}
              <div />
            </div>
          </div>
          <VStack className="p-2" spacing={2}>
            <ItemPlanningChart
              key={itemId}
              itemId={itemId}
              locationId={routeData?.locationId ?? defaults.locationId ?? ""}
              safetyStock={
                itemPlanning?.reorderingPolicy === "Demand-Based Reorder"
                  ? itemPlanning.demandAccumulationSafetyStock
                  : undefined
              }
            />
          </VStack>
        </ScrollArea>
      </ResizablePanel>
    </>
  );
}
