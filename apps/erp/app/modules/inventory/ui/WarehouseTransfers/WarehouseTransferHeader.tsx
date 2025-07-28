import { useCarbon } from "@carbon/auth";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  toast,
} from "@carbon/react";
import { Link, useFetcher } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import {
  LuCheckCheck,
  LuChevronDown,
  LuCirclePlus,
  LuCircleStop,
  LuHandCoins,
  LuLoaderCircle,
  LuTruck,
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { action as statusAction } from "~/routes/x+/warehouse-transfer+/$transferId.status";
import { path } from "~/utils/path";
import type { Receipt, Shipment, WarehouseTransfer } from "../../types";
import { ReceiptStatus } from "../Receipts";
import { ShipmentStatus } from "../Shipments";
import WarehouseTransferStatus from "./WarehouseTransferStatus";

type WarehouseTransferHeaderProps = {
  warehouseTransfer: WarehouseTransfer;
};

const WarehouseTransferHeader = ({
  warehouseTransfer,
}: WarehouseTransferHeaderProps) => {
  const permissions = usePermissions();
  const statusFetcher = useFetcher<typeof statusAction>();

  const { receipts, shipments, ship, receive } =
    useWarehouseTransferRelatedDocuments(warehouseTransfer.id);

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
        <HStack>
          <statusFetcher.Form
            method="post"
            action={path.to.warehouseTransferStatus(warehouseTransfer.id)}
          >
            <input type="hidden" name="status" value="To Ship and Receive" />
            <Button
              type="submit"
              leftIcon={<LuCheckCheck />}
              variant={
                warehouseTransfer.status === "Draft" ? "primary" : "secondary"
              }
              isDisabled={
                !["Draft"].includes(warehouseTransfer.status) ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "inventory")
              }
              isLoading={
                statusFetcher.state !== "idle" &&
                statusFetcher.formData?.get("status") === "To Ship and Receive"
              }
            >
              Confirm
            </Button>
          </statusFetcher.Form>

          <statusFetcher.Form
            method="post"
            action={path.to.warehouseTransferStatus(warehouseTransfer.id)}
          >
            <input type="hidden" name="status" value="Cancelled" />
            <Button
              type="submit"
              variant="secondary"
              leftIcon={<LuCircleStop />}
              isDisabled={
                ["Cancelled", "Completed"].includes(warehouseTransfer.status) ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "inventory")
              }
              isLoading={
                statusFetcher.state !== "idle" &&
                statusFetcher.formData?.get("status") === "Cancelled"
              }
            >
              Cancel
            </Button>
          </statusFetcher.Form>

          {shipments.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  leftIcon={<LuTruck />}
                  variant="secondary"
                  rightIcon={<LuChevronDown />}
                >
                  Shipments
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  disabled={
                    !["To Ship", "To Ship and Receive"].includes(
                      warehouseTransfer.status ?? ""
                    )
                  }
                  onClick={() => {
                    ship(warehouseTransfer);
                  }}
                >
                  <DropdownMenuIcon icon={<LuCirclePlus />} />
                  New Shipment
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {shipments.map((shipment) => (
                  <DropdownMenuItem key={shipment.id} asChild>
                    <Link to={path.to.shipment(shipment.id)}>
                      <DropdownMenuIcon icon={<LuTruck />} />
                      <HStack spacing={8}>
                        <span>{shipment.shipmentId}</span>
                        <ShipmentStatus status={shipment.status} />
                      </HStack>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              leftIcon={<LuTruck />}
              isDisabled={
                !["To Ship", "To Ship and Receive"].includes(
                  warehouseTransfer.status ?? ""
                )
              }
              variant={
                ["To Ship", "To Ship and Receive"].includes(
                  warehouseTransfer.status ?? ""
                )
                  ? "primary"
                  : "secondary"
              }
              onClick={() => {
                ship(warehouseTransfer);
              }}
            >
              Ship
            </Button>
          )}
          {receipts.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  leftIcon={<LuHandCoins />}
                  variant={
                    ["To Receive", "To Ship and Receive"].includes(
                      warehouseTransfer.status ?? ""
                    )
                      ? "primary"
                      : "secondary"
                  }
                  rightIcon={<LuChevronDown />}
                >
                  Receipts
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  disabled={
                    !["To Receive", "To Ship and Receive"].includes(
                      warehouseTransfer.status ?? ""
                    )
                  }
                  onClick={() => {
                    receive(warehouseTransfer);
                  }}
                >
                  <DropdownMenuIcon icon={<LuCirclePlus />} />
                  New Receipt
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {receipts.map((receipt) => (
                  <DropdownMenuItem key={receipt.id} asChild>
                    <Link to={path.to.receipt(receipt.id)}>
                      <DropdownMenuIcon icon={<LuHandCoins />} />
                      <HStack spacing={8}>
                        <span>{receipt.receiptId}</span>
                        <ReceiptStatus status={receipt.status} />
                      </HStack>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              leftIcon={<LuHandCoins />}
              isDisabled={
                !["To Receive", "To Ship and Receive"].includes(
                  warehouseTransfer.status ?? ""
                )
              }
              variant={
                ["To Receive", "To Ship and Receive"].includes(
                  warehouseTransfer.status ?? ""
                )
                  ? "primary"
                  : "secondary"
              }
              onClick={() => {
                receive(warehouseTransfer);
              }}
            >
              Receive
            </Button>
          )}
          <statusFetcher.Form
            method="post"
            action={path.to.warehouseTransferStatus(warehouseTransfer.id)}
          >
            <input type="hidden" name="status" value="Draft" />
            <Button
              type="submit"
              variant="secondary"
              leftIcon={<LuLoaderCircle />}
              isDisabled={
                ["Draft"].includes(warehouseTransfer.status ?? "") ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "inventory")
              }
              isLoading={
                statusFetcher.state !== "idle" &&
                statusFetcher.formData?.get("status") === "Draft"
              }
            >
              Reopen
            </Button>
          </statusFetcher.Form>
        </HStack>
      </HStack>
    </div>
  );
};

export default WarehouseTransferHeader;

export const useWarehouseTransferRelatedDocuments = (
  warehouseTransferId: string
) => {
  const [receipts, setReceipts] = useState<
    Pick<Receipt, "id" | "receiptId" | "status">[]
  >([]);

  const [shipments, setShipments] = useState<
    Pick<Shipment, "id" | "shipmentId" | "status">[]
  >([]);

  const { carbon } = useCarbon();

  const ship = useCallback((warehouseTransfer: WarehouseTransfer) => {
    // Navigate to ship route
    window.location.href = path.to.warehouseTransferShip(warehouseTransfer.id);
  }, []);

  const receive = useCallback((warehouseTransfer: WarehouseTransfer) => {
    // Navigate to receive route
    window.location.href = path.to.warehouseTransferReceive(
      warehouseTransfer.id
    );
  }, []);

  const getRelatedDocuments = useCallback(
    async (warehouseTransferId: string) => {
      if (!carbon || !warehouseTransferId) return;
      const [receipts, shipments] = await Promise.all([
        carbon
          .from("receipt")
          .select("id, receiptId, status")
          .eq("sourceDocument", "Inbound Transfer")
          .eq("sourceDocumentId", warehouseTransferId),
        carbon
          .from("shipment")
          .select("id, shipmentId, status")
          .eq("sourceDocument", "Outbound Transfer")
          .eq("sourceDocumentId", warehouseTransferId),
      ]);

      if (receipts.error) {
        toast.error("Failed to load receipts");
      } else {
        setReceipts(receipts.data);
      }

      if (shipments.error) {
        toast.error("Failed to load shipments");
      } else {
        setShipments(shipments.data);
      }
    },
    [carbon]
  );

  useEffect(() => {
    getRelatedDocuments(warehouseTransferId);
  }, [getRelatedDocuments, warehouseTransferId]);

  return { receipts, shipments, ship, receive };
};
