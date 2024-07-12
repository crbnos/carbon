import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { getUnitOfMeasuresList } from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Sales RFQ" }];
};

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.sales,
  module: "sales",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
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

export default function SalesRFQRoute() {
  return <Outlet />;
}
