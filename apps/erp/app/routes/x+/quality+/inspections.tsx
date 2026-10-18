// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import InspectionsTable from "~/modules/quality/ui/Inspections/InspectionsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["inspection"],
  breadcrumb: msg`Inspections`,
  to: path.to.inspections
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "quality",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const source = searchParams.get("source");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const inspections = await api.quality.getInspections({
    search,
    status,
    source,
    limit,
    offset,
    sorts,
    filters
  });

  if (inspections.error) {
    throw redirect(
      path.to.quality,
      await flash(
        request,
        error(inspections.error, "Failed to load inspections")
      )
    );
  }

  return {
    inspections: inspections.data?.rows ?? [],
    count: inspections.data?.count ?? 0
  };
}

export default function InspectionsRoute() {
  const { inspections, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <InspectionsTable data={inspections} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
