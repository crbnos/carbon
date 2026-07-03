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
import type { z } from "zod";
import {
  Customer,
  CustomerContact,
  CustomerLocation,
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit
} from "~/components/Form";
import { PdfExtractor } from "~/components/Form/PdfExtractor";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { isSalesRfqLocked, salesRfqValidator } from "../../sales.models";
import type { SalesRFQ } from "../../types";
import { useSalesRfqAutoFill } from "./useSalesRfqAutoFill";

type SalesRFQFormValues = z.infer<typeof salesRfqValidator>;

type SalesRFQFormProps = {
  initialValues: SalesRFQFormValues;
};

const SalesRFQForm = ({ initialValues }: SalesRFQFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;
  const isCustomer = permissions.is("customer");

  const routeData = useRouteData<{
    rfqSummary: SalesRFQ;
  }>(initialValues.id ? path.to.salesRfq(initialValues.id) : "");

  const isLocked = isSalesRfqLocked(routeData?.rfqSummary?.status);
  const isDraft = ["Draft", "Ready to Quote"].includes(
    initialValues.status ?? ""
  );

  const {
    customer,
    currentValues,
    formKey,
    extractedLineItems,
    extractedStoragePath,
    handleExtractionComplete,
    onCustomerChange
  } = useSalesRfqAutoFill(initialValues);

  return (
    <Card>
      <ValidatedForm
        key={formKey}
        method="post"
        validator={salesRfqValidator}
        defaultValues={currentValues}
        isDisabled={isEditing && isLocked}
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? <Trans>RFQ</Trans> : <Trans>New RFQ</Trans>}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                A sales request for quote (RFQ) is a customer inquiry for
                pricing on a set of parts and quantities. It may result in a
                quote.
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isEditing && <Hidden name="rfqId" />}
          <input
            type="hidden"
            name="extractedLineItems"
            value={JSON.stringify(extractedLineItems)}
          />
          {extractedStoragePath && (
            <input
              type="hidden"
              name="extractedStoragePath"
              value={extractedStoragePath}
            />
          )}
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
                  name="rfqId"
                  label={t`RFQ ID`}
                  placeholder={t`Next Sequence`}
                  table="salesRfq"
                />
              )}
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label={t`Customer`}
                onChange={onCustomerChange}
              />
              <Input
                name="customerReference"
                label={t`Customer RFQ`}
                termId="customer-document-reference"
              />
              <CustomerContact
                name="customerContactId"
                label={t`Purchasing Contact`}
                customer={customer.id}
                value={customer.customerContactId}
              />
              <CustomerContact
                name="customerEngineeringContactId"
                label={t`Engineering Contact`}
                customer={customer.id}
                value={customer.customerEngineeringContactId}
              />
              <CustomerLocation
                name="customerLocationId"
                label={t`Customer Location`}
                customer={customer.id}
                value={customer.customerLocationId}
              />
              <DatePicker
                name="rfqDate"
                label={t`RFQ Date`}
                helperText={t`The date you received this RFQ from the customer. Defaults to today.`}
                isDisabled={isCustomer}
                termId="rfq-date"
              />
              <DatePicker
                name="expirationDate"
                label={t`Due Date`}
                helperText={t`The deadline to send your quote to the customer.`}
                isDisabled={isCustomer}
                termId="sales-rfq-expiration-date"
              />
              <Location
                name="locationId"
                label={t`RFQ Location`}
                termId="rfq-receiving-location"
              />
              <Employee name="salesPersonId" label={t`Sales Person`} />
              <CustomFormFields table="salesRfq" />
            </div>
          </VStack>
          <PdfExtractor
            documentType="salesRfq"
            sourceDocument="Request for Quote"
            sourceDocumentId={initialValues.id}
            label={t`RFQ`}
            onExtractionComplete={handleExtractionComplete}
          />
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              !isDraft ||
              (isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales"))
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default SalesRFQForm;
