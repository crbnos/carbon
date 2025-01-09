import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  Heading,
  IconButton,
  useDisclosure,
} from "@carbon/react";

import { Link, useFetcher, useParams } from "@remix-run/react";
import {
  LuArrowDownToLine,
  LuCheckCheck,
  LuChevronDown,
  LuCirclePlus,
  LuCreditCard,
  LuEye,
  LuFile,
  LuPanelLeft,
  LuPanelRight,
  LuRefreshCw,
} from "react-icons/lu";

import { usePanels } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { PurchaseOrder, PurchaseOrderLine } from "../../types";

import { ReceiptStatus } from "~/modules/inventory/ui/Receipts";
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
  const { receive, invoice } = usePurchaseOrder();
  const { receipts, invoices } = usePurchaseOrderRelatedDocuments(
    routeData?.purchaseOrder?.supplierInteractionId ?? ""
  );

  const finalizeDisclosure = useDisclosure();

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide">
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
            <PurchasingStatus status={routeData?.purchaseOrder?.status} />
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

            <Button
              leftIcon={<LuCheckCheck />}
              variant={
                routeData?.purchaseOrder?.status === "Draft"
                  ? "primary"
                  : "secondary"
              }
              onClick={finalizeDisclosure.onOpen}
              isDisabled={
                routeData?.purchaseOrder?.status !== "Draft" ||
                routeData?.lines.length === 0
              }
            >
              Finalize
            </Button>
            {receipts.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    leftIcon={<LuArrowDownToLine />}
                    variant={
                      ["To Receive", "To Receive and Invoice"].includes(
                        routeData?.purchaseOrder?.status ?? ""
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
                        <DropdownMenuIcon icon={<LuArrowDownToLine />} />
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
                leftIcon={<LuArrowDownToLine />}
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
                      )
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
                  )
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
              <input type="hidden" name="status" value="Draft" />
              <Button
                type="submit"
                variant="secondary"
                leftIcon={<LuRefreshCw />}
                isDisabled={
                  ["Draft", "Cancelled", "Closed", "Completed"].includes(
                    routeData?.purchaseOrder?.status ?? ""
                  ) ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "sales")
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
    </>
  );
};

export default PurchaseOrderHeader;
