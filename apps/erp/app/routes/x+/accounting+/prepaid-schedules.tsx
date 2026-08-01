import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { LuReceipt } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useFetcher, useLoaderData } from "react-router";
import { usePermissions } from "~/hooks";
import { getPrepaidSchedules } from "~/modules/accounting";
import { PrepaidSchedulesTable } from "~/modules/accounting/ui/PrepaidSchedules";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Prepaid Schedules`,
  to: path.to.prepaidSchedules
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  return await getPrepaidSchedules(client, companyId, {
    search,
    status,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function PrepaidSchedulesRoute() {
  const { data, count } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const generateFetcher = useFetcher();

  return (
    <VStack spacing={0} className="h-full">
      <PrepaidSchedulesTable
        data={data ?? []}
        count={count ?? 0}
        primaryAction={
          permissions.can("create", "accounting") && (
            <generateFetcher.Form
              method="post"
              action={path.to.prepaidSchedulesGenerate}
            >
              <Button
                type="submit"
                variant="primary"
                leftIcon={<LuReceipt />}
                isLoading={generateFetcher.state !== "idle"}
                isDisabled={generateFetcher.state !== "idle"}
              >
                {t`Generate due now`}
              </Button>
            </generateFetcher.Form>
          )
        }
      />
      <Outlet />
    </VStack>
  );
}
