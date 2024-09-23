import { Button, VStack } from "@carbon/react";

import { useNavigate, useParams } from "@remix-run/react";
import { LuX } from "react-icons/lu";
import { DetailsTopbar } from "~/components/Layout";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import { useInventoryNavigation } from "./useInventoryNavigation";

type InventoryItemHeaderProps = {
  itemReadableId: string;
};

const InventoryItemHeader = ({ itemReadableId }: InventoryItemHeaderProps) => {
  const links = useInventoryNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");
  const [params] = useUrlParams();

  const navigate = useNavigate();

  return (
    <div>
      <VStack className="w-full">
        <div className="flex justify-between items-center border-b border-border p-2 bg-card w-full">
          <Button
            isIcon
            variant="ghost"
            onClick={() =>
              navigate(`${path.to.inventory}?${params.toString()}`)
            }
          >
            <LuX className="w-4 h-4" />
          </Button>
          <span className="font-semibold text-center">{itemReadableId}</span>
          <DetailsTopbar links={links} preserveParams />
        </div>
      </VStack>
    </div>
  );
};

export default InventoryItemHeader;
