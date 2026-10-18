// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import BatchesTable from "~/modules/production/ui/Batches/BatchesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Batches`,
  to: path.to.operationBatches
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const batches = await api.production.getJobOperationBatches({
    search,
    limit,
    offset,
    sorts,
    filters
  });

  const batchIds = (batches.data?.rows ?? []).map((b) => b.id);
  const [stats, members] = await Promise.all([
    api.production.getJobOperationBatchMemberStats({ batchIds }),
    api.production.getJobOperationBatchMembers({ batchIds })
  ]);

  return {
    count: batches.data?.count ?? 0,
    batches: (batches.data?.rows ?? []).map((b) => ({
      ...b,
      memberCount: stats.data?.[b.id]?.memberCount ?? 0,
      totalQuantity: stats.data?.[b.id]?.totalQuantity ?? 0,
      // Header work center when assigned; else the members' shared one (the
      // board's own fallback) — a board-created batch has no header WC until
      // its card is dragged.
      workCenterName:
        b.workCenter?.name ?? stats.data?.[b.id]?.workCenterName ?? null,
      // Member rows for the expandable sub-list.
      members: members.data?.[b.id] ?? []
    }))
  };
}

export default function BatchesRoute() {
  const { batches, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <BatchesTable data={batches} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
