// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { datetime, redirect } from "@carbon/utils";
import { toZoned } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { ServiceVisitStatus } from "~/modules/service/service.models";
import { getServiceVisits } from "~/modules/service/service.service";
import MyVisits from "~/modules/service/ui/Visits/MyVisits";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`My Visits`,
  to: path.to.myVisits
};

/** Today and the next 7 days. */
const MY_VISITS_DAYS = 8;

/** Every visit but a cancelled one. */
const SHOWN_STATUSES: ServiceVisitStatus[] = [
  "Scheduled",
  "Traveling",
  "On Site",
  "Completed"
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "service"
  });

  const timeZone = await getCompanyTimeZone(client, companyId);
  const today = datetime.today(timeZone);
  const visits = await getServiceVisits(client, companyId, {
    technicianId: userId,
    from: toZoned(today, timeZone).toAbsoluteString(),
    to: toZoned(
      today.add({ days: MY_VISITS_DAYS }),
      timeZone
    ).toAbsoluteString(),
    status: SHOWN_STATUSES
  });
  if (visits.error) {
    throw redirect(
      path.to.serviceOrders,
      await flash(request, error(visits.error, "Failed to load your visits"))
    );
  }

  return {
    visits: visits.data ?? [],
    timeZone,
    today: today.toString()
  };
}

export default function MyVisitsRoute() {
  const { visits, timeZone, today } = useLoaderData<typeof loader>();
  return <MyVisits visits={visits} timeZone={timeZone} today={today} />;
}
