import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { getItemGroupsList } from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Service" }];
};

export const handle: Handle = {
  breadcrumb: "Items",
  to: path.to.items,
  module: "parts",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const [itemGroups, locations] = await Promise.all([
    getItemGroupsList(client, companyId),
    getLocationsList(client, companyId),
  ]);

  return {
    locations: locations?.data ?? [],
    itemGroups: itemGroups?.data ?? [],
  };
}

export default function ServiceRoute() {
  return <Outlet />;
}
