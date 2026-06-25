import { error, notFound, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { LuChevronUp } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import InfiniteScroll from "~/components/InfiniteScroll";
import type { ItemLedger } from "~/modules/inventory";
import { getItemLedgerActivity, InventoryActivity } from "~/modules/inventory";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { itemId } = params;
  if (!itemId) throw notFound("itemId not found");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  let locationId = searchParams.get("location");
  const highlightId = searchParams.get("highlight");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.inventory,
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

  // When arriving via a `highlight` param, anchor the first page directly on
  // that entry (load it + older below) so it's on screen no matter how old it
  // is — instead of paging from newest until we reach it.
  let anchorEntryNumber: number | null = null;
  if (highlightId) {
    const anchor = await client
      .from("itemLedger")
      .select("entryNumber")
      .eq("id", highlightId)
      .eq("companyId", companyId)
      .maybeSingle();
    anchorEntryNumber = anchor.data?.entryNumber ?? null;
  }

  const itemLedgerRecords = await getItemLedgerActivity(client, {
    itemId,
    companyId,
    locationId,
    entryNumber: anchorEntryNumber ?? undefined,
    direction: "older",
    inclusive: anchorEntryNumber !== null
  });
  if (itemLedgerRecords.error) {
    throw redirect(
      path.to.inventory,
      await flash(
        request,
        error(itemLedgerRecords.error, "Failed to load item inventory activity")
      )
    );
  }

  // Only offer "Load newer" when entries actually exist above the anchor — a
  // cheap existence check (indexed entryNumber, capped at one row).
  let hasNewer = false;
  if (anchorEntryNumber !== null) {
    const newer = await client
      .from("itemLedger")
      .select("id")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .eq("locationId", locationId)
      .gt("entryNumber", anchorEntryNumber)
      .limit(1);
    hasNewer = (newer.data?.length ?? 0) > 0;
  }

  return {
    initialItemLedgers: itemLedgerRecords.data,
    itemId,
    companyId,
    locationId,
    highlightId,
    hasOlder: itemLedgerRecords.hasMore,
    hasNewer
  };
}

export default function ItemInventoryActivityRoute() {
  const {
    initialItemLedgers,
    itemId,
    companyId,
    locationId,
    highlightId,
    hasOlder: initialHasOlder,
    hasNewer: initialHasNewer
  } = useLoaderData<typeof loader>();

  const { carbon } = useCarbon();

  const [itemLedgers, setItemLedgers] =
    useState<ItemLedger[]>(initialItemLedgers);
  const [hasOlder, setHasOlder] = useState(initialHasOlder);
  const [hasNewer, setHasNewer] = useState(initialHasNewer);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isLoadingNewer, setIsLoadingNewer] = useState(false);

  const loadOlder = useCallback(async () => {
    if (isLoadingOlder || !hasOlder || itemLedgers.length === 0) return;
    setIsLoadingOlder(true);

    const oldest = itemLedgers[itemLedgers.length - 1];
    const result = await getItemLedgerActivity(carbon!, {
      itemId,
      companyId,
      locationId,
      entryNumber: oldest.entryNumber,
      direction: "older"
    });

    if (result.data.length > 0) {
      setItemLedgers((prev) => [...prev, ...result.data]);
    }
    setHasOlder(result.hasMore);
    setIsLoadingOlder(false);
  }, [
    carbon,
    itemId,
    companyId,
    locationId,
    itemLedgers,
    isLoadingOlder,
    hasOlder
  ]);

  const loadNewer = useCallback(async () => {
    if (isLoadingNewer || !hasNewer || itemLedgers.length === 0) return;
    setIsLoadingNewer(true);

    const newest = itemLedgers[0];
    const result = await getItemLedgerActivity(carbon!, {
      itemId,
      companyId,
      locationId,
      entryNumber: newest.entryNumber,
      direction: "newer"
    });

    if (result.data.length > 0) {
      setItemLedgers((prev) => [...result.data, ...prev]);
    }
    setHasNewer(result.hasMore);
    setIsLoadingNewer(false);
  }, [
    carbon,
    itemId,
    companyId,
    locationId,
    itemLedgers,
    isLoadingNewer,
    hasNewer
  ]);

  return (
    <div className="w-full space-y-4 pt-6 px-4">
      <h2 className="text-2xl font-semibold mb-4">
        <Trans>Activity</Trans>
      </h2>

      {hasNewer && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            leftIcon={<LuChevronUp />}
            isLoading={isLoadingNewer}
            isDisabled={isLoadingNewer}
            onClick={loadNewer}
          >
            <Trans>Load newer</Trans>
          </Button>
        </div>
      )}

      <InfiniteScroll
        component={InventoryActivity}
        items={itemLedgers}
        loadMore={loadOlder}
        hasMore={hasOlder}
        highlightId={highlightId ?? undefined}
      />
    </div>
  );
}
