// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  RecordOutlet,
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  useViewport,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useSetAppBarOverride } from "~/components/Layout/Mobile";
import { RecordHero } from "~/components/Layout/RecordHeader";
import { useUrlParams } from "~/hooks";
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
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const [params] = useUrlParams();
  const itemReadableId = item.readableIdWithRevision ?? item.readableId;
  const backTo = `${path.to.inventory}?${params.toString()}`;

  // Phones show this detail as its own screen: the item ID is the app bar
  // title, "Quantities" its subtitle, and Back returns to the list (the
  // panel's ✕ and ID are hidden).
  const appBarOverride = useMemo(
    () =>
      isPhone
        ? {
            kind: "pushed" as const,
            title: itemReadableId,
            subtitle: t`Quantities`,
            backTo
          }
        : null,
    [isPhone, itemReadableId, backTo, t]
  );
  useSetAppBarOverride(appBarOverride);

  return (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel
        defaultSize={50}
        maxSize={70}
        minSize={25}
        className="bg-muted"
        compactFocus
      >
        <ScrollArea className="h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
          <RecordHero subtitle={item.name} />
          <InventoryItemHeader
            itemReadableId={itemReadableId}
            // @ts-expect-error
            itemType={item.type}
          />
          <VStack className="p-2 max-md:p-4">
            <RecordOutlet />
          </VStack>
        </ScrollArea>
      </ResizablePanel>
    </>
  );
}
