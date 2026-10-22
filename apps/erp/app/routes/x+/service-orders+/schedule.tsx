// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { datetime, redirect } from "@carbon/utils";
import { parseDate, toZoned } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { ServiceVisitStatus } from "~/modules/service/service.models";
import { serviceVisitStatuses } from "~/modules/service/service.models";
import { getServiceVisits } from "~/modules/service/service.service";
import ServiceSchedule, {
  OPEN_VISITS
} from "~/modules/service/ui/Visits/ServiceSchedule";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Schedule`,
  to: path.to.serviceSchedule
};

/** The days the schedule shows. */
const SCHEDULE_DAYS = 7;

/** The visits not yet done. */
const OPEN_STATUSES: ServiceVisitStatus[] = [
  "Scheduled",
  "Traveling",
  "On Site"
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });

  const searchParams = new URL(request.url).searchParams;
  const timeZone = await getCompanyTimeZone(client, companyId);
  const fromParam = searchParams.get("from");
  const from =
    fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)
      ? fromParam
      : datetime.today(timeZone).toString();
  // The window is whole days on the company's calendar.
  const start = parseDate(from);
  const statusParam = searchParams.get("status") ?? OPEN_VISITS;
  const status =
    statusParam === OPEN_VISITS
      ? OPEN_STATUSES
      : (serviceVisitStatuses as readonly string[]).includes(statusParam)
        ? [statusParam as ServiceVisitStatus]
        : null;

  const visits = await getServiceVisits(client, companyId, {
    technicianId: searchParams.get("technicianId"),
    from: toZoned(start, timeZone).toAbsoluteString(),
    to: toZoned(
      start.add({ days: SCHEDULE_DAYS }),
      timeZone
    ).toAbsoluteString(),
    status
  });
  if (visits.error) {
    throw redirect(
      path.to.serviceOrders,
      await flash(request, error(visits.error, "Failed to load the schedule"))
    );
  }

  return {
    visits: visits.data ?? [],
    timeZone,
    from,
    days: SCHEDULE_DAYS
  };
}

export default function ServiceScheduleRoute() {
  const { visits, timeZone, from, days } = useLoaderData<typeof loader>();
  return (
    <ServiceSchedule
      visits={visits}
      timeZone={timeZone}
      from={from}
      days={days}
    />
  );
}
