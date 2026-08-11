import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  VStack
} from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import InventoryItemHeader from "~/modules/inventory/ui/Inventory/InventoryItemHeader";
import { getItem, getPickMethod, upsertPickMethod } from "~/modules/items";
import { resolveLocationId } from "~/modules/shared/location.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { itemId } = params;
  if (!itemId) throw notFound("itemId not found");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const locationId = await resolveLocationId(client, request, {
    searchParams,
    userId,
    companyId,
    onDefaultsError: path.to.inventory,
    onNoLocations: path.to.inventory
  });

  // Ensure pick method exists for this item/location combination
  const ensurePickMethod = await upsertPickMethod(client, {
    itemId,
    companyId,
    locationId,
    customFields: {},
    createdBy: userId
  });

  if (ensurePickMethod.error) {
    throw redirect(
      path.to.inventory,
      await flash(
        request,
        error(ensurePickMethod.error, "Failed to ensure pick method exists")
      )
    );
  }

  // Now get the pick method (it should definitely exist)
  const pickMethod = await getPickMethod(client, itemId, companyId, locationId);
  if (pickMethod.error || !pickMethod.data) {
    throw redirect(
      path.to.inventory,
      await flash(
        request,
        error(pickMethod.error, "Failed to load pick method")
      )
    );
  }

  const item = await getItem(client, itemId);
  if (item.error || !item.data) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(item.error, "Failed to load item"))
    );
  }

  return {
    pickMethod: pickMethod.data,
    item: item.data
  };
}

export default function ItemInventoryRoute() {
  const { item } = useLoaderData<typeof loader>();

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
          <InventoryItemHeader
            itemReadableId={item.readableIdWithRevision ?? item.readableId}
            // @ts-ignore
            itemType={item.type}
          />
          <VStack className="p-2">
            <Outlet />
          </VStack>
        </ScrollArea>
      </ResizablePanel>
    </>
  );
}
