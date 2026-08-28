import { VStack } from "@carbon/react";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";

export const handle: Handle = {
  module: "sales"
};

export default function WarrantyRegistrationLayout() {
  return (
    <VStack spacing={0} className="h-full">
      <Outlet />
    </VStack>
  );
}
