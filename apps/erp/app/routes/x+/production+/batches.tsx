import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import {
  getJobOperationBatches,
  getJobOperationBatchMemberStats
} from "~/modules/production";
import BatchesTable from "~/modules/production/ui/Batches/BatchesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Batches`,
  to: path.to.operationBatches
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const batches = await getJobOperationBatches(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  const stats = await getJobOperationBatchMemberStats(
    client,
    companyId,
    (batches.data ?? []).map((b) => b.id)
  );

  return {
    count: batches.count ?? 0,
    batches: (batches.data ?? []).map((b) => ({
      ...b,
      memberCount: stats.data[b.id]?.memberCount ?? 0,
      totalQuantity: stats.data[b.id]?.totalQuantity ?? 0
    }))
  };
}

export default function BatchesRoute() {
  const { batches, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <BatchesTable data={batches} count={count} />
      <Outlet />
    </VStack>
  );
}
