import {
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
  useDisclosure
} from "@carbon/react";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { labelSizes } from "@carbon/utils";
import { Suspense } from "react";
import {
  LuBarcode,
  LuCheckCheck,
  LuChevronDown,
  LuCirclePlus,
  LuCreditCard,
  LuEllipsisVertical,
  LuQrCode,
  LuShoppingCart,
  LuTicketX,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Await, Link, useNavigate, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type { ItemTracking, Shipment, ShipmentLine } from "~/modules/inventory";
import type { SalesInvoice } from "~/modules/invoicing/types";
import SalesInvoiceStatus from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceStatus";
import { path } from "~/utils/path";
import ShipmentPostModal from "./ShipmentPostModal";
import ShipmentStatus from "./ShipmentStatus";
import ShipmentVoidModal from "./ShipmentVoidModal";

const ShipmentHeader = () => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const routeData = useRouteData<{
    shipment: Shipment;
    shipmentLines: ShipmentLine[];
    shipmentLineTracking: ItemTracking[];
    relatedItems?: Promise<{
      invoices: SalesInvoice[];
    }>;
  }>(path.to.shipment(shipmentId));

  if (!routeData?.shipment) throw new Error("Failed to load shipment");

  const { company } = useUser();
  const permissions = usePermissions();
  const postModal = useDisclosure();
  const voidModal = useDisclosure();
  const deleteModal = useDisclosure();
  const navigate = useNavigate();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "shipment",
    entityId: shipmentId,
    companyId: company.id,
    variant: "dropdown"
  });

  const canPost =
    routeData.shipmentLines.length > 0 &&
    routeData.shipmentLines.some((line) => (line.shippedQuantity ?? 0) !== 0);

  const isPosted = routeData.shipment.status === "Posted";
  const isVoided = routeData.shipment.status === "Voided";
  // const isInvoiced = routeData.shipment.invoiced;
  const hasTrackingLabels = routeData.shipmentLineTracking.some(
    (line) => "Split Entity ID" in (line.attributes as TrackedEntityAttributes)
  );

  const navigateToTrackingLabels = (zpl?: boolean, labelSize?: string) => {
    if (!window) return;
    if (zpl) {
      window.open(
        window.location.origin +
          path.to.file.shipmentLabelsZpl(shipmentId, {
            labelSize
          }),
        "_blank"
      );
    } else {
      window.open(
        window.location.origin +
          path.to.file.shipmentLabelsPdf(shipmentId, { labelSize }),
        "_blank"
      );
    }
  };

  const invoice = (shipment?: Shipment) => {
    if (!shipment) return;
    // Navigate to create invoice from shipment
    navigate(
      `${path.to.newSalesInvoice}?sourceDocument=Shipment&sourceDocumentId=${shipmentId}`
    );
  };

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1)]">
        <HStack className="w-full justify-between">
          <HStack>
            <Link to={path.to.shipmentDetails(shipmentId)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.shipment?.shipmentId}</span>
              </Heading>
            </Link>
            <Copy text={routeData?.shipment?.shipmentId ?? ""} />
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
                {auditLogTrigger}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={
                    !permissions.can("delete", "inventory") ||
                    !permissions.is("employee")
                  }
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  Delete Shipment
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ShipmentStatus
              status={routeData?.shipment?.status}
              invoiced={routeData?.shipment?.invoiced}
            />
          </HStack>
          <HStack>
            {hasTrackingLabels && (
              <SplitButton
                leftIcon={<LuQrCode />}
                dropdownItems={labelSizes.map((size) => ({
                  label: size.name,
                  onClick: () => navigateToTrackingLabels(!!size.zpl, size.id)
                }))}
                // TODO: if we knew the preferred label size, we could use that here
                onClick={() => navigateToTrackingLabels(false)}
                variant="primary"
              >
                Tracking Labels
              </SplitButton>
            )}

            <Button variant="secondary" leftIcon={<LuBarcode />} asChild>
              <a
                target="_blank"
                href={path.to.file.shipment(shipmentId)}
                rel="noreferrer"
              >
                Packing Slip
              </a>
            </Button>

            <SourceDocumentLink
              sourceDocument={routeData.shipment.sourceDocument ?? undefined}
              sourceDocumentId={
                routeData.shipment.sourceDocumentId ?? undefined
              }
              sourceDocumentReadableId={
                routeData.shipment.sourceDocumentReadableId ?? undefined
              }
            />

            {permissions.can("view", "invoicing") && (
              <>
                {routeData?.shipment.sourceDocument === "Sales Order" && (
                  <Suspense
                    fallback={
                      <Button
                        leftIcon={<LuCreditCard />}
                        variant="secondary"
                        isLoading
                      >
                        Loading...
                      </Button>
                    }
                  >
                    <Await resolve={routeData?.relatedItems}>
                      {(relatedItems) => {
                        const invoices = relatedItems?.invoices || [];
                        return invoices.length > 0 ? (
                          invoices.length === 1 &&
                          invoices[0].shipmentId === shipmentId ? (
                            <Button
                              leftIcon={<LuCreditCard />}
                              variant={"secondary"}
                              isDisabled={!isPosted}
                              asChild
                            >
                              <Link to={path.to.salesInvoice(invoices[0].id!)}>
                                Invoice
                              </Link>
                            </Button>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  leftIcon={<LuCreditCard />}
                                  rightIcon={<LuChevronDown />}
                                  variant={"secondary"}
                                >
                                  Invoice
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  disabled={!isPosted}
                                  onClick={() => {
                                    invoice(routeData?.shipment);
                                  }}
                                >
                                  <DropdownMenuIcon icon={<LuCirclePlus />} />
                                  New Invoice
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {invoices.map((invoice) => (
                                  <DropdownMenuItem key={invoice.id} asChild>
                                    <Link
                                      to={path.to.salesInvoice(invoice.id!)}
                                    >
                                      <DropdownMenuIcon
                                        icon={<LuCreditCard />}
                                      />
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
                          )
                        ) : (
                          <Button
                            leftIcon={<LuCreditCard />}
                            variant={isVoided ? "secondary" : "primary"}
                            isDisabled={!isPosted}
                            onClick={() => {
                              invoice(routeData?.shipment);
                            }}
                          >
                            Invoice
                          </Button>
                        );
                      }}
                    </Await>
                  </Suspense>
                )}
                {routeData?.shipment.sourceDocument === "Sales Invoice" && (
                  <Suspense
                    fallback={
                      <Button
                        leftIcon={<LuCreditCard />}
                        variant="secondary"
                        isLoading
                      >
                        Loading...
                      </Button>
                    }
                  >
                    <Await resolve={routeData?.relatedItems}>
                      {(relatedItems) => {
                        const invoices = relatedItems?.invoices || [];

                        if (invoices.length === 0) {
                          return (
                            <Button
                              variant="secondary"
                              leftIcon={<LuCreditCard />}
                              asChild
                            >
                              <Link
                                to={path.to.salesInvoice(
                                  routeData.shipment.sourceDocumentId!
                                )}
                              >
                                Invoice
                              </Link>
                            </Button>
                          );
                        } else if (invoices.length === 1) {
                          return (
                            <Button
                              variant="secondary"
                              leftIcon={<LuCreditCard />}
                              asChild
                            >
                              <Link to={path.to.salesInvoice(invoices[0].id!)}>
                                Invoice
                              </Link>
                            </Button>
                          );
                        } else {
                          return (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  leftIcon={<LuCreditCard />}
                                  rightIcon={<LuChevronDown />}
                                  variant="secondary"
                                >
                                  Invoices
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {invoices.map((invoice) => (
                                  <DropdownMenuItem key={invoice.id} asChild>
                                    <Link
                                      to={path.to.salesInvoice(invoice.id!)}
                                    >
                                      <DropdownMenuIcon
                                        icon={<LuCreditCard />}
                                      />
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
                          );
                        }
                      }}
                    </Await>
                  </Suspense>
                )}
              </>
            )}
            <Button
              variant={
                canPost && !isPosted && !isVoided ? "primary" : "secondary"
              }
              onClick={postModal.onOpen}
              isDisabled={
                !canPost || isPosted || isVoided || !permissions.is("employee")
              }
              leftIcon={<LuCheckCheck />}
            >
              Post
            </Button>
            {(isPosted || isVoided) && (
              <Button
                variant="destructive"
                onClick={voidModal.onOpen}
                isDisabled={isVoided || !permissions.is("employee")}
                leftIcon={<LuTicketX />}
              >
                Void
              </Button>
            )}
          </HStack>
        </HStack>
      </div>

      {postModal.isOpen && <ShipmentPostModal onClose={postModal.onClose} />}
      {voidModal.isOpen && <ShipmentVoidModal onClose={voidModal.onClose} />}
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteShipment(shipmentId)}
          isOpen={deleteModal.isOpen}
          name={routeData?.shipment?.shipmentId ?? "shipment"}
          text={`Are you sure you want to delete ${routeData?.shipment?.shipmentId}? This cannot be undone.`}
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

function SourceDocumentLink({
  sourceDocument,
  sourceDocumentId,
  sourceDocumentReadableId
}: {
  sourceDocument?: string;
  sourceDocumentId?: string;
  sourceDocumentReadableId?: string;
}) {
  const permissions = usePermissions();

  if (!sourceDocument || !sourceDocumentId || !sourceDocumentReadableId)
    return null;
  switch (sourceDocument) {
    case "Sales Order":
      if (!permissions.can("view", "sales")) return null;
      return (
        <Button variant="secondary" leftIcon={<RiProgress8Line />} asChild>
          <Link to={path.to.salesOrderDetails(sourceDocumentId!)}>
            Sales Order
          </Link>
        </Button>
      );
    case "Purchase Order":
      if (!permissions.can("view", "purchasing")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuShoppingCart />} asChild>
          <Link to={path.to.purchaseOrderDetails(sourceDocumentId!)}>
            Purchase Order
          </Link>
        </Button>
      );
    case "Outbound Transfer":
      if (!permissions.can("view", "inventory")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuTruck />} asChild>
          <Link to={path.to.warehouseTransferDetails(sourceDocumentId!)}>
            Warehouse Transfer
          </Link>
        </Button>
      );
    // case "Sales Invoice":
    //   return (
    //     <Button variant="secondary" leftIcon={<LuCreditCard />} asChild>
    //       <Link to={path.to.salesInvoiceDetails(sourceDocumentId!)}>
    //         Sales Invoice
    //       </Link>
    //     </Button>
    //   );
    default:
      return null;
  }
}

export default ShipmentHeader;
