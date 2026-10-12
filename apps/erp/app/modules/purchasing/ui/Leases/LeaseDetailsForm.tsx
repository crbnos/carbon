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
  Input,
  Location,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation,
  TextArea
} from "~/components/Form";
import { SetupBody, SetupFooter, SetupSection } from "~/components/Setup";
import { usePermissions } from "~/hooks";
import { leaseValidator } from "../../purchasing.models";

type LeaseDetailsValues = z.infer<typeof leaseValidator>;

/** The terms a later setup step owns. Posted as they are, so saving the
 *  details never resets them (an edited Draft) — and on create they carry the
 *  defaults a new lease starts with. The three switches post only when on: an
 *  unchecked checkbox posts nothing. */
const CARRIED_TERMS = [
  "currencyCode",
  "paymentAmount",
  "paymentFrequency",
  "paymentTiming",
  "annualEscalationPercent",
  "discountRate",
  "fairValue",
  "economicLifeMonths",
  "purchaseOptionAmount"
] as const;

const CARRIED_SWITCHES = [
  "ownershipTransfers",
  "specializedAsset",
  "purchaseOptionReasonablyCertain"
] as const;

type LeaseDetailsFormProps = {
  initialValues: LeaseDetailsValues;
  /** Where the form posts: the new lease route, or the setup Details step of
   *  a Draft. */
  action: string;
};

/** Step 1 of setting up a lease: who it is with, what is leased, and when it
 *  runs. The payments and the accounting treatment are later steps; the
 *  owner and the custom fields are under More Details. */
const LeaseDetailsForm = ({ initialValues, action }: LeaseDetailsFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isEditing = !!initialValues.id;

  const [supplierId, setSupplierId] = useState(initialValues.supplierId);
  const [commencementDate, setCommencementDate] = useState(
    initialValues.commencementDate
  );

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
      {CARRIED_SWITCHES.map((term) =>
        initialValues[term] ? (
          <Hidden key={term} name={term} value="on" />
        ) : null
      )}

      <SetupBody>
        <SetupSection
          title={<Trans>Lessor</Trans>}
          description={
            <Trans>Who the company leases from, and who to call there.</Trans>
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
          </div>
        </SetupSection>

        <SetupSection
          title={<Trans>Leased Asset</Trans>}
          description={<Trans>What is leased and where it is used.</Trans>}
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <Input
              name="name"
              label={t`Name`}
              helperText={t`For example "Forklift FL-12" or "Plant 2 building"`}
            />
            <Location name="locationId" label={t`Location`} />
            <div className="md:col-span-2">
              <TextArea name="description" label={t`Description`} />
            </div>
          </div>
        </SetupSection>

        <SetupSection
          title={<Trans>Term</Trans>}
          description={
            <Trans>
              When the lease starts and ends. The end date is the last day of
              the term, including renewals that are reasonably certain.
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
            <DatePicker
              name="endDate"
              label={t`End Date`}
              minValue={
                commencementDate ? safeParseDate(commencementDate) : undefined
              }
            />
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

/** A typed date as a picker bound; a half-typed one bounds nothing. */
function safeParseDate(date: string) {
  try {
    return parseDate(date);
  } catch {
    return undefined;
  }
}

export default LeaseDetailsForm;
