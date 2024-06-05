import { VStack } from "@carbon/react";
import type { MetaFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { GroupedContentSidebar } from "~/components/Layout";
import { usePartsSubmodules } from "~/modules/parts";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Items" }];
};

export const handle: Handle = {
  breadcrumb: "Items",
  to: path.to.parts,
  module: "parts",
};

export default function PartsRoute() {
  const { groups } = usePartsSubmodules();

  return (
    <div className="grid grid-cols-[auto_1fr] w-full h-full">
      <GroupedContentSidebar groups={groups} />
      <VStack spacing={0} className="h-full">
        <Outlet />
      </VStack>
    </div>
  );
}
