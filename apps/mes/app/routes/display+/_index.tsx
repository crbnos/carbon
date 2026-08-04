import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Combobox, Heading } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuMonitor, LuWrench } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { userContext } from "~/context";
import { getWorkCentersForDisplayPicker } from "~/services/display.service";
import { getLocationsByCompany } from "~/services/operations.service";
import { path } from "~/utils/path";

/**
 * Picker for the wall displays. Not itself a display — this is the page you
 * open once on a new screen to choose which board it will show, then leave.
 *
 * Opens in its own tab with no sidebar, so it can't lean on the location
 * switcher the rest of MES uses. The `location` search param is that switcher:
 * it defaults to the user's session location and narrows the list to the work
 * centers at whichever location is picked.
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const sessionLocationId = context.get(userContext)?.locationId;
  if (!sessionLocationId) throw notFound("Location not found");

  const serviceRole = getCarbonServiceRole();
  const locations = await getLocationsByCompany(serviceRole, companyId);
  const locationOptions = locations.data ?? [];

  // Honor the filter only when it names a real location for this company;
  // otherwise fall back to the location the session is already scoped to.
  const requestedLocationId = new URL(request.url).searchParams.get("location");
  const locationId =
    requestedLocationId &&
    locationOptions.some((location) => location.id === requestedLocationId)
      ? requestedLocationId
      : sessionLocationId;

  const workCenters = await getWorkCentersForDisplayPicker(serviceRole, {
    companyId,
    locationId
  });

  return {
    workCenters: workCenters.data ?? [],
    locations: locationOptions,
    locationId
  };
}

export default function DisplayIndexRoute() {
  const { t } = useLingui();
  const { workCenters, locations, locationId } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  return (
    <div className="min-h-dvh w-full bg-background p-8">
      <div className="mx-auto max-w-4xl">
        <Heading size="h2">
          <Trans>Work Center Displays</Trans>
        </Heading>
        <p className="mt-2 text-sm text-muted-foreground">
          <Trans>
            Open a display on the screen mounted at the work center and leave it
            running. Each board refreshes on its own.
          </Trans>
        </p>

        {locations.length > 1 ? (
          <div className="mt-6 max-w-xs">
            <Combobox
              size="lg"
              value={locationId}
              options={locations.map((location) => ({
                label: location.name,
                value: location.id
              }))}
              placeholder={t`Filter by location`}
              onChange={(value) =>
                setSearchParams(
                  (prev) => {
                    if (value) prev.set("location", value);
                    else prev.delete("location");
                    return prev;
                  },
                  { replace: true }
                )
              }
            />
          </div>
        ) : null}

        {workCenters.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">
            <Trans>No active work centers at this location.</Trans>
          </p>
        ) : (
          <ul className="mt-8 divide-y divide-border border-y border-border">
            {workCenters.map((workCenter) => (
              <li
                key={workCenter.id}
                className="flex flex-wrap items-center justify-between gap-4 py-4"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{workCenter.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {workCenter.locationName}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <DisplayLink
                    to={path.to.maintenanceDisplay(workCenter.id!)}
                    icon={<LuWrench />}
                    label={<Trans>Maintenance</Trans>}
                  />
                  <DisplayLink
                    to={path.to.workDisplay(workCenter.id!)}
                    icon={<LuMonitor />}
                    label={<Trans>Current work</Trans>}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DisplayLink({
  to,
  icon,
  label
}: {
  to: string;
  icon: React.ReactNode;
  label: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
    >
      {icon}
      {label}
    </Link>
  );
}
