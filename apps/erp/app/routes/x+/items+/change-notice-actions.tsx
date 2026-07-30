import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getChangeNoticeRequiredActions } from "~/modules/items";
import { ChangeNoticeRequiredActionsTable } from "~/modules/items/ui/ChangeNoticeActions";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Change Notice Actions`,
  to: path.to.changeNoticeRequiredActions
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  return await getChangeNoticeRequiredActions(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function ChangeNoticeActionsRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ChangeNoticeRequiredActionsTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
