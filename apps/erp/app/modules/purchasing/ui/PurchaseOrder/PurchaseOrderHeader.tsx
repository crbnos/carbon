import {
  Badge,
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  Heading,
  IconButton,
  SplitButton,
  useDisclosure,
} from "@carbon/react";

import { Link, useFetcher, useParams } from "@remix-run/react";
import {
  LuCheckCheck,
  LuChevronDown,
  LuCirclePlus,
  LuCircleStop,
  LuCreditCard,
  LuEllipsisVertical,
  LuEye,
  LuFile,
  LuHandCoins,
  LuLoaderCircle,
  LuPanelLeft,
  LuPanelRight,
  LuTrash,
  LuTruck,
} from "react-icons/lu";

import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { PurchaseOrder, PurchaseOrderLine } from "../../types";

import { ReceiptStatus } from "~/modules/inventory/ui/Receipts";
import { ShipmentStatus } from "~/modules/inventory/ui/Shipments";
import PurchaseInvoicingStatus from "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicingStatus";
import PurchaseOrderFinalizeModal from "./PurchaseOrderFinalizeModal";
import PurchasingStatus from "./PurchasingStatus";
import {
  usePurchaseOrder,
  usePurchaseOrderRelatedDocuments,
} from "./usePurchaseOrder";

const PurchaseOrderHeader = () => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const { toggleExplorer, toggleProperties } = usePanels();

  const routeData = useRouteData<{
    purchaseOrder: PurchaseOrder;
    lines: PurchaseOrderLine[];
  }>(path.to.purchaseOrder(orderId));

  if (!routeData?.purchaseOrder)
    throw new Error("Failed to load purchase order");

  const permissions = usePermissions();

  const statusFetcher = useFetcher<{}>();
  const { receive, invoice, ship } = usePurchaseOrder();
  const { receipts, invoices, shipments } = usePurchaseOrderRelatedDocuments(
    routeData?.purchaseOrder?.supplierInteractionId ?? "",
    routeData?.purchaseOrder?.purchaseOrderType === "Outside Processing"
  );

  const finalizeDisclosure = useDisclosure();
  const deleteModal = useDisclosure();

  const isOutsideProcessing =
    routeData?.purchaseOrder?.purchaseOrderType === "Outside Processing";
  const hasShipments = shipments.length > 0;
  const requiresShipment = isOutsideProcessing && !hasShipments;

  const markAsPlanned = () => {
    statusFetcher.submit(
      { status: "Planned" },
      { method: "post", action: path.to.purchaseOrderStatus(orderId) }
    );
  };

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b h-[50px] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label="Toggle Explorer"
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.purchaseOrderDetails(orderId)}>
              <Heading size="h4" className="flex items-center gap-2">
                {routeData?.purchaseOrder?.purchaseOrderId}
              </Heading>
            </Link>
            <Copy text={routeData?.purchaseOrder?.purchaseOrderId ?? ""} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More options"
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  disabled={
                    !permissions.can("delete", "purchasing") ||
                    !permissions.is("employee")
                  }
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  Delete Purchase Order
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <PurchasingStatus status={routeData?.purchaseOrder?.status} />
            {isOutsideProcessing && (
              <Badge variant="default">
                {routeData?.purchaseOrder?.purchaseOrderType}
              </Badge>
            )}
          </HStack>
          <HStack>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  leftIcon={<LuEye />}
                  variant="secondary"
                  rightIcon={<LuChevronDown />}
                >
                  Preview
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <a
                    target="_blank"
                    href={path.to.file.purchaseOrder(orderId)}
                    rel="noreferrer"
                  >
                    <DropdownMenuIcon icon={<LuFile />} />
                    PDF
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <SplitButton
              leftIcon={<LuCheckCheck />}
              variant={
                ["Draft", "Planned"].includes(
                  routeData?.purchaseOrder?.status ?? ""
                )
                  ? "primary"
                  : "secondary"
              }
              onClick={finalizeDisclosure.onOpen}
              isDisabled={
                !["Draft", "Planned"].includes(
                  routeData?.purchaseOrder?.status ?? ""
                ) || routeData?.lines.length === 0
              }
              dropdownItems={[
                {
                  label: "Mark as Planned",
                  icon: <LuCheckCheck />,
                  onClick: markAsPlanned,
                },
              ]}
            >
              Finalize
            </SplitButton>
            {routeData?.purchaseOrder?.purchaseOrderType ===
              "Outside Processing" &&
              (shipments.length > 0 ? (
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
                        ![
                          "To Receive",
                          "To Receive and Invoice",
                          "To Invoice",
                        ].includes(routeData?.purchaseOrder?.status ?? "")
                      }
                      onClick={() => {
                        ship(routeData?.purchaseOrder);
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
                    !["To Receive", "To Receive and Invoice"].includes(
                      routeData?.purchaseOrder?.status ?? ""
                    )
                  }
                  variant={
                    ["To Receive", "To Receive and Invoice"].includes(
                      routeData?.purchaseOrder?.status ?? ""
                    )
                      ? "primary"
                      : "secondary"
                  }
                  onClick={() => {
                    ship(routeData?.purchaseOrder);
                  }}
                >
                  Ship
                </Button>
              ))}
            {receipts.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    leftIcon={<LuHandCoins />}
                    variant={
                      ["To Receive", "To Receive and Invoice"].includes(
                        routeData?.purchaseOrder?.status ?? ""
                      ) && !requiresShipment
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
                      ![
                        "To Receive",
                        "To Receive and Invoice",
                        "To Invoice",
                      ].includes(routeData?.purchaseOrder?.status ?? "")
                    }
                    onClick={() => {
                      receive(routeData?.purchaseOrder);
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
                  !["To Receive", "To Receive and Invoice"].includes(
                    routeData?.purchaseOrder?.status ?? ""
                  )
                }
                variant={
                  ["To Receive", "To Receive and Invoice"].includes(
                    routeData?.purchaseOrder?.status ?? ""
                  ) && !requiresShipment
                    ? "primary"
                    : "secondary"
                }
                onClick={() => {
                  receive(routeData?.purchaseOrder);
                }}
              >
                Receive
              </Button>
            )}

            {invoices?.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    leftIcon={<LuCreditCard />}
                    rightIcon={<LuChevronDown />}
                    variant={
                      ["To Invoice", "To Receive and Invoice"].includes(
                        routeData?.purchaseOrder?.status ?? ""
                      ) && !requiresShipment
                        ? "primary"
                        : "secondary"
                    }
                  >
                    Invoice
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={
                      !["To Invoice", "To Receive and Invoice"].includes(
                        routeData?.purchaseOrder?.status ?? ""
                      )
                    }
                    onClick={() => {
                      invoice(routeData?.purchaseOrder);
                    }}
                  >
                    <DropdownMenuIcon icon={<LuCirclePlus />} />
                    New Invoice
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {invoices.map((invoice) => (
                    <DropdownMenuItem key={invoice.id} asChild>
                      <Link to={path.to.purchaseInvoice(invoice.id!)}>
                        <DropdownMenuIcon icon={<LuCreditCard />} />
                        <HStack spacing={8}>
                          <span>{invoice.invoiceId}</span>
                          <PurchaseInvoicingStatus status={invoice.status} />
                        </HStack>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                leftIcon={<LuCreditCard />}
                isDisabled={
                  !["To Invoice", "To Receive and Invoice"].includes(
                    routeData?.purchaseOrder?.status ?? ""
                  )
                }
                variant={
                  ["To Invoice", "To Receive and Invoice"].includes(
                    routeData?.purchaseOrder?.status ?? ""
                  ) && !requiresShipment
                    ? "primary"
                    : "secondary"
                }
                onClick={() => {
                  invoice(routeData?.purchaseOrder);
                }}
              >
                Invoice
              </Button>
            )}
            <statusFetcher.Form
              method="post"
              action={path.to.purchaseOrderStatus(orderId)}
            >
              <input type="hidden" name="status" value="Closed" />
              <Button
                type="submit"
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Closed"
                }
                isDisabled={
                  ["Closed", "Completed"].includes(
                    routeData?.purchaseOrder?.status ?? ""
                  ) ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "production")
                }
                leftIcon={<LuCircleStop />}
                variant="secondary"
              >
                Cancel
              </Button>
            </statusFetcher.Form>
            <statusFetcher.Form
              method="post"
              action={path.to.purchaseOrderStatus(orderId)}
            >
              <input type="hidden" name="status" value="Draft" />
              <Button
                type="submit"
                variant="secondary"
                leftIcon={<LuLoaderCircle />}
                isDisabled={
                  ["Draft"].includes(routeData?.purchaseOrder?.status ?? "") ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "purchasing")
                }
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Draft"
                }
              >
                Reopen
              </Button>
            </statusFetcher.Form>

            <IconButton
              aria-label="Toggle Properties"
              icon={<LuPanelRight />}
              onClick={toggleProperties}
              variant="ghost"
            />
          </HStack>
        </HStack>
      </div>

      {finalizeDisclosure.isOpen && (
        <PurchaseOrderFinalizeModal
          purchaseOrder={routeData?.purchaseOrder}
          onClose={finalizeDisclosure.onClose}
        />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deletePurchaseOrder(orderId)}
          isOpen={deleteModal.isOpen}
          name={routeData?.purchaseOrder?.purchaseOrderId ?? "purchase order"}
          text={`Are you sure you want to delete ${routeData?.purchaseOrder?.purchaseOrderId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
    </>
  );
};

export default PurchaseOrderHeader;
