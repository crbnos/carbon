import { Button } from "@carbon/react";

import { useNavigate, useParams } from "@remix-run/react";
import { LuX } from "react-icons/lu";
import { DetailsTopbar } from "~/components/Layout";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import { useInventoryNavigation } from "./useInventoryNavigation";

const InventoryItemHeader = () => {
  const links = useInventoryNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");
  const [params] = useUrlParams();

  const navigate = useNavigate();

  return (
    <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b border-border">
      <Button
        isIcon
        variant={"ghost"}
        onClick={() => navigate(`${path.to.inventory}?${params.toString()}`)}
      >
        <LuX className="w-4 h-4" />
      </Button>
      <DetailsTopbar links={links} />
    </div>
  );
};

export default InventoryItemHeader;
