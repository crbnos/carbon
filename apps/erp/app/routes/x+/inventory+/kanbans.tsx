import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getKanbans } from "~/modules/inventory";
import KanbansTable from "~/modules/inventory/ui/Kanbans/KanbansTable";
import { getLocationsList } from "~/modules/resources";
import { getKanbanOutputSetting } from "~/modules/settings";
import { getUserDefaults } from "~/modules/users/users.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Kanbans",
  to: path.to.kanbans,
  module: "inventory",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory",
    bypassRls: true,
  });

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
        path.to.kanbans,
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
        path.to.kanbans,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  const [kanbans, kanbanOutput] = await Promise.all([
    getKanbans(client, locationId, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getKanbanOutputSetting(client, companyId),
  ]);

  if (kanbans.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(kanbans.error, "Failed to fetch kanbans"))
    );
  }

  return json({
    count: kanbans.count ?? 0,
    kanbans: kanbans.data ?? [],
    kanbanOutput: kanbanOutput.data?.kanbanOutput ?? "qrcode",
    locationId,
  });
}

export default function KanbansRoute() {
  const { count, kanbans, locationId, kanbanOutput } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <KanbansTable
        data={kanbans}
        count={count}
        locationId={locationId}
        kanbanOutput={kanbanOutput}
      />
      <Outlet />
    </VStack>
  );
}
