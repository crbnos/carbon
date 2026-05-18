import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import { useInventorySubmodules } from "~/modules/inventory";
import { getUnitOfMeasuresList } from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Inventory" }];
};

export const handle: Handle = {
  breadcrumb: msg`Inventory`,
  to: path.to.inventory,
  module: "inventory"
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "inventory"
  });

  const [unitOfMeasures, locations] = await Promise.all([
    getUnitOfMeasuresList(),
    getLocationsList()
  ]);

  return {
    locations: locations?.data ?? [],
    unitOfMeasures: unitOfMeasures?.data ?? []
  };
}

export default function InventoryRoute() {
  const { groups } = useInventorySubmodules();

  return (
    <CollapsibleSidebarProvider>
      <div className="grid grid-cols-[auto_1fr] w-full h-full">
        <GroupedContentSidebar groups={groups} />
        <VStack spacing={0} className="h-full">
          <Outlet />
        </VStack>
      </div>
    </CollapsibleSidebarProvider>
  );
}
