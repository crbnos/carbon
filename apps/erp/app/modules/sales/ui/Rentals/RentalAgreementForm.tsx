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

type RentalAgreementFormValues = z.infer<typeof rentalAgreementValidator>;

type RentalAgreementFormProps = {
  initialValues: RentalAgreementFormValues;
  /** Terms are fixed once the agreement is activated: the billing periods and
   *  the lease classification were cut from them. */
  isLocked?: boolean;
  /** `?fixedAssetId=` from the fleet register's Rent action — the new route
   *  adds that unit as the first line. */
  fixedAssetId?: string;
};

const RentalAgreementForm = ({
  initialValues,
  isLocked = false,
  fixedAssetId
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
                helperText={t`Where the units are while on rent`}
                customer={customer.id}
                value={customer.customerLocationId}
              />
              <CustomerContact
                name="customerContactId"
                label={t`Customer Contact`}
                customer={customer.id}
                value={customer.customerContactId}
              />
              <Location
                name="locationId"
                label={t`Home Location`}
                helperText={t`The warehouse the units return to`}
              />
              <Employee name="salesPersonId" label={t`Sales Person`} />
              <PaymentTerm name="paymentTermId" label={t`Payment Terms`} />
              <DatePicker name="startDate" label={t`Start Date`} />
              <DatePicker
                name="endDate"
                label={t`End Date`}
                helperText={t`Leave empty for an open-ended agreement`}
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
                options={billingCycleOptions}
              />
              <Select
                name="billingTiming"
                label={t`Billing Timing`}
                options={billingTimingOptions}
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

            <div className="w-full border-t border-border pt-4">
              <p className="text-sm font-medium mb-1">
                <Trans>Lease classification inputs</Trans>
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                <Trans>
                  Used when the agreement is activated to classify each line as
                  an operating or sales-type lease.
                </Trans>
              </p>
              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                <Number
                  name="discountRate"
                  label={t`Discount Rate (%)`}
                  minValue={0}
                  step={INPUT_STEP.percent}
                  formatOptions={INPUT_FORMAT.percentPoints}
                />
                <Number
                  name="purchaseOptionAmount"
                  label={t`Purchase Option`}
                  minValue={0}
                  step={INPUT_STEP.money(currencyDecimals)}
                  formatOptions={INPUT_FORMAT.money(
                    currencyCode,
                    currencyDecimals
                  )}
                />
                <div />
                <Boolean
                  name="purchaseOptionReasonablyCertain"
                  label={t`Purchase option reasonably certain`}
                />
                <Boolean
                  name="ownershipTransfers"
                  label={t`Ownership transfers`}
                />
                <Boolean name="specializedAsset" label={t`Specialized asset`} />
              </div>
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
