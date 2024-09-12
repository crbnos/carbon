import { ResizableHandle, ResizablePanel, VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import InventoryItemHeader from "~/modules/inventory/ui/Inventory/InventoryItemHeader";

export default function ItemInventoryRoute() {
  return (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel
        defaultSize={50}
        maxSize={70}
        minSize={25}
        className="bg-background"
      >
        <InventoryItemHeader />
        <VStack className="p-2">
          <Outlet />
        </VStack>
      </ResizablePanel>
    </>
  );
}
