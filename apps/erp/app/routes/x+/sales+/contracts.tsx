// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getContracts } from "~/modules/sales";
import { ContractsTable } from "~/modules/sales/ui/Contracts";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Service Contracts`,
  to: path.to.contracts
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const contracts = await getContracts(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (contracts.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(contracts.error, "Failed to fetch contracts"))
    );
  }

  return {
    count: contracts.count ?? 0,
    contracts: contracts.data ?? []
  };
}

export default function ContractsRoute() {
  const { count, contracts } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ContractsTable data={contracts} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
