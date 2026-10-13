// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { getPurchaseOrderDisplayId } from "@carbon/documents/utils";
import type { ApprovalDecision } from "@carbon/ee/approvals";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  MENU_ITEM_SHORTCUTS,
  SplitButton,
  Status,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  LuCheckCheck,
  LuChevronDown,
  LuCirclePlus,
  LuCircleStop,
  LuCreditCard,
  LuEye,
  LuFile,
  LuGitBranchPlus,
  LuHandCoins,
  LuLoaderCircle,
  LuTrash,
  LuTruck,
  LuUndo2,
  LuX
} from "react-icons/lu";
import { Link, useFetcher, useNavigation, useParams } from "react-router";
import { RevisionSuffix } from "~/components";
import type { ResolvedAttachmentItem } from "~/components/AttachmentsList";
import { useAuditLog } from "~/components/AuditLog";
import { usePanels } from "~/components/Layout";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import Confirm from "~/components/Modals/Confirm/Confirm";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import {
  usePermissions,
  useRouteData,
  useSupplierApprovalRequired,
  useUser
} from "~/hooks";
import { useResolved } from "~/hooks/useResolved";
import { ReceiptStatus } from "~/modules/inventory/ui/Receipts";
import { ShipmentStatus } from "~/modules/inventory/ui/Shipments";
import PurchaseInvoicingStatus from "~/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicingStatus";
import { PurchaseReturnOrderStatus } from "~/modules/purchasing/ui/PurchaseReturnOrders";
import { useSuppliers } from "~/stores/suppliers";
import { path } from "~/utils/path";
import {
  canCreatePurchaseOrderRevision,
  isPurchaseOrderLocked
} from "../../purchasing.models";
import type { PurchaseOrder, PurchaseOrderLine } from "../../types";
import PurchaseOrderApprovalModal from "./PurchaseOrderApprovalModal";
import PurchaseOrderFinalizeModal from "./PurchaseOrderFinalizeModal";
import PurchasingStatus from "./PurchasingStatus";
import {
  usePurchaseOrder,
  usePurchaseOrderRelatedDocuments
} from "./usePurchaseOrder";

// Wraps a single-create action button so it shows a "couldn't load related
// documents" tooltip while disabled, keeping the Ship/Receive/Invoice branches
// from repeating the same Tooltip scaffolding.
function RelatedDocsErrorTooltip({
  hasError,
  message,
  children
}: {
  hasError: boolean;
  message: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      {hasError && <TooltipContent>{message}</TooltipContent>}
    </Tooltip>
  );
}

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
    supplier: { status: string | null; name: string | null } | null;
    resolvedAttachments: Promise<ResolvedAttachmentItem[]>;
  }>(path.to.purchaseOrder(orderId));
  const resolvedAttachments = useResolved(
    routeData?.resolvedAttachments,
    [],
    orderId
  );

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
  const {
    receipts,
    invoices,
    shipments,
    returnOrders,
    hasError: relatedDocsError
  } = usePurchaseOrderRelatedDocuments(
    routeData?.purchaseOrder?.supplierInteractionId ?? "",
    routeData?.purchaseOrder?.purchaseOrderType === "Outside Processing",
    orderId
  );

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "purchaseOrder",
    entityId: orderId,
    companyId: company.id,
    variant: "dropdown"
  });

  const finalizeDisclosure = useDisclosure();
  const deleteModal = useDisclosure();
  const cancelModal = useDisclosure();
  const createRevisionModal = useDisclosure();
  const [approvalDecision, setApprovalDecision] =
    useState<ApprovalDecision | null>(null);

  const relatedDocsErrorMessage = t`Couldn't load related documents. Refresh before creating a new one to avoid duplicates.`;

  // Interpolated into translated confirmations, so the fallback has to be
  // translated too — a raw English literal would render mid-sentence in every
  // other locale.
  const orderLabel =
    getPurchaseOrderDisplayId(routeData?.purchaseOrder) ||
    t`this purchase order`;

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

  const isMarkAsPlannedDisabled =
    !["Draft"].includes(routeData?.purchaseOrder?.status ?? "") ||
    routeData?.lines.length === 0 ||
    !isSupplierApproved;
  const markAsPlanned = () => {
    statusFetcher.submit(
      { status: "Planned" },
      { method: "post", action: path.to.purchaseOrderStatus(orderId) }
    );
  };

  // Phones lead the action bar with the control the desktop highlights for
  // this status, with Invoice beside Receive when both apply.
  const status = routeData?.purchaseOrder?.status ?? "";
  const isReceiveStep = ["To Receive", "To Receive and Invoice"].includes(
    status
  );
  const isFinalizable = ["Draft", "Planned"].includes(status);
  const isInvoiceStep = ["To Invoice", "To Receive and Invoice"].includes(
    status
  );
  const finalizeSlot = isFinalizable ? "primary" : "overflow";
  const shipSlot = isReceiveStep && requiresShipment ? "primary" : "overflow";
  const receiveSlot =
    isReceiveStep && !requiresShipment ? "primary" : "overflow";
  const invoiceSlot =
    !isInvoiceStep || requiresShipment
      ? "overflow"
      : receiveSlot === "primary" && hasReceivableLines
        ? "secondary"
        : "primary";
  const invoiceVariant =
    isInvoiceStep && !requiresShipment ? "primary" : "secondary";

  const menuItems = (
    <>
      {auditLogTrigger}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={
          ["Draft"].includes(routeData?.purchaseOrder?.status ?? "") ||
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
      <DropdownMenuItem
        disabled={
          !canCreatePurchaseOrderRevision({
            newStatus: "Draft",
            currentStatus: routeData?.purchaseOrder?.status,
            orderDate: routeData?.purchaseOrder?.orderDate
          }) ||
          statusFetcher.state !== "idle" ||
          !permissions.can("delete", "purchasing")
        }
        onClick={createRevisionModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuGitBranchPlus />} />
        <Trans>Create PO Revision</Trans>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
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
    </>
  );
  const statusBadges = (
    <>
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
    </>
  );
  // The ID with its revision (desktop title).
  const titleNode = (
    <span className="flex items-center gap-0">
      <span>{routeData?.purchaseOrder?.purchaseOrderId}</span>
      <RevisionSuffix revisionId={routeData?.purchaseOrder?.revisionId} />
    </span>
  );
  // Phones: the supplier under the hero, then the revision the app bar
  // title (the ID alone) does not show.
  const revisionId = routeData?.purchaseOrder?.revisionId ?? 0;
  const heroSubtitle =
    [routeData?.supplier?.name, revisionId > 0 ? t`Rev ${revisionId}` : null]
      .filter(Boolean)
      .join(" · ") || undefined;
  return (
    <>
      <RecordHeader
        title={titleNode}
        subtitle={heroSubtitle}
        titleTo={path.to.purchaseOrderDetails(orderId)}
        copyValue={getPurchaseOrderDisplayId(routeData?.purchaseOrder)}
        menu={menuItems}
        status={statusBadges}
        onToggleExplorer={toggleExplorer}
        onToggleProperties={toggleProperties}
        actions={
          <>
            <RecordAction slot="icon">
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
            </RecordAction>

            <RecordAction slot={finalizeSlot}>
              <SplitButton
                leftIcon={<LuCheckCheck />}
                isLoading={
                  statusFetcher.formAction ===
                  path.to.purchaseOrderFinalize(orderId)
                }
                variant={isFinalizable ? "primary" : "secondary"}
                onClick={finalizeDisclosure.onOpen}
                isDisabled={
                  !isFinalizable ||
                  routeData?.lines.length === 0 ||
                  !isSupplierApproved
                }
                dropdownItems={[
                  {
                    label: t`Mark as Planned`,
                    icon: <LuCheckCheck />,
                    onClick: markAsPlanned,
                    disabled: isMarkAsPlannedDisabled
                  }
                ]}
              >
                <Trans>Finalize</Trans>
              </SplitButton>
            </RecordAction>
            {routeData?.purchaseOrder?.purchaseOrderType ===
              "Outside Processing" &&
              (shipments.length > 0 ? (
                <RecordAction slot="overflow">
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
                </RecordAction>
              ) : (
                <RecordAction slot={shipSlot}>
                  <RelatedDocsErrorTooltip
                    hasError={relatedDocsError}
                    message={relatedDocsErrorMessage}
                  >
                    <Button
                      leftIcon={<LuTruck />}
                      isDisabled={relatedDocsError || !isReceiveStep}
                      variant={isReceiveStep ? "primary" : "secondary"}
                      onClick={() => {
                        ship(routeData?.purchaseOrder);
                      }}
                    >
                      <Trans>Ship</Trans>
                    </Button>
                  </RelatedDocsErrorTooltip>
                </RecordAction>
              ))}
            {isNeedsApproval && hasApprovalRequest && canApprove ? (
              <>
                <RecordAction slot="primary">
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
                </RecordAction>
                <RecordAction slot="secondary">
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
                </RecordAction>
              </>
            ) : hasReceivableLines ? (
              receipts.length > 0 ? (
                <RecordAction slot={receiveSlot}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        leftIcon={<LuHandCoins />}
                        variant={
                          isReceiveStep && !requiresShipment
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
                </RecordAction>
              ) : (
                <RecordAction slot={receiveSlot}>
                  <RelatedDocsErrorTooltip
                    hasError={relatedDocsError}
                    message={relatedDocsErrorMessage}
                  >
                    <Button
                      leftIcon={<LuHandCoins />}
                      isLoading={isReceiving}
                      isDisabled={
                        relatedDocsError || !isReceiveStep || isReceiving
                      }
                      variant={
                        isReceiveStep && !requiresShipment
                          ? "primary"
                          : "secondary"
                      }
                      onClick={() => {
                        receive(routeData?.purchaseOrder);
                      }}
                    >
                      <Trans>Receive</Trans>
                    </Button>
                  </RelatedDocsErrorTooltip>
                </RecordAction>
              )
            ) : null}

            {!isNeedsApproval && (
              <>
                {invoices?.length > 0 ? (
                  <RecordAction slot={invoiceSlot}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          leftIcon={<LuCreditCard />}
                          rightIcon={<LuChevronDown />}
                          variant={invoiceVariant}
                        >
                          <Trans>Invoice</Trans>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={!isInvoiceStep || isInvoicing}
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
                  </RecordAction>
                ) : (
                  <RecordAction slot={invoiceSlot}>
                    <RelatedDocsErrorTooltip
                      hasError={relatedDocsError}
                      message={relatedDocsErrorMessage}
                    >
                      <Button
                        leftIcon={<LuCreditCard />}
                        isLoading={isInvoicing}
                        isDisabled={
                          relatedDocsError || !isInvoiceStep || isInvoicing
                        }
                        variant={invoiceVariant}
                        onClick={() => {
                          invoice(routeData?.purchaseOrder);
                        }}
                      >
                        <Trans>Invoice</Trans>
                      </Button>
                    </RelatedDocsErrorTooltip>
                  </RecordAction>
                )}
              </>
            )}
            {returnOrders.length > 0 && (
              <RecordAction slot="overflow">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      leftIcon={<LuUndo2 />}
                      rightIcon={<LuChevronDown />}
                      variant="secondary"
                    >
                      <Trans>Returns</Trans>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {returnOrders.map((returnOrder) => (
                      <DropdownMenuItem key={returnOrder.id} asChild>
                        <Link to={path.to.purchaseReturnOrder(returnOrder.id)}>
                          <DropdownMenuIcon icon={<LuUndo2 />} />
                          <HStack spacing={8}>
                            <span>{returnOrder.purchaseReturnOrderId}</span>
                            <PurchaseReturnOrderStatus
                              status={
                                returnOrder.status as Database["public"]["Enums"]["purchaseReturnOrderStatus"]
                              }
                            />
                          </HStack>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </RecordAction>
            )}
            <RecordAction slot="overflow">
              <Button
                onClick={cancelModal.onOpen}
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
                <Trans>Cancel Order</Trans>
              </Button>
            </RecordAction>
          </>
        }
      />

      {finalizeDisclosure.isOpen && (
        <PurchaseOrderFinalizeModal
          fetcher={statusFetcher}
          purchaseOrder={routeData?.purchaseOrder}
          onClose={finalizeDisclosure.onClose}
          defaultCc={routeData?.defaultCc ?? []}
          resolvedAttachments={resolvedAttachments}
        />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deletePurchaseOrder(orderId)}
          isOpen={deleteModal.isOpen}
          name={orderLabel}
          text={t`Are you sure you want to delete ${orderLabel}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
      {cancelModal.isOpen && (
        <Confirm
          action={path.to.purchaseOrderStatus(orderId)}
          title={t`Cancel Purchase Order`}
          text={t`Are you sure you want to cancel ${orderLabel}? This will close the order.`}
          confirmText={t`Cancel Order`}
          confirmVariant="destructive"
          cancelText={t`Back`}
          onCancel={cancelModal.onClose}
          onSubmit={cancelModal.onClose}
        >
          <input type="hidden" name="status" value="Closed" />
        </Confirm>
      )}
      {createRevisionModal.isOpen && (
        <Confirm
          action={path.to.purchaseOrderStatus(orderId)}
          title={t`Create PO Revision`}
          text={t`${orderLabel} will be reopened for editing as revision ${
            (routeData?.purchaseOrder?.revisionId ?? 0) + 1
          }. The document already sent to the supplier is unchanged until you finalize and resend the order.`}
          confirmText={t`Create Revision`}
          onCancel={createRevisionModal.onClose}
          onSubmit={createRevisionModal.onClose}
        >
          <input type="hidden" name="status" value="Draft" />
          <input type="hidden" name="createRevision" value="true" />
        </Confirm>
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
