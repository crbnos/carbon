import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import {
  LuBarcode,
  LuCheckCheck,
  LuChevronDown,
  LuCirclePlus,
  LuCreditCard,
  LuShoppingCart,
  LuTicketX,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Await, Link, useNavigate, useParams } from "react-router";
import type { z } from "zod";
import { DocumentHeader, PrintButton } from "~/components";
import { useAuditLog } from "~/components/AuditLog";
import {
  Combobox,
  CustomFormFields,
  DefaultDisabledSubmit,
  Hidden,
  Input,
  Location,
  Select,
  ShippingMethod
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type {
  ItemTracking,
  Shipment,
  ShipmentLine,
  ShipmentSourceDocument,
  shipmentStatusType
} from "~/modules/inventory";
import {
  shipmentSourceDocumentType,
  shipmentValidator
} from "~/modules/inventory";
import type { SalesInvoice } from "~/modules/invoicing/types";
import SalesInvoiceStatus from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceStatus";
import { path } from "~/utils/path";
import ShipmentPostModal from "../ShipmentPostModal";
import ShipmentStatus from "../ShipmentStatus";
import ShipmentVoidModal from "../ShipmentVoidModal";
import useShipmentForm from "./useShipmentForm";

type ShipmentFormProps = {
  initialValues: z.infer<typeof shipmentValidator>;
  status: (typeof shipmentStatusType)[number];
  shipmentLines: ShipmentLine[];
};

const formId = "shipment-form";

const ShipmentForm = ({
  initialValues,
  status,
  shipmentLines
}: ShipmentFormProps) => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const routeData = useRouteData<{
    shipment: Shipment;
    shipmentLineTracking: ItemTracking[];
    fixedAssetLines: { id: string; shipped: boolean }[];
    relatedItems?: Promise<{ invoices: SalesInvoice[] }>;
  }>(path.to.shipment(shipmentId));

  const { company } = useUser();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { t } = useLingui();
  const {
    locationId,
    sourceDocuments,
    customerId,
    setLocationId,
    setSourceDocument
  } = useShipmentForm({ status, initialValues });

  const postModal = useDisclosure();
  const voidModal = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "shipment",
    entityId: shipmentId,
    companyId: company.id,
    variant: "dropdown"
  });

  const isPosted = status === "Posted";
  const isVoided = status === "Voided";
  const isEditing = initialValues.id !== undefined;

  const hasShippableFaLines = (routeData?.fixedAssetLines ?? []).some(
    (line) => line.shipped
  );
  const canPost =
    (shipmentLines.length > 0 &&
      shipmentLines.some((line) => (line.shippedQuantity ?? 0) !== 0)) ||
    hasShippableFaLines;

  const shipmentLineTracking = routeData?.shipmentLineTracking ?? [];
  const hasTrackingLabels = shipmentLineTracking.length > 0;

  const createInvoice = (shipment?: Shipment) => {
    if (!shipment) return;
    navigate(
      `${path.to.newSalesInvoice}?sourceDocument=Shipment&sourceDocumentId=${shipmentId}`
    );
  };

  return (
    <>
      <Card>
        <ValidatedForm
          id={formId}
          validator={shipmentValidator}
          method="post"
          action={path.to.shipmentDetails(initialValues.id)}
          defaultValues={initialValues}
          style={{ width: "100%" }}
        >
          <DocumentHeader
            title={routeData?.shipment?.shipmentId ?? ""}
            status={
              <ShipmentStatus
                status={status}
                invoiced={routeData?.shipment?.invoiced}
              />
            }
            menuItems={
              <>
                {auditLogTrigger}
                {(isPosted || isVoided) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={isVoided || !permissions.is("employee")}
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
                    !permissions.can("delete", "inventory") ||
                    !permissions.is("employee")
                  }
                  destructive
                  onClick={deleteDisclosure.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Shipment</Trans>
                </DropdownMenuItem>
              </>
            }
            actions={
              <>
                {hasTrackingLabels && (
                  <PrintButton
                    sourceDocument="Shipment"
                    sourceDocumentId={shipmentId}
                    locationId={locationId ?? undefined}
                    context="shipping"
                    fileRoutes={{
                      pdf: path.to.file.shipmentLabelsPdf,
                      zpl: path.to.file.shipmentLabelsZpl
                    }}
                  />
                )}
                <Button variant="secondary" leftIcon={<LuBarcode />} asChild>
                  <a
                    target="_blank"
                    href={path.to.file.shipment(shipmentId)}
                    rel="noreferrer"
                  >
                    <Trans>Packing Slip</Trans>
                  </a>
                </Button>
                <SourceDocumentLink
                  sourceDocument={
                    routeData?.shipment?.sourceDocument ?? undefined
                  }
                  sourceDocumentId={
                    routeData?.shipment?.sourceDocumentId ?? undefined
                  }
                  sourceDocumentReadableId={
                    routeData?.shipment?.sourceDocumentReadableId ?? undefined
                  }
                />
                {permissions.can("view", "invoicing") && (
                  <InvoiceButtons
                    shipment={routeData?.shipment}
                    relatedItems={routeData?.relatedItems}
                    shipmentId={shipmentId}
                    isPosted={isPosted}
                    isVoided={isVoided}
                    onCreateInvoice={createInvoice}
                  />
                )}
                <Button
                  variant={!isPosted && !isVoided ? "primary" : "secondary"}
                  onClick={postModal.onOpen}
                  isDisabled={
                    !canPost ||
                    isPosted ||
                    isVoided ||
                    !permissions.is("employee")
                  }
                  leftIcon={<LuCheckCheck />}
                >
                  <Trans>Post</Trans>
                </Button>
              </>
            }
          />

          <CardContent>
            <Hidden name="id" />
            <Hidden name="customerId" value={customerId ?? ""} />
            <VStack spacing={4} className="min-h-full">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 w-full">
                <Input name="shipmentId" label={t`Shipment ID`} isReadOnly />
                <Location
                  name="locationId"
                  label={t`Location`}
                  value={locationId ?? undefined}
                  onChange={(newValue) => {
                    if (newValue) setLocationId(newValue.value as string);
                  }}
                  isReadOnly={isPosted}
                />
                <Select
                  name="sourceDocument"
                  label={t`Source Document`}
                  termId="shipment-source-document"
                  options={shipmentSourceDocumentType.map((v) => ({
                    label: v,
                    value: v
                  }))}
                  onChange={(newValue) => {
                    if (newValue) {
                      setSourceDocument(
                        newValue.value as ShipmentSourceDocument
                      );
                    }
                  }}
                  isReadOnly={isPosted}
                />
                <Combobox
                  name="sourceDocumentId"
                  label={t`Source Document ID`}
                  termId="shipment-source-document-id"
                  options={sourceDocuments.map((d) => ({
                    label: d.name,
                    value: d.id
                  }))}
                  isReadOnly={isPosted}
                />
                <Input name="trackingNumber" label={t`Tracking Number`} />
                <ShippingMethod
                  name="shippingMethodId"
                  label={t`Shipping Method`}
                />
                <CustomFormFields table="shipment" />
              </div>
            </VStack>
          </CardContent>
          <CardFooter>
            <DefaultDisabledSubmit
              formId={formId}
              isDisabled={
                isEditing
                  ? !permissions.can("update", "inventory")
                  : !permissions.can("create", "inventory")
              }
            >
              <Trans>Save</Trans>
            </DefaultDisabledSubmit>
          </CardFooter>
        </ValidatedForm>
      </Card>

      {postModal.isOpen && <ShipmentPostModal onClose={postModal.onClose} />}
      {voidModal.isOpen && <ShipmentVoidModal onClose={voidModal.onClose} />}
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteShipment(shipmentId)}
          isOpen={deleteDisclosure.isOpen}
          name={routeData?.shipment?.shipmentId ?? "shipment"}
          text={t`Are you sure you want to delete ${routeData?.shipment?.shipmentId}? This cannot be undone.`}
          onCancel={() => {
            deleteDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
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
            <Trans>Sales Order</Trans>
          </Link>
        </Button>
      );
    case "Purchase Order":
      if (!permissions.can("view", "purchasing")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuShoppingCart />} asChild>
          <Link to={path.to.purchaseOrderDetails(sourceDocumentId!)}>
            <Trans>Purchase Order</Trans>
          </Link>
        </Button>
      );
    case "Outbound Transfer":
      if (!permissions.can("view", "inventory")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuTruck />} asChild>
          <Link to={path.to.warehouseTransferDetails(sourceDocumentId!)}>
            <Trans>Warehouse Transfer</Trans>
          </Link>
        </Button>
      );
    default:
      return null;
  }
}

function InvoiceButtons({
  shipment,
  relatedItems,
  shipmentId,
  isPosted,
  isVoided,
  onCreateInvoice
}: {
  shipment?: Shipment;
  relatedItems?: Promise<{ invoices: SalesInvoice[] }>;
  shipmentId: string;
  isPosted: boolean;
  isVoided: boolean;
  onCreateInvoice: (shipment?: Shipment) => void;
}) {
  if (!shipment) return null;

  if (shipment.sourceDocument === "Sales Order") {
    return (
      <Suspense
        fallback={
          <Button leftIcon={<LuCreditCard />} variant="secondary" isLoading>
            Loading...
          </Button>
        }
      >
        <Await resolve={relatedItems}>
          {(resolved) => {
            const invoices = resolved?.invoices || [];
            return invoices.length > 0 ? (
              invoices.length === 1 && invoices[0].shipmentId === shipmentId ? (
                <Button
                  leftIcon={<LuCreditCard />}
                  variant="secondary"
                  isDisabled={!isPosted}
                  asChild
                >
                  <Link to={path.to.salesInvoice(invoices[0].id!)}>
                    <Trans>Invoice</Trans>
                  </Link>
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      leftIcon={<LuCreditCard />}
                      rightIcon={<LuChevronDown />}
                      variant="secondary"
                    >
                      <Trans>Invoice</Trans>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={!isPosted}
                      onClick={() => onCreateInvoice(shipment)}
                    >
                      <DropdownMenuIcon icon={<LuCirclePlus />} />
                      <Trans>New Invoice</Trans>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {invoices.map((inv) => (
                      <DropdownMenuItem key={inv.id} asChild>
                        <Link to={path.to.salesInvoice(inv.id!)}>
                          <DropdownMenuIcon icon={<LuCreditCard />} />
                          <HStack spacing={8}>
                            <span>{inv.invoiceId}</span>
                            <SalesInvoiceStatus status={inv.status} />
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
                variant={isPosted && !isVoided ? "primary" : "secondary"}
                isDisabled={!isPosted}
                onClick={() => onCreateInvoice(shipment)}
              >
                <Trans>Invoice</Trans>
              </Button>
            );
          }}
        </Await>
      </Suspense>
    );
  }

  if (shipment.sourceDocument === "Sales Invoice") {
    return (
      <Suspense
        fallback={
          <Button leftIcon={<LuCreditCard />} variant="secondary" isLoading>
            Loading...
          </Button>
        }
      >
        <Await resolve={relatedItems}>
          {(resolved) => {
            const invoices = resolved?.invoices || [];
            if (invoices.length === 0) {
              return (
                <Button variant="secondary" leftIcon={<LuCreditCard />} asChild>
                  <Link to={path.to.salesInvoice(shipment.sourceDocumentId!)}>
                    <Trans>Invoice</Trans>
                  </Link>
                </Button>
              );
            } else if (invoices.length === 1) {
              return (
                <Button variant="secondary" leftIcon={<LuCreditCard />} asChild>
                  <Link to={path.to.salesInvoice(invoices[0].id!)}>
                    <Trans>Invoice</Trans>
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
                      <Trans>Invoices</Trans>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {invoices.map((inv) => (
                      <DropdownMenuItem key={inv.id} asChild>
                        <Link to={path.to.salesInvoice(inv.id!)}>
                          <DropdownMenuIcon icon={<LuCreditCard />} />
                          <HStack spacing={8}>
                            <span>{inv.invoiceId}</span>
                            <SalesInvoiceStatus status={inv.status} />
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
    );
  }

  return null;
}

export default ShipmentForm;
