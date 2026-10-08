// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import { ChoiceCardGroup, toast } from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { LuCalendarRange, LuInfinity } from "react-icons/lu";
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
  Location,
  Submit,
  TextArea
} from "~/components/Form";
import { SetupBody, SetupFooter, SetupSection } from "~/components/Setup";
import { usePermissions } from "~/hooks";
import { rentalAgreementValidator } from "../../sales.models";

type RentalAgreementDetailsValues = z.infer<typeof rentalAgreementValidator>;

type TermType = "fixed" | "open";

/** The terms a later setup step owns. Posted as they are, so saving the
 *  details never resets them (an edited Draft) — and on create they carry the
 *  defaults a new agreement starts with. The three switches post only when
 *  on: an unchecked checkbox posts nothing. */
const CARRIED_TERMS = [
  "billingCycle",
  "billingTiming",
  "paymentTermId",
  "depositAmount",
  "taxPercent",
  "discountRate",
  "purchaseOptionAmount"
] as const;

const CARRIED_SWITCHES = [
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionReasonablyCertain"
] as const;

type RentalAgreementDetailsFormProps = {
  initialValues: RentalAgreementDetailsValues;
  /** Where the form posts: the new agreement route, or the setup Details
   *  step of a Draft. */
  action: string;
  /** `?fixedAssetId=` from the fleet register's Rent action — the new route
   *  adds that unit as the first line. */
  fixedAssetId?: string;
};

/** Step 1 of setting up a rental agreement: who it is with, where the units
 *  go, and when it runs. Billing and the accounting treatment are later
 *  steps; the people and the notes are under More Details. */
const RentalAgreementDetailsForm = ({
  initialValues,
  action,
  fixedAssetId
}: RentalAgreementDetailsFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();

  const isEditing = !!initialValues.id;

  const [customerId, setCustomerId] = useState(initialValues.customerId);
  const latestCustomerId = useRef(initialValues.customerId);
  const [customerLocationId, setCustomerLocationId] = useState(
    initialValues.customerLocationId
  );
  const [customerContactId, setCustomerContactId] = useState(
    initialValues.customerContactId
  );
  const [currencyCode, setCurrencyCode] = useState(initialValues.currencyCode);
  const [startDate, setStartDate] = useState(initialValues.startDate);
  const [endDate, setEndDate] = useState(initialValues.endDate);
  const [termType, setTermType] = useState<TermType>(
    initialValues.endDate ? "fixed" : "open"
  );
  // A fixed term needs its end date; without one it would save open-ended.
  const isMissingEndDate = termType === "fixed" && !endDate;

  // A new customer brings its own currency, sales contact and shipping
  // site; the old customer's would be wrong.
  const onCustomerChange = async (
    option: { value: string | undefined } | null
  ) => {
    const next = option?.value ?? "";
    setCustomerId(next);
    latestCustomerId.current = next;
    setCustomerLocationId(undefined);
    setCustomerContactId(undefined);
    if (!next || !carbon) return;

    const { data, error } = await carbon
      .from("customer")
      .select(
        "currencyCode, salesContactId, customerShipping!customerShipping_customerId_fkey(shippingCustomerLocationId)"
      )
      .eq("id", next)
      .single();
    // The customer was changed again while this read was in flight: its
    // answer is for a customer no longer picked.
    if (latestCustomerId.current !== next) return;
    if (error) {
      toast.error(t`Error fetching customer data`);
      return;
    }
    if (data.currencyCode) setCurrencyCode(data.currencyCode);
    setCustomerContactId(data.salesContactId ?? undefined);
    setCustomerLocationId(
      data.customerShipping?.[0]?.shippingCustomerLocationId ?? undefined
    );
  };

  return (
    <ValidatedForm
      method="post"
      action={action}
      validator={rentalAgreementValidator}
      defaultValues={initialValues}
      className="flex w-full flex-1 flex-col"
    >
      <Hidden name="id" />
      {fixedAssetId && <Hidden name="fixedAssetId" value={fixedAssetId} />}
      {CARRIED_TERMS.map((term) => (
        <Hidden key={term} name={term} />
      ))}
      {CARRIED_SWITCHES.map((term) =>
        initialValues[term] ? (
          <Hidden key={term} name={term} value="on" />
        ) : null
      )}

      <SetupBody>
        <SetupSection
          title={<Trans>Customer</Trans>}
          description={
            <Trans>Who rents the units, where they go, and who to call.</Trans>
          }
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <Customer
              autoFocus={!isEditing}
              name="customerId"
              label={t`Customer`}
              onChange={onCustomerChange}
            />
            <CustomerLocation
              name="customerLocationId"
              label={t`Rental Site`}
              helperText={t`Where the units are delivered`}
              customer={customerId}
              value={customerLocationId}
              onChange={(location) => setCustomerLocationId(location?.id)}
            />
            <CustomerContact
              name="customerContactId"
              label={t`Customer Contact`}
              helperText={t`Receives the invoice email`}
              customer={customerId}
              value={customerContactId}
              onChange={(contact) => setCustomerContactId(contact?.id)}
            />
            <Location
              name="locationId"
              label={t`Shipping Location`}
              helperText={t`Where the units ship from`}
            />
          </div>
        </SetupSection>

        <SetupSection
          title={<Trans>Term</Trans>}
          description={
            <Trans>When the rental starts, and whether it has an end.</Trans>
          }
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <ChoiceCardGroup<TermType>
              className="md:col-span-2"
              direction="row"
              label={t`Term`}
              value={termType}
              onChange={setTermType}
              options={[
                {
                  value: "open",
                  title: t`Open-ended`,
                  description: t`Bills each period until every unit is returned.`,
                  icon: <LuInfinity />
                },
                {
                  value: "fixed",
                  title: t`Fixed Term`,
                  description: t`Runs to an end date. A unit still out after it keeps billing.`,
                  icon: <LuCalendarRange />
                }
              ]}
            />
            <DatePicker
              name="startDate"
              label={t`Start Date`}
              helperText={t`Billing periods are cut from this date`}
              onChange={(date) => setStartDate(date ?? "")}
            />
            {termType === "fixed" && (
              <DatePicker
                name="endDate"
                label={t`End Date`}
                onChange={(date) => setEndDate(date ?? undefined)}
                minValue={
                  startDate
                    ? safeParseDate(startDate)?.add({ days: 1 })
                    : undefined
                }
              />
            )}
          </div>
        </SetupSection>

        <SetupSection
          title={<Trans>More Details</Trans>}
          description={
            <Trans>Who sold it, the currency it bills in, and any notes.</Trans>
          }
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <Employee name="salesPersonId" label={t`Sales Person`} />
            <Currency
              name="currencyCode"
              label={t`Currency`}
              value={currencyCode}
              onChange={(option) => {
                if (option?.value) setCurrencyCode(option.value);
              }}
            />
            <div className="md:col-span-2">
              <TextArea name="notes" label={t`Notes`} />
            </div>
            <CustomFormFields table="rentalAgreement" />
          </div>
        </SetupSection>
      </SetupBody>

      <SetupFooter
        actions={
          <Submit
            isDisabled={
              isMissingEndDate ||
              (isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales"))
            }
          >
            <Trans>Next</Trans>
          </Submit>
        }
      />
    </ValidatedForm>
  );
};

/** A typed date as a picker bound; a half-typed one bounds nothing. */
function safeParseDate(date: string) {
  try {
    return parseDate(date);
  } catch {
    return undefined;
  }
}

export default RentalAgreementDetailsForm;
