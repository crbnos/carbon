import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ResizableHandle, ResizablePanel } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useLocations } from "~/components/Form/Location";
import { getShelf, getShelfItems, ShelfItemsPanel } from "~/modules/inventory";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { shelfId } = params;
  if (!shelfId) throw notFound("shelfId not found");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.browseShelves,
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
        path.to.browseShelves,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  const [shelf, shelfItems] = await Promise.all([
    getShelf(client, shelfId),
    getShelfItems(client, shelfId, locationId, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    })
  ]);

  if (shelf.error || !shelf.data) {
    throw redirect(
      path.to.browseShelves,
      await flash(request, error(shelf.error, "Failed to load shelf"))
    );
  }

  if (shelfItems.error) {
    throw redirect(
      path.to.browseShelves,
      await flash(
        request,
        error(shelfItems.error, "Failed to load shelf items")
      )
    );
  }

  // Calculate total quantity
  const totalQuantity = (shelfItems.data ?? []).reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  return {
    shelf: shelf.data,
    items: shelfItems.data ?? [],
    itemCount: shelfItems.count ?? 0,
    totalQuantity,
    locationId
  };
}

export default function BrowseShelfDetailRoute() {
  const { shelf, items, itemCount, totalQuantity, locationId } =
    useLoaderData<typeof loader>();

  const locations = useLocations();
  const location = locations.find((l) => l.value === locationId);

  return (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel
        defaultSize={50}
        maxSize={70}
        minSize={25}
        className="bg-muted"
      >
        <ShelfItemsPanel
          shelfName={shelf.name}
          locationName={location?.label}
          items={items}
          itemCount={itemCount}
          totalQuantity={totalQuantity}
        />
      </ResizablePanel>
    </>
  );
}
