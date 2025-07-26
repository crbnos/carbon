import { requirePermissions } from "@carbon/auth/auth.server";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import { getUnitOfMeasuresList } from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Consumables" }];
};

export const handle: Handle = {
  breadcrumb: "Items",
  to: path.to.items,
  module: "items",
};

export const config = {
  runtime: "nodejs",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const [unitOfMeasures, locations] = await Promise.all([
    getUnitOfMeasuresList(client, companyId),
    getLocationsList(client, companyId),
  ]);

  return {
    locations: locations?.data ?? [],
    unitOfMeasures: unitOfMeasures?.data ?? [],
  };
}

export default function ConsumableRoute() {
  return <Outlet />;
}
