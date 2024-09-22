import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import { GroupedContentSidebar } from "~/components/Layout";
import { getShelvesList, useInventorySubmodules } from "~/modules/inventory";
import { getUnitOfMeasuresList } from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Inventory" }];
};

export const handle: Handle = {
  breadcrumb: "Inventory",
  to: path.to.inventory,
  module: "inventory",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const [unitOfMeasures, locations, shelves] = await Promise.all([
    getUnitOfMeasuresList(client, companyId),
    getLocationsList(client, companyId),
    getShelvesList(client, companyId),
  ]);

  return {
    locations: locations?.data ?? [],
    shelves: shelves?.data ?? [],
    unitOfMeasures: unitOfMeasures?.data ?? [],
  };
}

export default function InventoryRoute() {
  const { groups } = useInventorySubmodules();

  return (
    <div className="grid grid-cols-[auto_1fr] w-full h-full">
      <GroupedContentSidebar groups={groups} />
      <VStack spacing={0} className="h-full">
        <Outlet />
      </VStack>
    </div>
  );
}
