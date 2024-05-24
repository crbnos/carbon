import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { getAttributeDataTypes } from "~/modules/resources";
import { CustomFieldsTable, getCustomFieldsTables } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Custom Fields",
  to: path.to.customFields,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [tables, dataTypes] = await Promise.all([
    getCustomFieldsTables(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getAttributeDataTypes(client),
  ]);

  if (tables.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(tables.error, "Failed to fetch custom fields"))
    );
  }

  return json({
    count: tables.count ?? 0,
    tables: tables.data ?? [],
    dataTypes: dataTypes.data ?? [],
  });
}

export default function UserAttributesRoute() {
  const { count, tables } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomFieldsTable data={tables} count={count} />
      <Outlet />
    </VStack>
  );
}
