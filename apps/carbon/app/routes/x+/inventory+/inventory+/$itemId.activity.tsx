import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getItemLedger } from "~/modules/inventory";
import InventoryActivity from "~/modules/inventory/ui/Inventory/InventoryActivity";
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
    itemLedgerRecords: itemLedgerRecords.data,
  });
}

export default function ItemInventoryRoute() {
  const { itemLedgerRecords } = useLoaderData<typeof loader>();

  return <InventoryActivity itemLedgerRecords={itemLedgerRecords} />;
}
