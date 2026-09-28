import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";
import type { z } from "zod";
import {
  Currency,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation
} from "~/components/Form";
import PaymentTerm from "~/components/Form/PaymentTerm";
import { PdfExtractor } from "~/components/Form/PdfExtractor";
import {
  usePermissions,
  useRouteData,
  useSupplierApprovalRequired
} from "~/hooks";
import { purchaseInvoiceValidator } from "~/modules/invoicing";
import { path } from "~/utils/path";
import { isPurchaseInvoiceLocked } from "../../invoicing.models";
import { usePurchaseInvoiceAutoFill } from "./usePurchaseInvoiceAutoFill";

type PurchaseInvoiceFormValues = z.infer<typeof purchaseInvoiceValidator>;

type PurchaseInvoiceFormProps = {
  initialValues: PurchaseInvoiceFormValues;
};

const PurchaseInvoiceForm = ({ initialValues }: PurchaseInvoiceFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const supplierApprovalRequired = useSupplierApprovalRequired();
  const isEditing = initialValues.id !== undefined;

  const { invoiceId } = useParams();
  const routeData = useRouteData<{ purchaseInvoice: { status: string } }>(
    invoiceId ? path.to.purchaseInvoice(invoiceId) : ""
  );
  const isLocked = isPurchaseInvoiceLocked(routeData?.purchaseInvoice?.status);

  const {
    supplier,
    invoiceSupplier,
    setInvoiceSupplier,
    currentValues,
    formKey,
    extractedLineItems,
    extractedTaxAmount,
    extractedStoragePath,
    handleExtractionComplete,
    onSupplierChange,
    onInvoiceSupplierChange
  } = usePurchaseInvoiceAutoFill(initialValues);

  return (
    <ValidatedForm
      key={formKey}
      method="post"
      validator={purchaseInvoiceValidator}
      defaultValues={currentValues}
      isDisabled={isEditing && isLocked}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {isEditing ? "Purchase Invoice" : "New Purchase Invoice"}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                A purchase invoice is a document that specifies the products or
                services purchased by a customer and the corresponding cost.
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <input
            type="hidden"
            name="extractedLineItems"
            value={JSON.stringify(extractedLineItems)}
          />
          <input
            type="hidden"
            name="extractedTaxAmount"
            value={extractedTaxAmount}
          />
          {extractedStoragePath && (
            <input
              type="hidden"
              name="extractedStoragePath"
              value={extractedStoragePath}
            />
          )}
          {currentValues.supplierShippingCost !== undefined && (
            <input
              type="hidden"
              name="supplierShippingCost"
              value={currentValues.supplierShippingCost}
            />
          )}
          {isEditing && <Hidden name="invoiceId" />}
          <VStack>
            <div
              className={cn(
                "grid w-full gap-x-8 gap-y-4",
                isEditing
                  ? "grid-cols-1 lg:grid-cols-3"
                  : "grid-cols-1 md:grid-cols-2"
              )}
            >
              {!isEditing && (
                <SequenceOrCustomId
                  name="invoiceId"
                  label={t`Invoice ID`}
                  table="purchaseInvoice"
                />
              )}
              <Supplier
                name="supplierId"
                label={t`Supplier`}
                defaultCurrencyCode={invoiceSupplier.currencyCode}
                onChange={onSupplierChange}
                onlyApproved={supplierApprovalRequired}
              />
              <Input
                name="supplierReference"
                label={t`Supplier Invoice Number`}
              />

              <Supplier
                name="invoiceSupplierId"
                label={t`Invoice Supplier`}
                value={invoiceSupplier.id}
                defaultCurrencyCode={invoiceSupplier.currencyCode}
                onChange={onInvoiceSupplierChange}
                onlyApproved={supplierApprovalRequired}
              />
              <SupplierLocation
                name="invoiceSupplierLocationId"
                label={t`Invoice Supplier Location`}
                supplier={supplier.id}
                value={invoiceSupplier.invoiceSupplierLocationId}
                onChange={(newValue) => {
                  if (newValue?.id) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      invoiceSupplierLocationId: newValue.id
                    }));
                  }
                }}
              />
              <SupplierContact
                name="invoiceSupplierContactId"
                label={t`Invoice Supplier Contact`}
                supplier={supplier.id}
                value={invoiceSupplier.invoiceSupplierContactId}
                onChange={(newValue) => {
                  if (newValue?.id) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      invoiceSupplierContactId: newValue.id
                    }));
                  }
                }}
              />

              <DatePicker name="dateDue" label={t`Due Date`} />
              <DatePicker name="dateIssued" label={t`Date Issued`} />

              <PaymentTerm
                name="paymentTermId"
                label={t`Payment Terms`}
                value={invoiceSupplier?.paymentTermId}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      paymentTermId: newValue.value
                    }));
                  }
                }}
              />
              <Currency
                name="currencyCode"
                label={t`Currency`}
                value={invoiceSupplier?.currencyCode}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      currencyCode: newValue.value
                    }));
                  }
                }}
              />
              <Location name="locationId" label={t`Delivery Location`} />
              <CustomFormFields table="purchaseInvoice" />
            </div>
          </VStack>
          <PdfExtractor
            documentType="purchaseInvoice"
            sourceDocument="Purchase Invoice"
            sourceDocumentId={initialValues.id}
            label={t`Invoice`}
            onExtractionComplete={handleExtractionComplete}
          />
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "invoicing")
                : !permissions.can("create", "invoicing")
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default PurchaseInvoiceForm;
