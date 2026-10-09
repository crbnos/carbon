// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { useRuleViolations } from "@carbon/ee/rules";
import { SelectControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  MENU_ITEM_SHORTCUTS,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import type { SalesOrderForProductionCheck } from "@carbon/utils";
import { hasLinesRequiringJobs } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  LuCheckCheck,
  LuChevronDown,
  LuCirclePlus,
  LuCircleStop,
  LuCreditCard,
  LuEye,
  LuFile,
  LuFileText,
  LuGitCompare,
  LuLoaderCircle,
  LuTrash,
  LuTruck,
  LuUndo2
} from "react-icons/lu";
import type { FetcherWithComponents } from "react-router";
import { Await, Link, useFetcher, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import { CSVLink } from "~/components/CSVLink";
import { CustomerContact, EmailRecipients } from "~/components/Form";
import { usePanels } from "~/components/Layout";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import Confirm from "~/components/Modals/Confirm/Confirm";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import type { Shipment } from "~/modules/inventory/types";
import { ShipmentStatus } from "~/modules/inventory/ui/Shipments";
import type { SalesInvoice } from "~/modules/invoicing/types";
import SalesInvoiceStatus from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceStatus";
import type { Job } from "~/modules/production/types";
import { SalesReturnOrderStatus } from "~/modules/sales/ui/SalesReturnOrders";
import type { action as statusAction } from "~/routes/x+/sales-order+/$orderId.status";
import { useCustomers } from "~/stores/customers";
import { path } from "~/utils/path";
import { isSalesOrderLocked, salesConfirmValidator } from "../../sales.models";
import type { Opportunity, SalesOrder, SalesOrderLine } from "../../types";
import { CancelSalesOrderModal } from "./CancelSalesOrderModal";
import SalesOrderToContractModal from "./SalesOrderToContractModal";
import SalesStatus from "./SalesStatus";
import { useSalesOrder } from "./useSalesOrder";

const SalesOrderConfirmModal = ({
  salesOrder,
  onClose,
  defaultCc = []
}: {
  salesOrder?: SalesOrder;
  onClose: () => void;
  defaultCc?: string[];
}) => {
  const { t } = useLingui();
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const integrations = useIntegrations();
  const canEmail = integrations.has("email");

  const [notificationType, setNotificationType] = useState<"Email" | "None">(
    canEmail ? "Email" : "None"
  );

  // Confirming re-evaluates sales rules across every line (the terminal gate in
  // the action). Route the submission through the violations hook so a blocked
  // confirm opens the shared modal rather than only flashing a toast, and close
  // this modal only once the action actually succeeds.
  const ruleViolations = useRuleViolations({
    action: path.to.salesOrderConfirm(orderId),
    onSuccess: onClose
  });
  const fetcher = ruleViolations.fetcher as FetcherWithComponents<{
    success?: boolean;
    message?: string;
    violations?: unknown[];
  }>;

  useEffect(() => {
    // Violations render in the ViolationModal; don't also toast their message.
    if ((fetcher.data?.violations ?? []).length > 0) return;
    if (fetcher.data?.success === false && fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.salesOrderConfirm(orderId)}
          validator={salesConfirmValidator}
          defaultValues={{
            notification: notificationType,
            customerContact: salesOrder?.customerContactId ?? undefined,
            cc: defaultCc
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>{t`Confirm ${salesOrder?.salesOrderId}`}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Are you sure you want to confirm this sales order? Confirming
                  the order will affect on order quantities used to calculate
                  supply and demand.
                </Trans>
              </p>
              {canEmail && (
                <SelectControlled
                  label={t`Send Via`}
                  name="notification"
                  options={[
                    {
                      label: t`None`,
                      value: "None"
                    },
                    {
                      label: t`Email`,
                      value: "Email"
                    }
                  ]}
                  value={notificationType}
                  onChange={(t) => {
                    if (t) setNotificationType(t.value as "Email" | "None");
                  }}
                />
              )}
              {notificationType === "Email" && (
                <>
                  <CustomerContact
                    name="customerContact"
                    customer={salesOrder?.customerId ?? undefined}
                  />
                  <EmailRecipients name="cc" label={t`CC`} type="employee" />
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" isLoading={fetcher.state !== "idle"}>
              <Trans>Confirm</Trans>
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
      <ruleViolations.ViolationModal />
    </Modal>
  );
};

const SalesOrderHeader = () => {
  const { t } = useLingui();
  const { orderId } = useParams();
  if (!orderId) throw new Error("orderId not found");

  const { company } = useUser();
  const { toggleExplorer, toggleProperties } = usePanels();

  const routeData = useRouteData<{
    salesOrder: SalesOrder;
    lines: SalesOrderLine[];
    opportunity: Opportunity;
    customer: { name: string | null } | null;
    relatedItems: Promise<{
      jobs: Job[];
      shipments: Shipment[];
      invoices: SalesInvoice[];
      salesReturnOrders: {
        id: string;
        salesReturnOrderId: string;
        status: Database["public"]["Enums"]["salesReturnOrderStatus"];
      }[];
    }>;
    defaultCc: string[];
  }>(path.to.salesOrder(orderId));

  if (!routeData?.salesOrder) throw new Error("Failed to load sales order");

  const permissions = usePermissions();
  const isLocked = isSalesOrderLocked(routeData?.salesOrder?.status);

  const statusFetcher = useFetcher<typeof statusAction>();
  const { ship, invoice } = useSalesOrder();

  const linesRequireJobs = hasLinesRequiringJobs({
    jobs: routeData?.salesOrder?.jobs as SalesOrderForProductionCheck["jobs"],
    lines: routeData?.salesOrder?.lines as SalesOrderForProductionCheck["lines"]
  });

  const salesOrderToJobsModal = useDisclosure();
  const salesOrderToContractModal = useDisclosure();
  const confirmDisclosure = useDisclosure();
  const deleteSalesOrderModal = useDisclosure();
  const cancelDisclosure = useDisclosure();
  const [customers] = useCustomers();

  // A contract takes Service lines no invoice has touched (decision 7).
  const contractEligibleLines = useMemo(
    () =>
      (routeData?.lines ?? []).filter(
        (line) =>
          line.salesOrderLineType === "Service" &&
          !line.invoicedComplete &&
          !line.quantityInvoiced
      ),
    [routeData?.lines]
  );

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "salesOrder",
    entityId: orderId,
    companyId: company.id,
    variant: "dropdown"
  });

  const csvExportData = useMemo(() => {
    const headers = [
      "Part ID",
      "Quantity",
      "Customer",
      "Customer #",
      "Sales Order #",
      "Order Date",
      "Promised Date"
    ];
    if (!routeData?.lines) return [headers];
    return [
      headers,
      ...routeData?.lines.map((item) => [
        item.itemReadableId,
        item.saleQuantity,
        customers.find((c) => c.id === routeData?.salesOrder?.customerId)?.name,
        routeData?.salesOrder?.customerReference,
        routeData?.salesOrder?.salesOrderId,
        routeData?.salesOrder?.orderDate,
        item.promisedDate
      ])
    ];
  }, [
    customers,
    routeData?.lines,
    routeData?.salesOrder?.customerId,
    routeData?.salesOrder?.customerReference,
    routeData?.salesOrder?.orderDate,
    routeData?.salesOrder?.salesOrderId
  ]);

  // Phones lead the action bar with the control the desktop highlights for
  // this status, with Invoice beside Ship when both are due.
  const orderStatus = routeData?.salesOrder?.status ?? "";
  const isDraft = orderStatus === "Draft";
  const isShipStep = ["To Ship", "To Ship and Invoice"].includes(orderStatus);
  const isInvoiceStep = ["To Invoice", "To Ship and Invoice"].includes(
    orderStatus
  );
  const confirmSlot = isDraft ? "primary" : "overflow";
  const shipSlot = isShipStep ? "primary" : "overflow";
  const invoiceSlot = !isInvoiceStep
    ? "overflow"
    : isShipStep
      ? "secondary"
      : "primary";

  const menuItems = (
    <>
      {auditLogTrigger}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={
          !["To Ship and Invoice", "To Ship"].includes(
            routeData?.salesOrder?.status ?? ""
          ) ||
          !permissions.can("create", "production") ||
          !permissions.is("employee") ||
          !linesRequireJobs
        }
        onClick={salesOrderToJobsModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuGitCompare />} />
        <Trans>Convert Lines to Jobs</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={
          ["Cancelled", "Closed"].includes(
            routeData?.salesOrder?.status ?? ""
          ) ||
          contractEligibleLines.length === 0 ||
          !permissions.can("create", "sales") ||
          !permissions.is("employee")
        }
        onClick={salesOrderToContractModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuFileText />} />
        <Trans>Create Contract</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <CSVLink
          data={csvExportData}
          filename={`${routeData?.salesOrder?.salesOrderId}.csv`}
        >
          <DropdownMenuIcon icon={<LuFile />} />
          <Trans>Export Lines to CSV</Trans>
        </CSVLink>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={
          ["Draft"].includes(routeData?.salesOrder?.status ?? "") ||
          statusFetcher.state !== "idle" ||
          !permissions.can("update", "sales")
        }
        onClick={() => {
          statusFetcher.submit(
            { status: "Draft" },
            {
              method: "post",
              action: path.to.salesOrderStatus(orderId)
            }
          );
        }}
      >
        <DropdownMenuIcon icon={<LuLoaderCircle />} />
        <Trans>Reopen</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        destructive
        disabled={
          isLocked ||
          !permissions.can("delete", "sales") ||
          !permissions.is("employee")
        }
        onClick={deleteSalesOrderModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuTrash />} />
        <Trans>Delete Sales Order</Trans>
      </DropdownMenuItem>
    </>
  );
  const statusBadges = (
    <>
      <SalesStatus
        status={routeData?.salesOrder?.status}
        jobs={
          routeData?.salesOrder?.jobs as Array<{
            salesOrderLineId: string;
            productionQuantity: number;
            quantityComplete: number;
            status: string;
          }>
        }
        lines={
          routeData?.salesOrder?.lines as Array<{
            id: string;
            methodType:
              | "Purchase to Order"
              | "Make to Order"
              | "Pull from Inventory";
            saleQuantity: number;
          }>
        }
      />
    </>
  );
  return (
    <>
      <RecordHeader
        title={routeData?.salesOrder?.salesOrderId}
        titleTo={path.to.salesOrderDetails(orderId)}
        copyValue={routeData?.salesOrder?.salesOrderId ?? ""}
        menu={menuItems}
        status={statusBadges}
        subtitle={routeData?.customer?.name ?? undefined}
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
                      href={path.to.file.salesOrder(orderId)}
                      rel="noreferrer"
                    >
                      <DropdownMenuIcon icon={<LuFile />} />
                      <Trans>PDF</Trans>
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </RecordAction>

            <RecordAction slot={confirmSlot}>
              <Button
                leftIcon={<LuCheckCheck />}
                variant={isDraft ? "primary" : "secondary"}
                onClick={confirmDisclosure.onOpen}
                isDisabled={
                  !["Draft", "Needs Approval"].includes(
                    routeData?.salesOrder?.status ?? ""
                  ) ||
                  routeData?.lines.length === 0 ||
                  !permissions.can("update", "sales")
                }
              >
                <Trans>Confirm</Trans>
              </Button>
            </RecordAction>

            <RecordAction slot="overflow">
              <Button
                variant="secondary"
                leftIcon={<LuCircleStop />}
                onClick={cancelDisclosure.onOpen}
                isDisabled={
                  ["Cancelled", "Closed", "Completed", "Invoiced"].includes(
                    routeData?.salesOrder?.status ?? ""
                  ) ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "sales")
                }
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Cancelled"
                }
              >
                <Trans>Cancel</Trans>
              </Button>
            </RecordAction>

            <Suspense
              fallback={
                <>
                  <RecordAction slot={shipSlot}>
                    <Button
                      leftIcon={<LuTruck />}
                      variant="secondary"
                      isLoading
                    >
                      <Trans>Loading...</Trans>
                    </Button>
                  </RecordAction>
                  <RecordAction slot={invoiceSlot}>
                    <Button
                      leftIcon={<LuCreditCard />}
                      variant="secondary"
                      isLoading
                    >
                      <Trans>Loading...</Trans>
                    </Button>
                  </RecordAction>
                </>
              }
            >
              <Await resolve={routeData?.relatedItems}>
                {(relatedItems) => {
                  const shipments = relatedItems?.shipments || [];
                  const invoices = relatedItems?.invoices || [];
                  const salesReturnOrders =
                    relatedItems?.salesReturnOrders || [];
                  return (
                    <>
                      {shipments.length > 0 ? (
                        <RecordAction slot={shipSlot}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                leftIcon={<LuTruck />}
                                variant={isShipStep ? "primary" : "secondary"}
                                rightIcon={<LuChevronDown />}
                              >
                                <Trans>Shipments</Trans>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem
                                disabled={
                                  ![
                                    "To Ship",
                                    "To Ship and Invoice",
                                    "To Invoice"
                                  ].includes(
                                    routeData?.salesOrder?.status ?? ""
                                  )
                                }
                                onClick={() => {
                                  ship(routeData?.salesOrder);
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
                                      <ShipmentStatus
                                        status={shipment.status}
                                        invoiced={shipment.invoiced}
                                      />
                                    </HStack>
                                  </Link>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </RecordAction>
                      ) : (
                        <RecordAction slot={shipSlot}>
                          <Button
                            leftIcon={<LuTruck />}
                            isDisabled={!isShipStep}
                            variant={isShipStep ? "primary" : "secondary"}
                            onClick={() => {
                              ship(routeData?.salesOrder);
                            }}
                          >
                            <Trans>Ship</Trans>
                          </Button>
                        </RecordAction>
                      )}
                      {invoices?.length > 0 ? (
                        <RecordAction slot={invoiceSlot}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                leftIcon={<LuCreditCard />}
                                rightIcon={<LuChevronDown />}
                                variant={
                                  isInvoiceStep ? "primary" : "secondary"
                                }
                              >
                                <Trans>Invoices</Trans>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                disabled={!isInvoiceStep}
                                onClick={() => {
                                  invoice(routeData?.salesOrder);
                                }}
                              >
                                <DropdownMenuIcon icon={<LuCirclePlus />} />
                                <Trans>New Invoice</Trans>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {invoices.map((invoice) => (
                                <DropdownMenuItem key={invoice.id} asChild>
                                  <Link to={path.to.salesInvoice(invoice.id!)}>
                                    <DropdownMenuIcon icon={<LuCreditCard />} />
                                    <HStack spacing={8}>
                                      <span>{invoice.invoiceId}</span>
                                      <SalesInvoiceStatus
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
                          <Button
                            leftIcon={<LuCreditCard />}
                            isDisabled={!isInvoiceStep}
                            variant={isInvoiceStep ? "primary" : "secondary"}
                            onClick={() => {
                              invoice(routeData?.salesOrder);
                            }}
                          >
                            <Trans>Invoice</Trans>
                          </Button>
                        </RecordAction>
                      )}
                      {salesReturnOrders.length > 0 && (
                        <RecordAction slot="overflow">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                leftIcon={<LuUndo2 />}
                                rightIcon={<LuChevronDown />}
                                variant="secondary"
                              >
                                <Trans>RMAs</Trans>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {salesReturnOrders.map((returnOrder) => (
                                <DropdownMenuItem key={returnOrder.id} asChild>
                                  <Link
                                    to={path.to.salesReturnOrder(
                                      returnOrder.id
                                    )}
                                  >
                                    <DropdownMenuIcon icon={<LuUndo2 />} />
                                    <HStack spacing={8}>
                                      <span>
                                        {returnOrder.salesReturnOrderId}
                                      </span>
                                      <SalesReturnOrderStatus
                                        status={returnOrder.status}
                                      />
                                    </HStack>
                                  </Link>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </RecordAction>
                      )}
                    </>
                  );
                }}
              </Await>
            </Suspense>
          </>
        }
      />
      {salesOrderToJobsModal.isOpen && (
        <Confirm
          title={t`Convert Lines to Jobs`}
          text={t`Are you sure you want to create jobs for this sales order? This will create jobs for all lines that don't already have jobs.`}
          confirmText={t`Create Jobs`}
          onCancel={salesOrderToJobsModal.onClose}
          onSubmit={salesOrderToJobsModal.onClose}
          action={path.to.salesOrderLinesToJobs(orderId)}
        />
      )}
      {salesOrderToContractModal.isOpen && (
        <SalesOrderToContractModal
          orderId={orderId}
          salesOrderId={routeData?.salesOrder?.salesOrderId ?? ""}
          customerName={
            customers.find((c) => c.id === routeData?.salesOrder?.customerId)
              ?.name
          }
          lines={contractEligibleLines}
          onClose={salesOrderToContractModal.onClose}
        />
      )}
      {confirmDisclosure.isOpen && (
        <SalesOrderConfirmModal
          salesOrder={routeData?.salesOrder}
          onClose={confirmDisclosure.onClose}
          defaultCc={routeData?.defaultCc ?? []}
        />
      )}
      <CancelSalesOrderModal
        orderId={orderId}
        isOpen={cancelDisclosure.isOpen}
        onClose={cancelDisclosure.onClose}
        isSubmitting={statusFetcher.state !== "idle"}
        onSubmit={(formData) => {
          statusFetcher.submit(formData, {
            method: "post",
            action: path.to.salesOrderStatus(orderId)
          });
          cancelDisclosure.onClose();
        }}
      />
      {deleteSalesOrderModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteSalesOrder(orderId)}
          isOpen={deleteSalesOrderModal.isOpen}
          name={routeData?.salesOrder?.salesOrderId!}
          text={t`Are you sure you want to delete ${routeData?.salesOrder
            ?.salesOrderId!}? This cannot be undone.`}
          onCancel={() => {
            deleteSalesOrderModal.onClose();
          }}
          onSubmit={() => {
            deleteSalesOrderModal.onClose();
          }}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default SalesOrderHeader;
