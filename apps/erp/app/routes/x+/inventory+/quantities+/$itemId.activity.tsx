import { error, notFound, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useCallback, useRef, useState } from "react";
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

  // The activity page and the "is there anything newer than the anchor?"
  // existence check both depend only on `anchorEntryNumber`, not on each other —
  // run them in parallel to save a roundtrip on highlight navigations.
  const [itemLedgerRecords, newer] = await Promise.all([
    getItemLedgerActivity(client, {
      itemId,
      companyId,
      locationId,
      entryNumber: anchorEntryNumber ?? undefined,
      direction: "older",
      inclusive: anchorEntryNumber !== null
    }),
    anchorEntryNumber !== null
      ? client
          .from("itemLedger")
          .select("id")
          .eq("itemId", itemId)
          .eq("companyId", companyId)
          .eq("locationId", locationId)
          .gt("entryNumber", anchorEntryNumber)
          .limit(1)
      : Promise.resolve({ data: [] as { id: string }[] })
  ]);
  if (itemLedgerRecords.error) {
    throw redirect(
      path.to.inventory,
      await flash(
        request,
        error(itemLedgerRecords.error, "Failed to load item inventory activity")
      )
    );
  }

  // Only offer "Load newer" when entries actually exist above the anchor.
  const hasNewer = (newer.data?.length ?? 0) > 0;

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
  const [isLoadingNewer, setIsLoadingNewer] = useState(false);

  // Mirror the values the paging callbacks read into refs so the callbacks stay
  // referentially stable across appends — otherwise InfiniteScroll's
  // IntersectionObserver effect re-subscribes on every loaded page.
  const oldestEntryNumber = useRef<number | null>(
    initialItemLedgers[initialItemLedgers.length - 1]?.entryNumber ?? null
  );
  const newestEntryNumber = useRef<number | null>(
    initialItemLedgers[0]?.entryNumber ?? null
  );
  const loadingOlder = useRef(false);
  const loadingNewer = useRef(false);
  const hasOlderRef = useRef(initialHasOlder);
  const hasNewerRef = useRef(initialHasNewer);

  const loadOlder = useCallback(async () => {
    const cursor = oldestEntryNumber.current;
    if (loadingOlder.current || !hasOlderRef.current || cursor === null) return;
    loadingOlder.current = true;

    const result = await getItemLedgerActivity(carbon!, {
      itemId,
      companyId,
      locationId,
      entryNumber: cursor,
      direction: "older"
    });

    if (result.data.length > 0) {
      oldestEntryNumber.current =
        result.data[result.data.length - 1].entryNumber;
      setItemLedgers((prev) => [...prev, ...result.data]);
    }
    hasOlderRef.current = result.hasMore;
    setHasOlder(result.hasMore);
    loadingOlder.current = false;
  }, [carbon, itemId, companyId, locationId]);

  const loadNewer = useCallback(async () => {
    const cursor = newestEntryNumber.current;
    if (loadingNewer.current || !hasNewerRef.current || cursor === null) return;
    loadingNewer.current = true;
    setIsLoadingNewer(true);

    const result = await getItemLedgerActivity(carbon!, {
      itemId,
      companyId,
      locationId,
      entryNumber: cursor,
      direction: "newer"
    });

    if (result.data.length > 0) {
      newestEntryNumber.current = result.data[0].entryNumber;
      setItemLedgers((prev) => [...result.data, ...prev]);
    }
    hasNewerRef.current = result.hasMore;
    setHasNewer(result.hasMore);
    loadingNewer.current = false;
    setIsLoadingNewer(false);
  }, [carbon, itemId, companyId, locationId]);

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
