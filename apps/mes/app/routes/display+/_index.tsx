import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Heading } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuMonitor, LuWrench } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { userContext } from "~/context";
import { getWorkCentersForDisplayPicker } from "~/services/display.service";
import { path } from "~/utils/path";

/**
 * Picker for the wall displays. Not itself a display — this is the page you
 * open once on a new screen to choose which board it will show, then leave.
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const locationId = context.get(userContext)?.locationId;
  if (!locationId) throw notFound("Location not found");

  const workCenters = await getWorkCentersForDisplayPicker(
    getCarbonServiceRole(),
    { companyId, locationId }
  );

  return { workCenters: workCenters.data ?? [] };
}

export default function DisplayIndexRoute() {
  const { workCenters } = useLoaderData<typeof loader>();

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
