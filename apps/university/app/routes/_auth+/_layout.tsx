import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";

export default function PublicRoute() {
  return (
    <div className="flex min-h-screen min-w-screen">
      <VStack
        spacing={8}
        className="items-center justify-start pt-[20vh] mx-auto max-w-lg z-[3]"
      >
        <Outlet />
      </VStack>
    </div>
  );
}
