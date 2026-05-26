import { error, notFound, useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Trans } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import InfiniteScroll from "~/components/InfiniteScroll";
import type { ItemLedger } from "~/modules/inventory";
import { InventoryActivity } from "~/modules/inventory";
import { getItemLedgerPage } from "~/modules/inventory/inventory.service.server";
import { getLocationsList } from "~/modules/resources/resources.service.server";
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
    const locations = await getLocationsList();
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

  const itemLedgerRecords = await getItemLedgerPage(itemId, locationId, true);
  if (itemLedgerRecords.error || !itemLedgerRecords.data) {
    throw redirect(
      path.to.inventory,
      await flash(
        request,
        error(itemLedgerRecords, "Failed to load item inventory activity")
      )
    );
  }

  return {
    initialItemLedgers: itemLedgerRecords.data,
    itemId,
    companyId,
    locationId
  };
}

export default function ItemInventoryActivityRoute() {
  const { initialItemLedgers, itemId, locationId } =
    useLoaderData<typeof loader>();

  useCarbon();

  const [itemLedgers, setItemLedgers] =
    useState<ItemLedger[]>(initialItemLedgers);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const loadMoreItemLedgers = useCallback(async () => {
    if (isLoading || !hasMore) return;

    setIsLoading(true);

    const newItemLedgers = await getItemLedgerPage(
      itemId,
      locationId,
      true,
      page + 1
    );

    if (newItemLedgers.data && newItemLedgers.data.length > 0) {
      setItemLedgers((prevItemLedgers) => [
        ...prevItemLedgers,
        ...newItemLedgers.data
      ]);
      setPage((prevPage) => prevPage + 1);
    } else {
      setHasMore(false);
    }

    setIsLoading(false);
  }, [page, locationId, itemId, isLoading, hasMore]);

  return (
    <>
      <div className="w-full space-y-4 pt-6 px-4">
        <h2 className="text-2xl font-semibold mb-4">
          <Trans>Activity</Trans>
        </h2>

        <InfiniteScroll
          component={InventoryActivity}
          items={itemLedgers}
          loadMore={loadMoreItemLedgers}
          hasMore={hasMore}
        />
      </div>
    </>
  );
}
