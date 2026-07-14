import { DefaultDisabledSubmit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCheckCheck,
  LuCreditCard,
  LuShoppingCart,
  LuTicketX,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { Link, useNavigation, useParams } from "react-router";
import type { z } from "zod";
import { DocumentHeader, PrintButton } from "~/components";
import { useAuditLog } from "~/components/AuditLog";
import {
  Combobox,
  CustomFormFields,
  Hidden,
  Input,
  Location,
  Select
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type {
  ItemTracking,
  Receipt,
  ReceiptLine,
  ReceiptSourceDocument,
  receiptStatusType
} from "~/modules/inventory";
import {
  ReceiptPostModal,
  ReceiptStatus,
  ReceiptVoidModal,
  receiptSourceDocumentType,
  receiptValidator
} from "~/modules/inventory";
import { path } from "~/utils/path";
import useReceiptForm from "./useReceiptForm";

type ReceiptFormProps = {
  initialValues: z.infer<typeof receiptValidator>;
  status: (typeof receiptStatusType)[number];
  receiptLines: ReceiptLine[];
};

const formId = "receipt-form";

const ReceiptForm = ({
  initialValues,
  status,
  receiptLines
}: ReceiptFormProps) => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const routeData = useRouteData<{
    receipt: Receipt;
    receiptLineTracking: ItemTracking[];
    fixedAssetLines: { id: string; received: boolean }[];
  }>(path.to.receipt(receiptId));

  const { company } = useUser();
  const permissions = usePermissions();
  const { t } = useLingui();
  const navigation = useNavigation();
  const {
    locationId,
    sourceDocuments,
    supplierId,
    setLocationId,
    setSourceDocument
  } = useReceiptForm({ status, initialValues });

  const postModal = useDisclosure();
  const voidModal = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "receipt",
    entityId: receiptId,
    companyId: company.id,
    variant: "dropdown"
  });

  const isPosted = status === "Posted";
  const isVoided = status === "Voided";
  const isInvoiced = routeData?.receipt?.invoiced === true;
  const isEditing = initialValues.id !== undefined;

  const hasReceivableFaLines = (routeData?.fixedAssetLines ?? []).some(
    (line) => line.received
  );
  const canPost =
    (receiptLines.length > 0 &&
      receiptLines.some((line) => (line.receivedQuantity ?? 0) !== 0)) ||
    hasReceivableFaLines;

  const receiptLineTracking = routeData?.receiptLineTracking ?? [];

  const canInvoice =
    isPosted &&
    !isInvoiced &&
    routeData?.receipt?.sourceDocument === "Purchase Order" &&
    routeData?.receipt?.sourceDocumentId &&
    permissions.can("create", "invoicing");

  const isInvoicing =
    navigation.state !== "idle" &&
    navigation.location?.pathname === path.to.newPurchaseInvoice;

  return (
    <>
      <Card>
        <ValidatedForm
          id={formId}
          validator={receiptValidator}
          method="post"
          action={path.to.receiptDetails(initialValues.id)}
          defaultValues={initialValues}
          style={{ width: "100%" }}
        >
          <DocumentHeader
            title={routeData?.receipt?.receiptId ?? ""}
            status={<ReceiptStatus status={status} />}
            menuItems={
              <>
                {auditLogTrigger}
                {isPosted && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={
                        isVoided ||
                        isInvoiced ||
                        !permissions.can("update", "inventory")
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
                    !permissions.can("delete", "inventory") ||
                    !permissions.is("employee")
                  }
                  destructive
                  onClick={deleteDisclosure.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete</Trans>
                </DropdownMenuItem>
              </>
            }
            actions={
              <>
                {receiptLineTracking.length > 0 && (
                  <PrintButton
                    sourceDocument="Receipt"
                    sourceDocumentId={receiptId}
                    locationId={locationId ?? undefined}
                    context="receiving"
                    fileRoutes={{
                      pdf: path.to.file.receiptLabelsPdf,
                      zpl: path.to.file.receiptLabelsZpl
                    }}
                  />
                )}
                <SourceDocumentLink
                  sourceDocument={
                    routeData?.receipt?.sourceDocument ?? undefined
                  }
                  sourceDocumentId={
                    routeData?.receipt?.sourceDocumentId ?? undefined
                  }
                  sourceDocumentReadableId={
                    routeData?.receipt?.sourceDocumentReadableId ?? undefined
                  }
                />
                <Button
                  variant={canInvoice ? "primary" : "secondary"}
                  isDisabled={!canInvoice || isInvoicing}
                  isLoading={isInvoicing}
                  leftIcon={<LuCreditCard />}
                  asChild
                >
                  <Link
                    to={`${path.to.newPurchaseInvoice}?sourceDocument=Purchase Order&sourceDocumentId=${routeData?.receipt?.sourceDocumentId}`}
                  >
                    <Trans>Invoice</Trans>
                  </Link>
                </Button>
                <Button
                  variant={canPost && !isPosted ? "primary" : "secondary"}
                  onClick={postModal.onOpen}
                  isDisabled={
                    !canPost || isPosted || !permissions.is("employee")
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
            <Hidden name="supplierId" value={supplierId ?? ""} />
            <VStack spacing={4} className="min-h-full">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 w-full">
                <Input name="receiptId" label={t`Receipt ID`} isReadOnly />
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
                  termId="receipt-source-document"
                  options={receiptSourceDocumentType.map((v) => ({
                    label: v,
                    value: v
                  }))}
                  onChange={(newValue) => {
                    if (newValue) {
                      setSourceDocument(
                        newValue.value as ReceiptSourceDocument
                      );
                    }
                  }}
                  isReadOnly={isPosted}
                />
                <Combobox
                  name="sourceDocumentId"
                  label={t`Source Document ID`}
                  termId="receipt-source-document-id"
                  options={sourceDocuments.map((d) => ({
                    label: d.name,
                    value: d.id
                  }))}
                  isReadOnly={isPosted}
                />
                <Input
                  name="externalDocumentId"
                  label={t`External Reference`}
                  termId="receipt-external-reference"
                  isDisabled={isPosted}
                />
                <CustomFormFields table="receipt" />
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

      {postModal.isOpen && <ReceiptPostModal onClose={postModal.onClose} />}
      {voidModal.isOpen && <ReceiptVoidModal onClose={voidModal.onClose} />}
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteReceipt(receiptId)}
          isOpen={deleteDisclosure.isOpen}
          name={routeData?.receipt?.receiptId ?? "receipt"}
          text={t`Are you sure you want to delete ${routeData?.receipt?.receiptId}? This cannot be undone.`}
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
    case "Purchase Order":
      if (!permissions.can("view", "purchasing")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuShoppingCart />} asChild>
          <Link to={path.to.purchaseOrderDetails(sourceDocumentId!)}>
            <Trans>Purchase Order</Trans>
          </Link>
        </Button>
      );
    case "Purchase Invoice":
      if (!permissions.can("view", "invoicing")) return null;
      return (
        <Button variant="secondary" leftIcon={<LuCreditCard />} asChild>
          <Link to={path.to.purchaseInvoice(sourceDocumentId!)}>
            <Trans>Purchase Invoice</Trans>
          </Link>
        </Button>
      );
    case "Inbound Transfer":
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

export default ReceiptForm;
