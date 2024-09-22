import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import { GroupedContentSidebar } from "~/components/Layout";
import { useProductionSubmodules } from "~/modules/production";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Production" }];
};

export const handle: Handle = {
  breadcrumb: "Production",
  to: path.to.production,
  module: "production",
};

export default function ProductionRoute() {
  const { groups } = useProductionSubmodules();

  return (
    <div className="grid grid-cols-[auto_1fr] w-full h-full">
      <GroupedContentSidebar groups={groups} />
      <VStack spacing={0} className="h-full">
        <Outlet />
      </VStack>
    </div>
  );
}
