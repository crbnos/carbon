import { VStack } from "@carbon/react";

import { useParams } from "@remix-run/react";
import { DetailsTopbar } from "~/components/Layout";
import { useInventoryNavigation } from "./useInventoryNavigation";

const InventoryItemHeader = () => {
  const links = useInventoryNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        <DetailsTopbar links={links} />
      </VStack>
    </div>
  );
};

export default InventoryItemHeader;
