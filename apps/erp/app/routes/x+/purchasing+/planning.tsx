import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ResizablePanel, ResizablePanelGroup, VStack } from "@carbon/react";
import { getLocalTimeZone, startOfWeek, today } from "@internationalized/date";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import type { PurchasingPlanningItem } from "~/modules/purchasing";
import { getPurchasingPlanning } from "~/modules/purchasing";
import PurchasingPlanningTable from "~/modules/purchasing/ui/Planning/PurchasingPlanningTable";
import { getLocationsList } from "~/modules/resources";
import { getPeriods } from "~/modules/shared/shared.service";
import { getUserDefaults } from "~/modules/users/users.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const WEEKS_TO_PLAN = 12 * 4;

export const handle: Handle = {
  breadcrumb: "Planning",
  to: path.to.purchasingPlanning,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "purchasing",
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
        path.to.purchasing,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  const startDate = startOfWeek(today(getLocalTimeZone()), "en-US");
  const endDate = startDate.add({ weeks: WEEKS_TO_PLAN });
  const periods = await getPeriods(client, {
    startDate: startDate.toString(),
    endDate: endDate.toString(),
  });

  if (periods.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(periods.error, "Failed to load periods"))
    );
  }

  const [items] = await Promise.all([
    getPurchasingPlanning(
      client,
      locationId,
      companyId,
      periods.data?.map((p) => p.id) ?? [],
      {
        search,
        limit,
        offset,
        sorts,
        filters,
      }
    ),
  ]);

  if (items.error) {
    redirect(
      path.to.purchasing,
      await flash(request, error(items.error, "Failed to fetch planning items"))
    );
  }

  return json({
    items: (items.data ?? []) as PurchasingPlanningItem[],
    periods: periods.data ?? [],
    locationId,
  });
}

export default function PurchasingPlanningRoute() {
  const { items, locationId, periods } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full ">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          defaultSize={50}
          maxSize={70}
          minSize={25}
          className="bg-background"
        >
          <PurchasingPlanningTable
            data={items}
            count={items.length}
            locationId={locationId}
            periods={periods}
          />
        </ResizablePanel>
        <Outlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
