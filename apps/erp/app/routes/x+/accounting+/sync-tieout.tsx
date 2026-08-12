import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getAccountingSyncTieOut } from "~/modules/accounting";
import { SyncTieOutTable } from "~/modules/accounting/ui/SyncTieOut";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Sync Tie-Out`,
  to: path.to.accountingSyncTieOut
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const integration = url.searchParams.get("integration");
  const accountingPeriodId = url.searchParams.get("periodId");

  const tieOut = await getAccountingSyncTieOut(client, companyId, {
    integration,
    accountingPeriodId
  });

  return {
    data: tieOut.data ?? [],
    count: tieOut.data?.length ?? 0
  };
}

export default function SyncTieOutRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SyncTieOutTable data={data} count={count} />
      <Outlet />
    </VStack>
  );
}
