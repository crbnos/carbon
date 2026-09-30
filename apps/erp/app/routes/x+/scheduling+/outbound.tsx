import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { datetime } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getCompletionJobs } from "~/modules/production";
import type { OutboundRow } from "~/modules/production/ui/Schedule/OutboundTable";
import {
  isOutboundHorizon,
  OutboundTable
} from "~/modules/production/ui/Schedule/OutboundTable";
import { jobOperationValidator } from "~/modules/sales/ui/CustomerPortal";
import { resolveLocationId } from "~/modules/shared/location.server";
import { getLocationTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Outbound`,
  to: path.to.scheduleOutbound,
  module: "production"
};

const logger = getLogger("erp", "scheduling", "outbound");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production"
  });

  const searchParams = new URL(request.url).searchParams;
  const locationId = await resolveLocationId(client, request, {
    searchParams,
    userId,
    companyId,
    onDefaultsError: path.to.production,
    onNoLocations: path.to.production
  });

  const horizonParam = searchParams.get("horizon");
  const horizon = isOutboundHorizon(horizonParam) ? horizonParam : "14";

  // Completion days belong to the plant's calendar, not the server's.
  const timeZone = await getLocationTimeZone(client, locationId, companyId);
  const today = datetime.today(timeZone);

  const jobs = await getCompletionJobs(client, {
    companyId,
    locationId,
    timeZone,
    // "Next N days" counts today.
    throughDate:
      horizon === "all"
        ? null
        : today.add({ days: Number(horizon) - 1 }).toString(),
    search: searchParams.get("search")
  });

  if (jobs.error) {
    logger.error("Failed to load outbound jobs", {
      companyId,
      locationId,
      error: jobs.error
    });
    throw redirect(
      path.to.production,
      await flash(request, error(jobs.error, "Failed to load outbound jobs"))
    );
  }

  const rows: OutboundRow[] = (jobs.data ?? []).map(
    ({ jobOperations, ...job }) => ({
      ...job,
      operations: jobOperationValidator.safeParse(jobOperations).data ?? []
    })
  );

  return {
    rows,
    locationId,
    horizon,
    timeZone,
    today: today.toString()
  };
}

export default function OutboundRoute() {
  const { rows, locationId, horizon, timeZone, today } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <OutboundTable
        rows={rows}
        locationId={locationId}
        horizon={horizon}
        timeZone={timeZone}
        today={today}
      />
    </VStack>
  );
}
