import {
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  VStack,
} from "@carbon/react";
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
        <ScrollArea className="h-[calc(100vh-99px)]">
          <InventoryItemHeader />
          <VStack className="p-2">
            <Outlet />
          </VStack>
        </ScrollArea>
      </ResizablePanel>
    </>
  );
}
