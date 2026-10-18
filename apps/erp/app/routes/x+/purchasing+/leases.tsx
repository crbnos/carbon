// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { LeasesTable } from "~/modules/purchasing/ui/Leases";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Leases`,
  to: path.to.leases
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "purchasing"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const leases = await api.purchasing.getLeases({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (leases.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(leases.error, "Failed to fetch leases"))
    );
  }

  return {
    count: leases.data?.count ?? 0,
    leases: leases.data?.rows ?? []
  };
}

export default function LeasesRoute() {
  const { count, leases } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <LeasesTable data={leases} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
