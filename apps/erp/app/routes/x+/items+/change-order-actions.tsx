import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getChangeOrderRequiredActions } from "~/modules/items";
import { ChangeOrderRequiredActionsTable } from "~/modules/items/ui/ChangeOrderActions";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Change Order Actions`,
  to: path.to.changeOrderRequiredActions
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

  return await getChangeOrderRequiredActions(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function ChangeOrderActionsRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ChangeOrderRequiredActionsTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
