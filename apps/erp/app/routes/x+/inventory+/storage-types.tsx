import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getStorageTypes } from "~/modules/inventory";
import StorageTypesTable from "~/modules/inventory/ui/StorageTypes/StorageTypesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "storage-types");

export const handle: Handle = {
  breadcrumb: msg`Storage Types`,
  to: path.to.storageTypes
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

  const storageTypes = await getStorageTypes(client, companyId, {
    limit,
    offset,
    sorts,
    search,
    filters
  });

  if (storageTypes.error) {
    logger.error(storageTypes.error);
    throw redirect(
      path.to.inventory,
      await flash(request, error(null, "Error loading storage types"))
    );
  }

  return {
    storageTypes: storageTypes.data ?? [],
    count: storageTypes.count ?? 0
  };
}

export default function StorageTypesRoute() {
  const { storageTypes, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <StorageTypesTable data={storageTypes} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
