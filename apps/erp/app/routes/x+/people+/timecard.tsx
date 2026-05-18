import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getTimecardEntries } from "~/modules/people";
import { TimecardsTable } from "~/modules/people/ui/Timecards";
import { getCompanySettings } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Timecards`,
  to: path.to.peopleTimecard
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people"
  });

  const companySettings = await getCompanySettings();
  if (!companySettings.data?.timeCardEnabled) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(
          null,
          "Timecards are not enabled. To enable this feature, go to Settings → People to enable Timecards."
        )
      )
    );
  }

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const entries = await getTimecardEntries({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (entries.error) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(entries.error, "Failed to load timecard entries")
      )
    );
  }

  return {
    entries: entries.data ?? [],
    count: entries.count ?? 0
  };
}

export default function Route() {
  const { entries, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <TimecardsTable data={entries} count={count} />
      <Outlet />
    </VStack>
  );
}
