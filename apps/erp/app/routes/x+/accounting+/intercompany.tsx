import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useFetcher, useLoaderData } from "react-router";
import { New } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { getIntercompanyTransactions } from "~/modules/accounting";
import { IntercompanyTransactionTable } from "~/modules/accounting/ui/Intercompany";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Intercompany`,
  to: path.to.intercompany
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const status = searchParams.get("status");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const transactions = await getIntercompanyTransactions(
    client,
    companyGroupId,
    {
      status,
      limit,
      offset,
      sorts,
      filters
    }
  );

  return {
    data: transactions.data,
    count: transactions.count
  };
}

export default function IntercompanyRoute() {
  const { data, count } = useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const permissions = usePermissions();
  const matchFetcher = useFetcher();
  const eliminateFetcher = useFetcher();

  return (
    <VStack spacing={0} className="h-full">
      <IntercompanyTransactionTable
        data={data ?? []}
        count={count ?? 0}
        primaryAction={
          permissions.can("create", "accounting") && (
            <div className="flex items-center gap-2">
              <matchFetcher.Form method="post" action="match">
                <Button
                  variant="secondary"
                  type="submit"
                  isLoading={matchFetcher.state !== "idle"}
                >
                  Run Matching
                </Button>
              </matchFetcher.Form>
              <eliminateFetcher.Form method="post" action="eliminate">
                <Button
                  variant="secondary"
                  type="submit"
                  isLoading={eliminateFetcher.state !== "idle"}
                >
                  Generate Eliminations
                </Button>
              </eliminateFetcher.Form>
              <New label="IC Transaction" to={`new?${params.toString()}`} />
            </div>
          )
        }
      />
      <Outlet />
    </VStack>
  );
}
