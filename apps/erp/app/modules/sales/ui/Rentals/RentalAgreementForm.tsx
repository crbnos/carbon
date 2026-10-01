// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
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
  Boolean,
  Currency,
  Customer,
  CustomerContact,
  CustomerLocation,
  DatePicker,
  Employee,
  Hidden,
  Location,
  Number,
  PaymentTerm,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  rentalAgreementValidator,
  rentalBillingCycles,
  rentalBillingTimings
} from "../../sales.models";
import type { LeasePolicy } from "../../sales.utils";
import {
  LeaseClassificationPreview,
  type LeaseTermsDraft
} from "./RentalLeaseClassification";
import type { RentalAgreementLine, RentalLeaseLineInputs } from "./types";

type RentalAgreementFormValues = z.infer<typeof rentalAgreementValidator>;

type RentalAgreementFormProps = {
  initialValues: RentalAgreementFormValues;
  /** Terms are fixed once the agreement is activated: the billing periods and
   *  the lease classification were cut from them. */
  isLocked?: boolean;
  /** `?fixedAssetId=` from the fleet register's Rent action — the new route
   *  adds that unit as the first line. */
  fixedAssetId?: string;
  /** Classification thresholds, for the live lease classification preview. */
  leasePolicy: LeasePolicy;
  /** The agreement's units, so the preview can run the per-unit tests. */
  lines?: RentalAgreementLine[];
  leaseInputs?: Record<string, RentalLeaseLineInputs>;
};

const RentalAgreementForm = ({
  initialValues,
  isLocked = false,
  fixedAssetId,
  leasePolicy,
  lines,
  leaseInputs
}: RentalAgreementFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const isEditing = initialValues.id !== undefined;

  const [customer, setCustomer] = useState<{
    id: string | undefined;
    currencyCode: string | undefined;
    customerContactId: string | undefined;
    customerLocationId: string | undefined;
  }>({
    id: initialValues.customerId || undefined,
    currencyCode: initialValues.currencyCode,
    customerContactId: initialValues.customerContactId,
    customerLocationId: initialValues.customerLocationId
  });
  const currencyCode = customer.currencyCode ?? initialValues.currencyCode;
  // The unsaved terms that decide the lease classification, for the live
  // preview and for which inputs show.
  const [terms, setTerms] = useState<LeaseTermsDraft>({
    startDate: initialValues.startDate,
    endDate: initialValues.endDate ?? null,
    billingCycle: initialValues.billingCycle,
    billingTiming: initialValues.billingTiming,
    discountRate: initialValues.discountRate,
    ownershipTransfers: initialValues.ownershipTransfers,
    specializedAsset: initialValues.specializedAsset,
    purchaseOptionAmount: initialValues.purchaseOptionAmount ?? null,
    purchaseOptionReasonablyCertain:
      initialValues.purchaseOptionReasonablyCertain
  });
  const setTerm = <K extends keyof LeaseTermsDraft>(
    key: K,
    value: LeaseTermsDraft[K]
  ) => setTerms((prev) => ({ ...prev, [key]: value }));
  // An agreement with no end date is always an Operating lease, so the
  // classification inputs only show once there is one; the reasonably-certain
  // switch only means something once there is a purchase option to exercise.
  const hasEndDate = !!terms.endDate;
  const hasPurchaseOption = (terms.purchaseOptionAmount ?? 0) > 0;
  const currencyDecimals = useCurrencyDecimals(currencyCode);

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
        customerContactId: undefined,
        customerLocationId: undefined
      });
      return;
    }

    flushSync(() => {
      setCustomer({
        id: newValue.value,
        currencyCode: undefined,
        customerContactId: undefined,
        customerLocationId: undefined
      });
    });

    const { data, error } = await carbon
      .from("customer")
      .select(
        "currencyCode, salesContactId, customerShipping!customerShipping_customerId_fkey(shippingCustomerLocationId)"
      )
      .eq("id", newValue.value)
      .single();
    if (error) {
      toast.error(t`Error fetching customer data`);
      return;
    }
    setCustomer((prev) => ({
      ...prev,
      currencyCode: data.currencyCode ?? undefined,
      customerContactId: data.salesContactId ?? undefined,
      customerLocationId:
        data.customerShipping?.[0]?.shippingCustomerLocationId ?? undefined
    }));
  };

  const billingCycleOptions = rentalBillingCycles.map((cycle) => ({
    value: cycle,
    label: cycle === "Calendar Month" ? t`Calendar Month` : t`28 Days`
  }));
  const billingTimingOptions = rentalBillingTimings.map((timing) => ({
    value: timing,
    label: timing === "Advance" ? t`Advance` : t`Arrears`
  }));

  const canSave = isEditing
    ? permissions.can("update", "sales")
    : permissions.can("create", "sales");

  return (
    <Card>
      <ValidatedForm
        method="post"
        action={
          isEditing
            ? path.to.rentalAgreementDetails(initialValues.id!)
            : undefined
        }
        validator={rentalAgreementValidator}
        defaultValues={initialValues}
        isDisabled={isLocked}
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? (
              <Trans>Terms</Trans>
            ) : (
              <Trans>New Rental Agreement</Trans>
            )}
          </CardTitle>
          {isEditing && isLocked ? (
            <CardDescription>
              <Trans>
                The terms are fixed once the agreement is activated.
              </Trans>
            </CardDescription>
          ) : !isEditing ? (
            <CardDescription>
              <Trans>
                A rental agreement puts serialized fleet units at a customer and
                bills them on a recurring cycle until they come back.
              </Trans>
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          {isEditing && <Hidden name="rentalAgreementId" />}
          {fixedAssetId && <Hidden name="fixedAssetId" value={fixedAssetId} />}
          <VStack spacing={4}>
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label={t`Customer`}
                onChange={onCustomerChange}
              />
              <CustomerLocation
                name="customerLocationId"
                label={t`Rental Site`}
                customer={customer.id}
                value={customer.customerLocationId}
              />
              <CustomerContact
                name="customerContactId"
                label={t`Customer Contact`}
                customer={customer.id}
                value={customer.customerContactId}
              />
              <Location name="locationId" label={t`Shipping Location`} />
              <Employee name="salesPersonId" label={t`Sales Person`} />
              <PaymentTerm name="paymentTermId" label={t`Payment Terms`} />
              <DatePicker
                name="startDate"
                label={t`Start Date`}
                onChange={(date) => setTerm("startDate", date ?? "")}
              />
              <DatePicker
                name="endDate"
                label={t`End Date`}
                minValue={
                  terms.startDate
                    ? parseDate(terms.startDate).add({ days: 1 })
                    : undefined
                }
                onChange={(date) => setTerm("endDate", date || null)}
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
              <Select
                name="billingCycle"
                label={t`Billing Cycle`}
                termId="billing-cycle"
                options={billingCycleOptions}
                onChange={(option) =>
                  option &&
                  setTerm(
                    "billingCycle",
                    option.value as LeaseTermsDraft["billingCycle"]
                  )
                }
              />
              <Select
                name="billingTiming"
                label={t`Billing Timing`}
                termId="billing-timing"
                options={billingTimingOptions}
                onChange={(option) =>
                  option &&
                  setTerm(
                    "billingTiming",
                    option.value as LeaseTermsDraft["billingTiming"]
                  )
                }
              />
              <Number
                name="depositAmount"
                label={t`Deposit`}
                minValue={0}
                step={INPUT_STEP.money(currencyDecimals)}
                formatOptions={INPUT_FORMAT.money(
                  currencyCode,
                  currencyDecimals
                )}
              />
              <Number
                name="taxPercent"
                label={t`Tax Percent`}
                minValue={0}
                maxValue={1}
                step={INPUT_STEP.percent}
                formatOptions={INPUT_FORMAT.percent}
              />
            </div>

            <div className="w-full border-t border-border pt-4 flex flex-col gap-4">
              <div>
                <p className="text-sm font-medium mb-1">
                  <Trans>Accounting treatment</Trans>
                </p>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Whether each unit is treated as a rental or a sale is
                    decided when the agreement is activated.
                  </Trans>
                </p>
              </div>
              {!isLocked && (
                <LeaseClassificationPreview
                  terms={{
                    ...terms,
                    purchaseOptionReasonablyCertain:
                      hasPurchaseOption && terms.purchaseOptionReasonablyCertain
                  }}
                  lines={lines}
                  leaseInputs={leaseInputs}
                  policy={leasePolicy}
                />
              )}
              {hasEndDate ? (
                <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                  <Number
                    name="discountRate"
                    label={t`Discount Rate (%)`}
                    onChange={(value) => setTerm("discountRate", value)}
                    minValue={0}
                    step={INPUT_STEP.percent}
                    formatOptions={INPUT_FORMAT.percentPoints}
                  />
                  <Number
                    name="purchaseOptionAmount"
                    label={t`Purchase Option`}
                    onChange={(value) =>
                      // An emptied input commits NaN; NaN > 0 is false.
                      setTerm("purchaseOptionAmount", value > 0 ? value : null)
                    }
                    minValue={0}
                    step={INPUT_STEP.money(currencyDecimals)}
                    formatOptions={INPUT_FORMAT.money(
                      currencyCode,
                      currencyDecimals
                    )}
                  />
                  <div className="col-span-full flex flex-col gap-4">
                    {hasPurchaseOption && (
                      <Boolean
                        name="purchaseOptionReasonablyCertain"
                        label={t`Purchase option reasonably certain`}
                        description={t`The customer is expected to buy the unit at the end of the term.`}
                        onChange={(value) =>
                          setTerm("purchaseOptionReasonablyCertain", value)
                        }
                        bordered
                      />
                    )}
                    <Boolean
                      name="ownershipTransfers"
                      label={t`Ownership transfers`}
                      description={t`Title passes to the customer when the term ends.`}
                      onChange={(value) => setTerm("ownershipTransfers", value)}
                      bordered
                    />
                    <Boolean
                      name="specializedAsset"
                      label={t`Specialized asset`}
                      description={t`The unit has no other use to you once the term ends.`}
                      onChange={(value) => setTerm("specializedAsset", value)}
                      bordered
                    />
                  </div>
                </div>
              ) : (
                // Hidden, but kept: removing the end date and saving must not
                // wipe the inputs, so they come back if an end date is added.
                <>
                  <Hidden name="discountRate" />
                  <Hidden name="purchaseOptionAmount" />
                  {terms.ownershipTransfers && (
                    <Hidden name="ownershipTransfers" value="on" />
                  )}
                  {terms.specializedAsset && (
                    <Hidden name="specializedAsset" value="on" />
                  )}
                </>
              )}
            </div>

            <TextArea name="notes" label={t`Notes`} />
          </VStack>
        </CardContent>
        {!isLocked && (
          <CardFooter>
            <Submit isDisabled={!canSave}>
              <Trans>Save</Trans>
            </Submit>
          </CardFooter>
        )}
      </ValidatedForm>
    </Card>
  );
};

export default RentalAgreementForm;
