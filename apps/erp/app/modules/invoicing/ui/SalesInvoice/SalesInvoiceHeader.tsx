import { useCarbon } from "@carbon/auth";
import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuCheckCheck,
  LuChevronDown,
  LuDollarSign,
  LuEllipsisVertical,
  LuEye,
  LuFile,
  LuPanelLeft,
  LuPanelRight,
  LuTicketX,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Link, useFetcher, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import { usePanels } from "~/components/Layout/Panels";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { ShipmentStatus } from "~/modules/inventory/ui/Shipments";
import type { SalesInvoice, SalesInvoiceLine } from "~/modules/invoicing";
import { salesInvoiceStatusType } from "~/modules/invoicing";
import type { action } from "~/routes/x+/sales-invoice+/$invoiceId.post";
import type { action as statusAction } from "~/routes/x+/sales-invoice+/$invoiceId.status";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import SalesInvoicePostModal from "./SalesInvoicePostModal";
import SalesInvoiceStatus from "./SalesInvoiceStatus";
import SalesInvoiceVoidModal from "./SalesInvoiceVoidModal";

const SalesInvoiceHeader = () => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { invoiceId } = useParams();
  const { company } = useUser();
  const postingModal = useDisclosure();
  const voidModal = useDisclosure();
  const deleteModal = useDisclosure();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "salesInvoice",
    // @ts-expect-error TS2322 - TODO: fix type
    entityId: invoiceId,
    companyId: company.id,
    variant: "dropdown"
  });

  const postFetcher = useFetcher<typeof action>();
  const statusFetcher = useFetcher<typeof statusAction>();

  const { carbon } = useCarbon();
  const [linesNotAssociatedWithSO, setLinesNotAssociatedWithSO] = useState<
    {
      itemId: string | null;
      itemReadableId: string | null;
      description: string;
      quantity: number;
    }[]
  >([]);

  if (!invoiceId) throw new Error("invoiceId not found");

  const [items] = useItems();
  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
    salesInvoiceLines: SalesInvoiceLine[];
    defaultCc: string[];
  }>(path.to.salesInvoice(invoiceId));

  if (!routeData?.salesInvoice) throw new Error("salesInvoice not found");
  const { salesInvoice } = routeData;
  const { toggleExplorer, toggleProperties } = usePanels();
  const isPosted = salesInvoice.postingDate !== null;
  const isVoided = salesInvoice.status === "Voided";

  const [relatedDocs, setRelatedDocs] = useState<{
    salesOrders: { id: string; readableId: string }[];
    shipments: { id: string; readableId: string; status: string }[];
  }>({ salesOrders: [], shipments: [] });

  // Load related documents on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    async function getRelatedDocuments() {
      if (!carbon || !salesInvoice.opportunityId) return;

      const [salesOrdersResult, shipmentsResult] = await Promise.all([
        carbon
          .from("salesOrder")
          .select("id, salesOrderId")
          .eq("opportunityId", salesInvoice.opportunityId),
        carbon
          .from("shipment")
          .select("id, shipmentId, status")
          .eq("opportunityId", salesInvoice.opportunityId)
      ]);

      if (salesOrdersResult.error)
        throw new Error(salesOrdersResult.error.message);
      if (shipmentsResult.error) throw new Error(shipmentsResult.error.message);

      setRelatedDocs({
        salesOrders:
          salesOrdersResult.data?.map((po) => ({
            id: po.id,
            readableId: po.salesOrderId
          })) ?? [],
        shipments:
          shipmentsResult.data?.map((r) => ({
            id: r.id,
            readableId: r.shipmentId,
            status: r.status
          })) ?? []
      });
    }

    getRelatedDocuments();
  }, [carbon, salesInvoice.opportunityId, salesInvoice.status]);

  const showPostModal = async () => {
    // check if there are any lines that are not associated with a PO
    if (!carbon) throw new Error("carbon not found");
    const { data, error } = await carbon
      .from("salesInvoiceLine")
      .select("itemId, description, quantity")
      .eq("invoiceId", invoiceId)
      .in("invoiceLineType", [
        "Part",
        "Material",
        "Tool",
        "Consumable",
        "Service",
        "Fixture"
      ])
      .is("salesOrderLineId", null);

    if (error) throw new Error(error.message);
    if (!data) return;

    // so that we can ask the user if they want to receive those lines
    flushSync(() =>
      setLinesNotAssociatedWithSO(
        data?.map((d) => ({
          ...d,
          itemReadableId: getItemReadableId(items, d.itemId) ?? null,
          description: d.description ?? "",
          quantity: d.quantity
        })) ?? []
      )
    );
    postingModal.onOpen();
  };

  const handleStatusChange = (status: string) => {
    statusFetcher.submit(
      { status },
      { method: "post", action: path.to.salesInvoiceStatus(invoiceId) }
    );
  };

  const IS_PAYMENT_DROPDOWN_DISABLED =
    ["Voided", "Draft", "Pending"].includes(salesInvoice.status ?? "") ||
    !permissions.can("update", "invoicing");

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
            <Link to={path.to.salesInvoiceDetails(invoiceId)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.salesInvoice?.invoiceId}</span>
              </Heading>
            </Link>
            <Copy text={routeData?.salesInvoice?.invoiceId ?? ""} />
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
                {isPosted && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={
                        isVoided || !permissions.can("update", "invoicing")
                      }
                      destructive
                      onClick={voidModal.onOpen}
                    >
                      <DropdownMenuIcon icon={<LuTicketX />} />
                      <Trans>Void</Trans>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={
                    salesInvoice.status !== "Draft" ||
                    !permissions.can("delete", "invoicing") ||
                    !permissions.is("employee")
                  }
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Sales Invoice</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <SalesInvoiceStatus status={salesInvoice.status} />
          </HStack>
          <HStack>
            {relatedDocs.salesOrders.length === 1 && (
              <Button
                variant="secondary"
                leftIcon={<RiProgress8Line />}
                asChild
              >
                <Link
                  to={path.to.salesOrderDetails(relatedDocs.salesOrders[0].id)}
                >
                  <Trans>Sales Order</Trans>
                </Link>
              </Button>
            )}

            {relatedDocs.salesOrders.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" leftIcon={<RiProgress8Line />}>
                    <Trans>Sales Orders</Trans>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {relatedDocs.salesOrders.map((po) => (
                    <DropdownMenuItem key={po.id} asChild>
                      <Link to={path.to.salesOrderDetails(po.id)}>
                        {po.readableId}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {relatedDocs.shipments.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    leftIcon={<LuTruck />}
                    rightIcon={
                      relatedDocs.shipments.length > 1 ? (
                        <LuChevronDown />
                      ) : undefined
                    }
                  >
                    {relatedDocs.shipments.length === 1 ? (
                      <Trans>Shipment</Trans>
                    ) : (
                      <Trans>Shipments</Trans>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {relatedDocs.shipments.map((shipment) => (
                    <DropdownMenuItem key={shipment.id} asChild>
                      <Link to={path.to.shipment(shipment.id)}>
                        <DropdownMenuIcon icon={<LuTruck />} />
                        <HStack spacing={8}>
                          <span>{shipment.readableId}</span>
                          <ShipmentStatus
                            status={shipment.status as "Posted"}
                          />
                        </HStack>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
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
                    href={path.to.file.salesInvoice(invoiceId)}
                    rel="noreferrer"
                  >
                    <DropdownMenuIcon icon={<LuFile />} />
                    <Trans>PDF</Trans>
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              leftIcon={<LuCheckCheck />}
              variant={
                routeData?.salesInvoice?.status === "Draft"
                  ? "primary"
                  : "secondary"
              }
              onClick={showPostModal}
              isLoading={postFetcher.state !== "idle"}
              isDisabled={
                postFetcher.state !== "idle" ||
                isPosted ||
                routeData?.salesInvoiceLines?.length === 0 ||
                !permissions.can("update", "invoicing")
              }
            >
              <Trans>Post</Trans>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                asChild
                disabled={IS_PAYMENT_DROPDOWN_DISABLED}
              >
                <Button
                  variant="secondary"
                  isDisabled={IS_PAYMENT_DROPDOWN_DISABLED}
                  leftIcon={<LuDollarSign />}
                  rightIcon={<LuChevronDown />}
                >
                  <Trans>Payment</Trans>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup
                  value={salesInvoice.status ?? "Draft"}
                  onValueChange={handleStatusChange}
                >
                  {salesInvoiceStatusType
                    .filter(
                      (status) =>
                        !["Draft", "Pending", "Voided"].includes(status)
                    )
                    .map((status) => (
                      <DropdownMenuRadioItem key={status} value={status}>
                        <SalesInvoiceStatus status={status} />
                      </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton
              aria-label={t`Toggle Properties`}
              icon={<LuPanelRight />}
              onClick={toggleProperties}
              variant="ghost"
            />
          </HStack>
        </HStack>
      </div>

      {postingModal.isOpen && (
        <SalesInvoicePostModal
          invoiceId={invoiceId}
          customerId={salesInvoice.invoiceCustomerId}
          customerContactId={salesInvoice.invoiceCustomerContactId}
          isOpen={postingModal.isOpen}
          onClose={postingModal.onClose}
          linesToShip={linesNotAssociatedWithSO}
          fetcher={postFetcher}
          defaultCc={routeData?.defaultCc ?? []}
        />
      )}
      {voidModal.isOpen && (
        <SalesInvoiceVoidModal onClose={voidModal.onClose} />
      )}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteSalesInvoice(invoiceId)}
          isOpen={deleteModal.isOpen}
          name={salesInvoice.invoiceId ?? "sales invoice"}
          text={t`Are you sure you want to delete ${salesInvoice.invoiceId}? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default SalesInvoiceHeader;
