import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import { getShelvesList } from "~/modules/inventory";
import { getUnitOfMeasuresList } from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Receipt" }];
};

export const handle: Handle = {
  breadcrumb: "Inventory",
  to: path.to.receipts,
  module: "inventory",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
  });

  const [unitOfMeasures, locations, shelves] = await Promise.all([
    getUnitOfMeasuresList(client, companyId),
    getLocationsList(client, companyId),
    getShelvesList(client, companyId),
  ]);

  return {
    locations: locations?.data ?? [],
    unitOfMeasures: unitOfMeasures?.data ?? [],
    shelves: shelves?.data ?? [],
  };
}

export default function ReceiptRoute() {
  return (
    <div className="flex h-full w-full justify-center">
      <VStack spacing={4} className="h-full p-2 w-full max-w-[80rem]">
        <Outlet />
      </VStack>
    </div>
  );
}
