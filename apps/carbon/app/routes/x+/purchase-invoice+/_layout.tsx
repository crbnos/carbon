import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import { getShelvesList } from "~/modules/inventory";
import { getLocationsList } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Invoicing" }];
};

export const handle: Handle = {
  breadcrumb: "Invoicing",
  to: path.to.purchaseInvoices,
  module: "invoicing",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing",
  });

  const [locations, shelves] = await Promise.all([
    getLocationsList(client, companyId),
    getShelvesList(client, companyId),
  ]);

  return {
    locations: locations?.data ?? [],
    shelves: shelves?.data ?? [],
  };
}

export default function PurchaseInvoiceRoute() {
  return (
    <VStack spacing={4} className="h-full p-2">
      <Outlet />
    </VStack>
  );
}
