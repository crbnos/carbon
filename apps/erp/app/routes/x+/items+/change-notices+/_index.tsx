import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getChangeNotices, getChangeNoticeTypesList } from "~/modules/items";
import { ChangeNoticesTable } from "~/modules/items/ui/ChangeNotice";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

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

  const [changeNotices, types] = await Promise.all([
    getChangeNotices(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getChangeNoticeTypesList(client, companyId)
  ]);

  if (changeNotices.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(changeNotices.error, "Error loading change notices")
      )
    );
  }

  return {
    changeNotices: changeNotices.data ?? [],
    count: changeNotices.count ?? 0,
    types: types.data ?? []
  };
}

export default function ChangeNoticesIndexRoute() {
  const { changeNotices, count, types } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ChangeNoticesTable data={changeNotices} count={count} types={types} />
      <Outlet />
    </VStack>
  );
}
