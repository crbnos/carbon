import { VStack } from "@carbon/react";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";

// Detail tree for a repair order. Declares the SALES module so nav, permissions
// and breadcrumbs resolve there — repairs add no module or permission scope.
export const handle: Handle = {
  module: "sales"
};

export default function RepairOrderLayout() {
  return (
    <VStack spacing={0} className="h-full">
      <Outlet />
    </VStack>
  );
}
