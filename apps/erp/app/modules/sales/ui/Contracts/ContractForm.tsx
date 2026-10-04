// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { flushSync } from "react-dom";
import type { z } from "zod";
import {
  Currency,
  Customer,
  CustomerContact,
  CustomerLocation,
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Number,
  PaymentTerm,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions, useSettings } from "~/hooks";
import {
  type ContractDuration,
  contractBillingAlignments,
  contractBillingFrequencies,
  contractBillingTimings,
  contractDurations,
  contractRenewals,
  customerContractTypes,
  customerContractValidator,
  invoiceAutomations
} from "../../sales.models";
import ContractProject from "./ContractProject";
import { useContractLabels } from "./useContractLabels";

type ContractFormValues = z.infer<typeof customerContractValidator>;

type ContractFormProps = {
  initialValues: ContractFormValues;
};

/** A new contract's terms. Once created they are edited in the contract's
 *  properties panel, so this form only creates. */
const ContractForm = ({ initialValues }: ContractFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const companySettings = useSettings();
  const labels = useContractLabels();

  const [customer, setCustomer] = useState<{
    id: string | undefined;
    currencyCode: string | undefined;
    invoiceCustomerId: string | undefined;
    invoiceCustomerContactId: string | undefined;
    invoiceCustomerLocationId: string | undefined;
    paymentTermId: string | undefined;
  }>({
    id: initialValues.customerId || undefined,
    currencyCode: initialValues.currencyCode,
    invoiceCustomerId: initialValues.invoiceCustomerId,
    invoiceCustomerContactId: initialValues.invoiceCustomerContactId,
    invoiceCustomerLocationId: initialValues.invoiceCustomerLocationId,
    paymentTermId: initialValues.paymentTermId
  });
  const [startDate, setStartDate] = useState(initialValues.startDate);
  const [duration, setDuration] = useState<ContractDuration>(
    initialValues.duration
  );
  // The contact and address invoices go to belong to the bill-to customer.
  const billTo = customer.invoiceCustomerId ?? customer.id;

  const onCustomerChange = async (
    newValue: { value: string | undefined } | null
  ) => {
    if (!carbon) {
      toast.error(t`Carbon client not found`);
      return;
    }

    if (!newValue?.value) {
      setCustomer({
        id: undefined,
        currencyCode: undefined,
        invoiceCustomerId: undefined,
        invoiceCustomerContactId: undefined,
        invoiceCustomerLocationId: undefined,
        paymentTermId: undefined
      });
      return;
    }

    flushSync(() => {
      setCustomer({
        id: newValue.value,
        currencyCode: undefined,
        invoiceCustomerId: undefined,
        invoiceCustomerContactId: undefined,
        invoiceCustomerLocationId: undefined,
        paymentTermId: undefined
      });
    });

    // The customer's own invoicing defaults (Customer → Payment).
    const [customerData, payment] = await Promise.all([
      carbon
        .from("customer")
        .select("currencyCode")
        .eq("id", newValue.value)
        .single(),
      carbon
        .from("customerPayment")
        .select(
          "invoiceCustomerId, invoiceCustomerContactId, invoiceCustomerLocationId, paymentTermId"
        )
        .eq("customerId", newValue.value)
        .maybeSingle()
    ]);
    if (customerData.error || payment.error) {
      toast.error(t`Error fetching customer data`);
      return;
    }
    setCustomer((prev) => ({
      ...prev,
      currencyCode: customerData.data.currencyCode ?? undefined,
      invoiceCustomerId: payment.data?.invoiceCustomerId ?? undefined,
      invoiceCustomerContactId:
        payment.data?.invoiceCustomerContactId ?? undefined,
      invoiceCustomerLocationId:
        payment.data?.invoiceCustomerLocationId ?? undefined,
      paymentTermId: payment.data?.paymentTermId ?? undefined
    }));
  };

  const companyLabel =
    labels.invoiceAutomation[companySettings.invoiceAutomation];

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={customerContractValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>
            <Trans>New Contract</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              A contract bills a customer for services on a schedule — one-time
              fees and recurring charges — and spreads the revenue over the
              service period.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <VStack spacing={4}>
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
              <Input autoFocus name="name" label={t`Name`} />
              <Customer
                name="customerId"
                label={t`Customer`}
                onChange={onCustomerChange}
              />
              <Input name="customerReference" label={t`PO Number`} />
              <Customer
                name="invoiceCustomerId"
                label={t`Bill To`}
                value={customer.invoiceCustomerId}
                onChange={(value) =>
                  setCustomer((prev) => ({
                    ...prev,
                    invoiceCustomerId: value?.value || undefined,
                    invoiceCustomerContactId: undefined,
                    invoiceCustomerLocationId: undefined
                  }))
                }
              />
              <CustomerContact
                name="invoiceCustomerContactId"
                label={t`Invoice Contact`}
                customer={billTo}
                value={customer.invoiceCustomerContactId}
              />
              <CustomerLocation
                name="invoiceCustomerLocationId"
                label={t`Invoice Address`}
                customer={billTo}
                value={customer.invoiceCustomerLocationId}
              />
              <Employee name="salesPersonId" label={t`Sales Person`} />
              <ContractProject name="projectId" label={t`Project`} />
              <Select
                name="contractType"
                label={t`Contract Type`}
                placeholder={t`Suggested from the customer's contracts`}
                isClearable
                options={customerContractTypes.map((type) => ({
                  value: type,
                  label: labels.contractType[type]
                }))}
              />
            </div>

            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 border-t border-border pt-4">
              <DatePicker name="closeDate" label={t`Close Date`} />
              <DatePicker
                name="startDate"
                label={t`Start Date`}
                onChange={(date) => setStartDate(date ?? "")}
              />
              <Select
                name="duration"
                label={t`Duration`}
                options={contractDurations.map((value) => ({
                  value,
                  label: labels.duration[value]
                }))}
                onChange={(option) =>
                  option && setDuration(option.value as ContractDuration)
                }
              />
              {duration === "custom" && (
                <DatePicker
                  name="endDate"
                  label={t`End Date`}
                  minValue={startDate ? parseDate(startDate) : undefined}
                />
              )}
              <Select
                name="renewal"
                label={t`At the End`}
                options={contractRenewals.map((value) => ({
                  value,
                  label: labels.renewal[value]
                }))}
              />
              <Number
                name="renewalUplift"
                label={t`Renewal Uplift (%)`}
                minValue={0}
                step={INPUT_STEP.percent}
                formatOptions={INPUT_FORMAT.percentPoints}
              />
            </div>

            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 border-t border-border pt-4">
              <Select
                name="billingFrequency"
                label={t`Billing Frequency`}
                options={contractBillingFrequencies.map((value) => ({
                  value,
                  label: labels.billingFrequency[value]
                }))}
              />
              <Select
                name="billingAlignment"
                label={t`Billing Alignment`}
                options={contractBillingAlignments.map((value) => ({
                  value,
                  label: labels.billingAlignment[value]
                }))}
              />
              <Select
                name="billingTiming"
                label={t`Billing Timing`}
                termId="billing-timing"
                options={contractBillingTimings.map((value) => ({
                  value,
                  label: labels.billingTiming[value]
                }))}
              />
              <DatePicker name="firstInvoiceDate" label={t`First Invoice`} />
              <DatePicker name="billedThrough" label={t`Billed Through`} />
              <DatePicker
                name="recognizeRevenueFrom"
                label={t`Recognize Revenue From`}
              />
              <Select
                name="invoiceAutomation"
                label={t`Invoicing`}
                // Empty is the company's setting.
                placeholder={t`Company default (${companyLabel})`}
                isClearable
                options={invoiceAutomations.map((mode) => ({
                  value: mode,
                  label: labels.invoiceAutomation[mode]
                }))}
              />
              <PaymentTerm
                name="paymentTermId"
                label={t`Payment Terms`}
                value={customer.paymentTermId}
              />
              <Currency
                name="currencyCode"
                label={t`Currency`}
                value={customer.currencyCode}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setCustomer((prev) => ({
                      ...prev,
                      currencyCode: newValue.value
                    }));
                  }
                }}
              />
            </div>

            <TextArea name="notes" label={t`Notes`} />
            <CustomFormFields table="customerContract" />
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("create", "sales")}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ContractForm;
