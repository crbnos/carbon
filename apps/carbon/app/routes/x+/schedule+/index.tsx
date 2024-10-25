import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData } from "@remix-run/react";
import { json, redirect, type LoaderFunctionArgs } from "@vercel/remix";
import type { Column } from "~/components/Kanban";
import { getJobOperationsByLocation } from "~/modules/production";
import {
  getLocationsList,
  getWorkCentersByLocation,
} from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";

export const handle: Handle = {
  breadcrumb: "Schedule",
  to: path.to.schedule,
  module: "schedule",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

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

  const [workCenters, operations] = await Promise.all([
    getWorkCentersByLocation(client, locationId),
    getJobOperationsByLocation(client, locationId),
  ]);

  return json({
    columns: (workCenters.data?.map((wc) => ({
      id: wc.id!,
      title: wc.name!,
      type:
        (wc.processes as { id: string; name: string }[] | undefined)?.map(
          (p) => p.id
        ) ?? [],
    })) ?? []) satisfies Column[],
    operations: operations.data ?? [],
  });
}

export default function ScheduleRoute() {
  const loaderData = useLoaderData<typeof loader>();
  return <pre>{JSON.stringify(loaderData, null, 2)}</pre>;
}
