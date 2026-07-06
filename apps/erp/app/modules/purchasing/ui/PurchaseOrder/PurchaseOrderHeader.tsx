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
  Heading,
  HStack,
  IconButton,
  SplitButton,
  Status,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
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
  LuX
} from "react-icons/lu";
import { Link, useFetcher, useNavigation, useParams } from "react-router";
import type { ResolvedAttachmentItem } from "~/components/AttachmentsList";
import { useAuditLog } from "~/components/AuditLog";
import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import {
  usePermissions,
  useRouteData,
  useSupplierApprovalRequired,
  useUser
} from "~/hooks";
import { ReceiptStatus } from "~/modules/inventory/ui/Receipts";
import { ShipmentStatus } from "~/modules/inventory/ui/Shipments";
import PurchaseInvoicingStatus from "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicingStatus";
import type { ApprovalDecision } from "~/modules/shared/types";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";
import { isPurchaseOrderLocked } from "../../purchasing.models";
import type { PurchaseOrder, PurchaseOrderLine } from "../../types";
import PurchaseOrderApprovalModal from "./PurchaseOrderApprovalModal";
import PurchaseOrderFinalizeModal from "./PurchaseOrderFinalizeModal";
import PurchasingStatus from "./PurchasingStatus";
import {
  usePurchaseOrder,
  usePurchaseOrderRelatedDocuments
} from "./usePurchaseOrder";

const PurchaseOrderHeader = () => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const { company } = useUser();
  const { toggleExplorer, toggleProperties } = usePanels();

  const { t } = useLingui();
  const supplierApprovalRequired = useSupplierApprovalRequired();
  const routeData = useRouteData<{
    purchaseOrder: PurchaseOrder;
    lines: PurchaseOrderLine[];
    approvalRequest: { id: string } | null;
    canApprove: boolean;
    canReopen: boolean;
    canDelete: boolean;
    defaultCc: string[];
    supplier: { status: string | null } | null;
    resolvedAttachments: ResolvedAttachmentItem[];
  }>(path.to.purchaseOrder(orderId));

  const [suppliers] = useSuppliers();
  const isSupplierApproved = useMemo(
    () =>
      !supplierApprovalRequired ||
      suppliers.find((s) => s.id === routeData?.purchaseOrder?.supplierId)
        ?.supplierStatus === "Active",
    [supplierApprovalRequired, routeData?.purchaseOrder?.supplierId, suppliers]
  );

  if (!routeData?.purchaseOrder)
    throw new Error("Failed to load purchase order");

  const permissions = usePermissions();

  const statusFetcher = useFetcher<{}>();
  const approvalFetcher = useFetcher<{}>();
  const navigation = useNavigation();
  const { receive, invoice, ship } = usePurchaseOrder();

  const isReceiving =
    navigation.state !== "idle" && navigation.formAction === path.to.newReceipt;
  const isInvoicing =
    navigation.state !== "idle" &&
    navigation.location?.pathname === path.to.newPurchaseInvoice;

  const isNeedsApproval = routeData?.purchaseOrder?.status === "Needs Approval";
  const hasApprovalRequest = !!routeData?.approvalRequest;
  const canApprove = routeData?.canApprove ?? false;
  const isLocked = isPurchaseOrderLocked(routeData?.purchaseOrder?.status);
  const { receipts, invoices, shipments } = usePurchaseOrderRelatedDocuments(
    routeData?.purchaseOrder?.supplierInteractionId ?? "",
    routeData?.purchaseOrder?.purchaseOrderType === "Outside Processing"
  );

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "purchaseOrder",
    entityId: orderId,
    companyId: company.id,
    variant: "dropdown"
  });

  const finalizeDisclosure = useDisclosure();
  const deleteModal = useDisclosure();
  const [approvalDecision, setApprovalDecision] =
    useState<ApprovalDecision | null>(null);

  const isOutsideProcessing =
    routeData?.purchaseOrder?.purchaseOrderType === "Outside Processing";
  const hasShipments = shipments.length > 0;
  const requiresShipment = isOutsideProcessing && !hasShipments;
  const hasReceivableLines = useMemo(
    () =>
      routeData?.lines?.some(
        (line) =>
          line.purchaseOrderLineType !== "Comment" &&
          line.purchaseOrderLineType !== "G/L Account"
      ) ?? false,
    [routeData?.lines]
  );

  const markAsPlanned = () => {
    statusFetcher.submit(
      { status: "Planned" },
      { method: "post", action: path.to.purchaseOrderStatus(orderId) }
    );
  };

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-background border-b h-[50px] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label={t`Toggle Explorer`}
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
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {auditLogTrigger}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={
                    ["Draft"].includes(
                      routeData?.purchaseOrder?.status ?? ""
                    ) ||
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "purchasing") ||
                    (isNeedsApproval && !routeData?.canReopen)
                  }
                  onClick={() => {
                    statusFetcher.submit(
                      { status: "Draft" },
                      {
                        method: "post",
                        action: path.to.purchaseOrderStatus(orderId)
                      }
                    );
                  }}
                >
                  <DropdownMenuIcon icon={<LuLoaderCircle />} />
                  <Trans>Reopen</Trans>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={
                    isLocked ||
                    !permissions.can("delete", "purchasing") ||
                    !permissions.is("employee") ||
                    (isNeedsApproval && !routeData?.canDelete)
                  }
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Purchase Order</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <PurchasingStatus status={routeData?.purchaseOrder?.status} />
            {isOutsideProcessing && (
              <Badge variant="default">
                {routeData?.purchaseOrder?.purchaseOrderType}
              </Badge>
            )}
            {supplierApprovalRequired && !isSupplierApproved && (
              <Status color="red">
                <Trans>Unapproved Supplier</Trans>
              </Status>
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
                  <Trans>Preview</Trans>
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
                    <Trans>PDF</Trans>
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <SplitButton
              leftIcon={<LuCheckCheck />}
              isLoading={
                statusFetcher.formAction ===
                path.to.purchaseOrderFinalize(orderId)
              }
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
                ) ||
                routeData?.lines.length === 0 ||
                !isSupplierApproved
              }
              dropdownItems={[
                {
                  label: t`Mark as Planned`,
                  icon: <LuCheckCheck />,
                  onClick: markAsPlanned,
                  disabled:
                    !["Draft"].includes(
                      routeData?.purchaseOrder?.status ?? ""
                    ) ||
                    routeData?.lines.length === 0 ||
                    !isSupplierApproved
                }
              ]}
            >
              <Trans>Finalize</Trans>
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
                      <Trans>Shipments</Trans>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      disabled={
                        ![
                          "To Receive",
                          "To Receive and Invoice",
                          "To Invoice"
                        ].includes(routeData?.purchaseOrder?.status ?? "")
                      }
                      onClick={() => {
                        ship(routeData?.purchaseOrder);
                      }}
                    >
                      <DropdownMenuIcon icon={<LuCirclePlus />} />
                      <Trans>New Shipment</Trans>
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
                  <Trans>Ship</Trans>
                </Button>
              ))}
            {isNeedsApproval && hasApprovalRequest && canApprove ? (
              <>
                <Button
                  leftIcon={<LuCheckCheck />}
                  variant="primary"
                  isLoading={
                    approvalFetcher.state !== "idle" &&
                    approvalFetcher.formData?.get("decision") === "Approved"
                  }
                  isDisabled={approvalFetcher.state !== "idle"}
                  onClick={() => setApprovalDecision("Approved")}
                >
                  <Trans>Approve</Trans>
                </Button>
                <Button
                  leftIcon={<LuX />}
                  variant="destructive"
                  isLoading={
                    approvalFetcher.state !== "idle" &&
                    approvalFetcher.formData?.get("decision") === "Rejected"
                  }
                  isDisabled={approvalFetcher.state !== "idle"}
                  onClick={() => setApprovalDecision("Rejected")}
                >
                  <Trans>Reject</Trans>
                </Button>
              </>
            ) : hasReceivableLines ? (
              receipts.length > 0 ? (
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
                      <Trans>Receipts</Trans>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      disabled={
                        ![
                          "To Receive",
                          "To Receive and Invoice",
                          "To Invoice"
                        ].includes(routeData?.purchaseOrder?.status ?? "") ||
                        isReceiving
                      }
                      onClick={() => {
                        receive(routeData?.purchaseOrder);
                      }}
                    >
                      <DropdownMenuIcon icon={<LuCirclePlus />} />
                      <Trans>New Receipt</Trans>
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
                  isLoading={isReceiving}
                  isDisabled={
                    !["To Receive", "To Receive and Invoice"].includes(
                      routeData?.purchaseOrder?.status ?? ""
                    ) || isReceiving
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
                  <Trans>Receive</Trans>
                </Button>
              )
            ) : null}

            {!isNeedsApproval && (
              <>
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
                        <Trans>Invoice</Trans>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={
                          !["To Invoice", "To Receive and Invoice"].includes(
                            routeData?.purchaseOrder?.status ?? ""
                          ) || isInvoicing
                        }
                        onClick={() => {
                          invoice(routeData?.purchaseOrder);
                        }}
                      >
                        <DropdownMenuIcon icon={<LuCirclePlus />} />
                        <Trans>New Invoice</Trans>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {invoices.map((invoice) => (
                        <DropdownMenuItem key={invoice.id} asChild>
                          <Link to={path.to.purchaseInvoice(invoice.id!)}>
                            <DropdownMenuIcon icon={<LuCreditCard />} />
                            <HStack spacing={8}>
                              <span>{invoice.invoiceId}</span>
                              <PurchaseInvoicingStatus
                                // @ts-expect-error - Return type is not defined
                                status={invoice.status}
                              />
                            </HStack>
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    leftIcon={<LuCreditCard />}
                    isLoading={isInvoicing}
                    isDisabled={
                      !["To Invoice", "To Receive and Invoice"].includes(
                        routeData?.purchaseOrder?.status ?? ""
                      ) || isInvoicing
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
                    <Trans>Invoice</Trans>
                  </Button>
                )}
              </>
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
                  !permissions.can("delete", "purchasing")
                }
                leftIcon={<LuCircleStop />}
                variant="secondary"
              >
                <Trans>Cancel</Trans>
              </Button>
            </statusFetcher.Form>
            <IconButton
              aria-label={t`Toggle Properties`}
              icon={<LuPanelRight />}
              onClick={toggleProperties}
              variant="ghost"
            />
          </HStack>
        </HStack>
      </div>

      {finalizeDisclosure.isOpen && (
        <PurchaseOrderFinalizeModal
          fetcher={statusFetcher}
          purchaseOrder={routeData?.purchaseOrder}
          onClose={finalizeDisclosure.onClose}
          defaultCc={routeData?.defaultCc ?? []}
          resolvedAttachments={routeData?.resolvedAttachments ?? []}
        />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deletePurchaseOrder(orderId)}
          isOpen={deleteModal.isOpen}
          name={routeData?.purchaseOrder?.purchaseOrderId ?? "purchase order"}
          text={t`Are you sure you want to delete ${routeData?.purchaseOrder?.purchaseOrderId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
      {approvalDecision && routeData?.approvalRequest?.id && (
        <PurchaseOrderApprovalModal
          purchaseOrder={routeData?.purchaseOrder}
          approvalRequestId={routeData.approvalRequest.id}
          decision={approvalDecision}
          fetcher={approvalFetcher}
          onClose={() => setApprovalDecision(null)}
          defaultCc={routeData?.defaultCc ?? []}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default PurchaseOrderHeader;
