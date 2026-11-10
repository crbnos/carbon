// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Location,
  Select,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation,
  TextArea
} from "~/components/Form";
import { SetupBody, SetupFooter, SetupSection } from "~/components/Setup";
import { useDateFormatter, usePermissions } from "~/hooks";
import {
  type LeaseDuration,
  leaseDurations,
  leaseEndDate,
  leaseValidator
} from "../../purchasing.models";

type LeaseDetailsValues = z.infer<typeof leaseValidator>;

/** The terms a later setup step owns. Posted as they are, so saving the
 *  details never resets them (an edited Draft) — and on create they carry the
 *  defaults a new lease starts with. */
const CARRIED_TERMS = [
  // Not asked here: a lease is known by its number and its supplier. A name
  // set elsewhere is kept.
  "name",
  "currencyCode",
  "paymentFrequency",
  "paymentTiming",
  "annualEscalationPercent",
  "discountRate"
] as const;

type LeaseDetailsFormProps = {
  initialValues: LeaseDetailsValues;
  /** Where the form posts: the new lease route, or the setup Details step of
   *  a Draft. */
  action: string;
};

/** Step 1 of setting up a lease: who it is with, where the assets are used,
 *  and how long it runs (the AR contract's Duration). The assets, the
 *  payments and the accounting treatment are later steps; the owner, notes
 *  and custom fields are under More Details. */
const LeaseDetailsForm = ({ initialValues, action }: LeaseDetailsFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isEditing = !!initialValues.id;

  const [supplierId, setSupplierId] = useState(initialValues.supplierId);
  const [commencementDate, setCommencementDate] = useState(
    initialValues.commencementDate
  );
  const [duration, setDuration] = useState<LeaseDuration>(
    initialValues.duration ?? "36"
  );
  const { formatDate } = useDateFormatter();
  const durationLabels = useLeaseDurationLabels();
  const derivedEnd =
    commencementDate && duration !== "custom" && duration !== "open"
      ? safeLeaseEndDate(commencementDate, duration)
      : null;

  return (
    <ValidatedForm
      method="post"
      action={action}
      validator={leaseValidator}
      defaultValues={initialValues}
      className="flex w-full flex-1 flex-col"
    >
      <Hidden name="id" />
      {CARRIED_TERMS.map((term) => (
        <Hidden key={term} name={term} />
      ))}

      <SetupBody>
        <SetupSection
          title={<Trans>Lessor</Trans>}
          description={
            <Trans>
              Who the company leases from, who to call there, and where the
              assets are used.
            </Trans>
          }
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <Supplier
              autoFocus={!isEditing}
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
            <Location
              name="locationId"
              label={t`Location`}
              helperText={t`Where the assets are used. An asset can have its own.`}
            />
          </div>
        </SetupSection>

        <SetupSection
          title={<Trans>Term</Trans>}
          description={
            <Trans>
              When the lease starts and how long it runs, including renewals
              that are reasonably certain.
            </Trans>
          }
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <DatePicker
              name="commencementDate"
              label={t`Commencement Date`}
              helperText={t`Payment rows are cut from this date`}
              onChange={(date) => setCommencementDate(date ?? "")}
            />
            <div className="flex flex-col gap-2">
              <Select
                name="duration"
                label={t`Duration`}
                isOptional={false}
                options={leaseDurations.map((value) => ({
                  value,
                  label: durationLabels[value]
                }))}
                onChange={(option) => {
                  const next = leaseDurations.find(
                    (value) => value === option?.value
                  );
                  if (next) setDuration(next);
                }}
              />
              {derivedEnd && (
                <p className="text-xs text-muted-foreground">
                  <Trans>Ends {formatDate(derivedEnd)}</Trans>
                </p>
              )}
              {duration === "open" && (
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Runs until it is ended on notice. Every asset is short-term:
                    nothing goes on the balance sheet.
                  </Trans>
                </p>
              )}
            </div>
            {duration === "custom" && (
              <DatePicker
                name="endDate"
                label={t`End Date`}
                minValue={
                  commencementDate ? safeParseDate(commencementDate) : undefined
                }
              />
            )}
            <DatePicker
              name="noticeDate"
              label={t`Notice Date`}
              helperText={t`The last day to give renewal or termination notice`}
            />
            <DatePicker
              name="invoiceFromDate"
              label={t`Invoice From`}
              helperText={t`Payments due before this date were paid outside Carbon`}
            />
          </div>
        </SetupSection>

        <SetupSection
          title={<Trans>More Details</Trans>}
          description={
            <Trans>
              Who owns the lease here: they get the invoice digest and the date
              reminders.
            </Trans>
          }
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <Employee name="assignee" label={t`Owner`} />
            <div className="md:col-span-2">
              <TextArea name="description" label={t`Notes`} />
            </div>
            <CustomFormFields table="lease" />
          </div>
        </SetupSection>
      </SetupBody>

      <SetupFooter
        actions={
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "purchasing")
                : !permissions.can("create", "purchasing")
            }
          >
            <Trans>Next</Trans>
          </Submit>
        }
      />
    </ValidatedForm>
  );
};

/** The end a preset duration gives; a half-typed commencement gives none. */
function safeLeaseEndDate(commencementDate: string, duration: LeaseDuration) {
  try {
    return leaseEndDate(commencementDate, duration);
  } catch {
    return null;
  }
}

/** A lease duration's name on screen. */
export function useLeaseDurationLabels(): Record<LeaseDuration, string> {
  const { t } = useLingui();
  return {
    "12": t`1 year`,
    "24": t`2 years`,
    "36": t`3 years`,
    "48": t`4 years`,
    "60": t`5 years`,
    open: t`Open-ended`,
    custom: t`Custom`
  };
}

/** A typed date as a picker bound; a half-typed one bounds nothing. */
function safeParseDate(date: string) {
  try {
    return parseDate(date);
  } catch {
    return undefined;
  }
}

export default LeaseDetailsForm;
