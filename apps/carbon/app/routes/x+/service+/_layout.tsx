import { requirePermissions } from "@carbon/auth/auth.server";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import { getItemPostingGroupsList } from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Service" }];
};

export const handle: Handle = {
  breadcrumb: "Items",
  to: path.to.items,
  module: "items",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const [itemPostingGroups, locations] = await Promise.all([
    getItemPostingGroupsList(client, companyId),
    getLocationsList(client, companyId),
  ]);

  return {
    locations: locations?.data ?? [],
    itemPostingGroups: itemPostingGroups?.data ?? [],
  };
}

export default function ServiceRoute() {
  return <Outlet />;
}
