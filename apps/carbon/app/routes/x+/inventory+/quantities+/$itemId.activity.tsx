import { useCarbon } from "@carbon/auth";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useCallback, useState } from "react";
import InfiniteScroll from "~/components/InfiniteScroll";
import { getItemLedger, InventoryActivity } from "~/modules/inventory";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory",
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

  const itemLedgerRecords = await getItemLedger(
    client,
    itemId,
    companyId,
    locationId,
    true
  );
  if (itemLedgerRecords.error || !itemLedgerRecords.data) {
    throw redirect(
      path.to.inventory,
      await flash(
        request,
        error(itemLedgerRecords, "Failed to load item inventory activity")
      )
    );
  }

  return json({
    initialItemLedgers: itemLedgerRecords.data,
    itemId,
    companyId,
    locationId,
  });
}

export default function ItemInventoryActivityRoute() {
  const { initialItemLedgers, itemId, companyId, locationId } =
    useLoaderData<typeof loader>();

  const { carbon } = useCarbon();

  const [itemLedgers, setItemLedgers] = useState<any[]>(initialItemLedgers);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const loadMoreItemLedgers = useCallback(async () => {
    if (isLoading || !hasMore) return;

    setIsLoading(true);

    const newItemLedgers = await getItemLedger(
      carbon!,
      itemId,
      companyId,
      locationId,
      true,
      page + 1
    );

    if (newItemLedgers.data && newItemLedgers.data.length > 0) {
      setItemLedgers((prevItemLedgers) => [
        ...prevItemLedgers,
        ...newItemLedgers.data,
      ]);
      setPage((prevPage) => prevPage + 1);
    } else {
      setHasMore(false);
    }

    setIsLoading(false);
  }, [page, carbon, companyId, locationId, itemId, isLoading, hasMore]);

  return (
    <>
      <div className="w-full space-y-4 pt-6 px-4">
        <h2 className="text-2xl font-semibold mb-4">Activity</h2>

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
