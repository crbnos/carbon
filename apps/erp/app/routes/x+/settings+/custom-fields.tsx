import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getAttributeDataTypes } from "~/modules/people";
import { CustomFieldsTable, getCustomFieldsTables } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

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

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const table = formData.get("table");
  const value = formData.get("value");

  if (typeof value !== "string" || typeof table !== "string") {
    return json({ error: { message: "Invalid table" }, data: null });
  }

  const result = await client
    // @ts-ignore
    .from(table)
    .update({
      customFields: JSON.parse(value),
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
    .in(getIdField(table), ids as string[]);

  return json(result);
}

function getIdField(table: string) {
  switch (table) {
    case "part":
    case "material":
    case "consumable":
    case "tool":
    case "fixture":
    default:
      return "id";
  }
}

export default function CustomFieldsRoute() {
  const { count, tables } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomFieldsTable data={tables} count={count} />
      <Outlet />
    </VStack>
  );
}
