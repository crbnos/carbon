import { Heading, HStack } from "@carbon/react";
import { Link } from "@remix-run/react";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { WarehouseTransfer } from "../../types";
import WarehouseTransferStatus from "./WarehouseTransferStatus";

type WarehouseTransferHeaderProps = {
  warehouseTransfer: WarehouseTransfer;
};

const WarehouseTransferHeader = ({
  warehouseTransfer,
}: WarehouseTransferHeaderProps) => {
  const permissions = usePermissions();

  const canShip =
    warehouseTransfer.status === "Confirmed" &&
    warehouseTransfer.shippedQuantity < warehouseTransfer.totalQuantity;

  const canReceive =
    warehouseTransfer.status === "In Transit" ||
    warehouseTransfer.status === "Partially Received";

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
      <HStack className="w-full justify-between">
        <HStack>
          <Link to={path.to.warehouseTransferDetails(warehouseTransfer.id)}>
            <Heading size="h4" className="flex items-center gap-2">
              <span>{warehouseTransfer.transferId}</span>
            </Heading>
          </Link>
          <WarehouseTransferStatus status={warehouseTransfer.status} />
        </HStack>
      </HStack>
    </div>
  );
};

export default WarehouseTransferHeader;
