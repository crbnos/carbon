import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import { GroupedContentSidebar } from "~/components/Layout";
import { useSalesSubmodules } from "~/modules/sales";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Sales" }];
};

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.salesOrders,
  module: "sales",
};

export default function SalesRoute() {
  const { groups } = useSalesSubmodules();

  return (
    <div className="grid grid-cols-[auto_1fr] w-full h-full">
      <GroupedContentSidebar groups={groups} />
      <VStack spacing={0} className="h-full">
        <Outlet />
      </VStack>
    </div>
  );
}
