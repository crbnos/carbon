// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Location,
  Number,
  Select,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation,
  TextArea
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  leasePaymentFrequencies,
  leasePaymentTimings,
  leaseValidator
} from "../../purchasing.models";

type LeaseFormValues = z.infer<typeof leaseValidator>;

type LeaseFormProps = {
  initialValues: LeaseFormValues;
};

function Section({
  title,
  description,
  children
}: {
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <VStack spacing={4} className="w-full">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid w-full grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
        {children}
      </div>
    </VStack>
  );
}

/** A new lease: who it is with, what is leased, the term, the payment terms
 *  that cut the payment rows, and the inputs the classification reads. Every
 *  term stays editable in the properties panel while the lease is Draft. */
const LeaseForm = ({ initialValues }: LeaseFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const [supplierId, setSupplierId] = useState(initialValues.supplierId);
  const [commencementDate, setCommencementDate] = useState(
    initialValues.commencementDate
  );
  const currencyDecimals = useCurrencyDecimals(initialValues.currencyCode);
  const moneyFormat = INPUT_FORMAT.money(
    initialValues.currencyCode,
    currencyDecimals
  );
  const moneyStep = INPUT_STEP.money(currencyDecimals);

  return (
    <Card>
      <ValidatedForm
        method="post"
        action={path.to.newLease}
        validator={leaseValidator}
        defaultValues={initialValues}
        className="w-full"
      >
        <CardHeader>
          <CardTitle>
            <Trans>New Lease</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Equipment, vehicles or buildings the company rents from a
              supplier. Payment rows are cut from the payment terms and can be
              edited until the lease is activated.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <Hidden name="currencyCode" />
          <VStack spacing={8}>
            <Section
              title={<Trans>Lessor</Trans>}
              description={
                <Trans>
                  Who the company leases from, and who owns it here.
                </Trans>
              }
            >
              <Supplier
                autoFocus
                name="supplierId"
                label={t`Supplier`}
                onChange={(option) => setSupplierId(option?.value ?? "")}
              />
              <SupplierLocation
                name="supplierLocationId"
                label={t`Supplier Location`}
                supplier={supplierId}
              />
              <SupplierContact
                name="supplierContactId"
                label={t`Supplier Contact`}
                supplier={supplierId}
              />
              <Employee
                name="assignee"
                label={t`Owner`}
                helperText={t`Receives the invoice digest and the reminders`}
              />
            </Section>

            <Section
              title={<Trans>Leased Asset</Trans>}
              description={<Trans>What is leased and where it is used.</Trans>}
            >
              <Input
                name="name"
                label={t`Name`}
                helperText={t`For example "Forklift FL-12" or "Plant 2 building"`}
              />
              <Location name="locationId" label={t`Location`} />
              <div className="md:col-span-2">
                <TextArea name="description" label={t`Description`} />
              </div>
            </Section>

            <Section
              title={<Trans>Term</Trans>}
              description={
                <Trans>
                  The end date is the last day of the term, including renewals
                  that are reasonably certain.
                </Trans>
              }
            >
              <DatePicker
                name="commencementDate"
                label={t`Commencement Date`}
                onChange={(date) => setCommencementDate(date ?? "")}
              />
              <DatePicker name="endDate" label={t`End Date`} />
              <DatePicker
                name="noticeDate"
                label={t`Notice Date`}
                helperText={t`The last day to give renewal or termination notice`}
              />
              <DatePicker
                name="invoiceFromDate"
                label={t`Invoice From`}
                helperText={
                  commencementDate
                    ? t`Payments due before this date are marked paid outside Carbon`
                    : undefined
                }
              />
            </Section>

            <Section
              title={<Trans>Payments</Trans>}
              description={
                <Trans>
                  The escalation applies on each anniversary of the commencement
                  date.
                </Trans>
              }
            >
              <Number
                name="paymentAmount"
                label={t`Payment Amount`}
                minValue={0}
                step={moneyStep}
                formatOptions={moneyFormat}
              />
              <Select
                name="paymentFrequency"
                label={t`Payment Frequency`}
                options={leasePaymentFrequencies.map((frequency) => ({
                  value: frequency,
                  label:
                    frequency === "Monthly"
                      ? t`Monthly`
                      : frequency === "Quarterly"
                        ? t`Quarterly`
                        : t`Annual`
                }))}
              />
              <Select
                name="paymentTiming"
                label={t`Payment Timing`}
                options={leasePaymentTimings.map((timing) => ({
                  value: timing,
                  label:
                    timing === "Advance"
                      ? t`Advance (start of each period)`
                      : t`Arrears (end of each period)`
                }))}
              />
              <Number
                name="annualEscalationPercent"
                label={t`Annual Escalation (%)`}
                minValue={0}
                step={INPUT_STEP.percent}
                formatOptions={INPUT_FORMAT.percentPoints}
              />
            </Section>

            <Section
              title={<Trans>Accounting Treatment</Trans>}
              description={
                <Trans>
                  The discount rate values the payments. The inputs below decide
                  whether this is an operating or a finance lease.
                </Trans>
              }
            >
              <Number
                name="discountRate"
                label={t`Discount Rate (%)`}
                helperText={t`Annual. Starts from the company's incremental borrowing rate`}
                minValue={0}
                step={INPUT_STEP.percent}
                formatOptions={INPUT_FORMAT.percentPoints}
              />
              <Number
                name="fairValue"
                label={t`Fair Value`}
                minValue={0}
                step={moneyStep}
                formatOptions={moneyFormat}
              />
              <Number
                name="economicLifeMonths"
                label={t`Economic Life (months)`}
                minValue={1}
              />
              <Number
                name="purchaseOptionAmount"
                label={t`Purchase Option`}
                minValue={0}
                step={moneyStep}
                formatOptions={moneyFormat}
              />
              <Boolean
                name="purchaseOptionReasonablyCertain"
                label={t`Purchase option reasonably certain`}
              />
              <Boolean
                name="ownershipTransfers"
                label={t`Ownership transfers at the end of the term`}
              />
              <Boolean
                name="specializedAsset"
                label={t`Specialized asset with no alternative use`}
              />
            </Section>

            <div className="grid w-full grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
              <CustomFormFields table="lease" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter sticky>
          <Submit isDisabled={!permissions.can("create", "purchasing")}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default LeaseForm;
