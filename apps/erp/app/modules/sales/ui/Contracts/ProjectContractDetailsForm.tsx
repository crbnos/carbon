// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { InputControlled, ValidatedForm } from "@carbon/form";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import type { z } from "zod";
import {
  Currency,
  Customer,
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Submit,
  TextArea
} from "~/components/Form";
import { SetupBody, SetupFooter, SetupSection } from "~/components/Setup";
import { useDateFormatter, usePermissions, useUser } from "~/hooks";
import { useCustomers } from "~/stores";
import {
  customerContractValidator,
  projectContractTermDefaults
} from "../../sales.models";
import ContractProject from "./ContractProject";

type ProjectContractDetailsValues = z.infer<typeof customerContractValidator>;

/** The terms a later setup step owns. Posted as they are, so saving the
 *  details never resets them (an edited Draft) — and on create they carry the
 *  defaults a new contract starts with. A project contract's billing
 *  alignment, timing and renewal are fixed by its basis, so they are not
 *  carried: they are posted as the basis sets them. */
const CARRIED_TERMS = [
  "invoiceCustomerId",
  "invoiceCustomerContactId",
  "invoiceCustomerLocationId",
  "shipToCustomerLocationId",
  "billingFrequency",
  "firstInvoiceDate",
  "billedThrough",
  "recognizeRevenueFrom",
  "invoiceAutomation",
  "paymentTermId"
] as const;

type ProjectContractDetailsFormProps = {
  initialValues: ProjectContractDetailsValues;
  /** Where the form posts: the new contract route, or the setup Details step
   *  of a Draft. */
  action: string;
};

/** Step 1 of setting up a project contract: who it is with, the project it
 *  bills, and its period of performance. It has no duration or renewal: it
 *  runs from its start date to its end date and bills project cost. */
const ProjectContractDetailsForm = ({
  initialValues,
  action
}: ProjectContractDetailsFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [customers] = useCustomers();
  const { formatDate } = useDateFormatter();

  const isEditing = !!initialValues.id;
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const [customerId, setCustomerId] = useState(initialValues.customerId);
  const latestCustomerId = useRef(initialValues.customerId);
  const [name, setName] = useState(initialValues.name);
  // A name the user typed is never replaced; an empty one follows the
  // customer and the start month.
  const [isNameTyped, setIsNameTyped] = useState(!!initialValues.name);
  const [startDate, setStartDate] = useState(initialValues.startDate);
  const [currencyCode, setCurrencyCode] = useState(initialValues.currencyCode);

  const suggestedName = (customer: string, start: string) => {
    const customerName = customers.find((c) => c.id === customer)?.name;
    if (!customerName) return "";
    const month = start
      ? formatDate(start, { month: "short", year: "numeric" })
      : "";
    return month ? `${customerName} — ${month}` : customerName;
  };

  const onCustomerChange = async (
    option: { value: string | undefined } | null
  ) => {
    const next = option?.value ?? "";
    setCustomerId(next);
    latestCustomerId.current = next;
    if (!isNameTyped) setName(suggestedName(next, startDate));
    if (!next || !carbon) return;

    const customer = await carbon
      .from("customer")
      .select("currencyCode")
      .eq("id", next)
      .single();
    // The customer was changed again while this read was in flight: its
    // answer is for a customer no longer picked.
    if (latestCustomerId.current !== next) return;
    if (customer.data?.currencyCode) {
      setCurrencyCode(customer.data.currencyCode);
    }
  };

  const onStartDateChange = (date: string | null) => {
    setStartDate(date ?? "");
    if (!isNameTyped) setName(suggestedName(customerId, date ?? ""));
  };

  const showsCurrencyUpFront = currencyCode !== baseCurrency;

  const currencyField = (
    <Currency
      name="currencyCode"
      label={t`Currency`}
      value={currencyCode}
      onChange={(option) => {
        if (option?.value) setCurrencyCode(option.value);
      }}
    />
  );

  return (
    <ValidatedForm
      method="post"
      action={action}
      validator={customerContractValidator}
      defaultValues={initialValues}
      className="flex w-full flex-1 flex-col"
    >
      <Hidden name="id" />
      <Hidden name="billingBasis" value="Project" />
      {CARRIED_TERMS.map((term) => (
        <Hidden key={term} name={term} />
      ))}
      <Hidden
        name="billingAlignment"
        value={projectContractTermDefaults.billingAlignment}
      />
      <Hidden
        name="billingTiming"
        value={projectContractTermDefaults.billingTiming}
      />
      <Hidden name="renewal" value={projectContractTermDefaults.renewal} />
      {/* A project contract never renews. */}
      <Hidden name="renewalUplift" value="0" />

      <SetupBody>
        <SetupSection
          title={<Trans>Customer</Trans>}
          description={
            <Trans>
              Who the contract is with, what it is called, and the project it
              bills.
            </Trans>
          }
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <Customer
              autoFocus={!isEditing}
              name="customerId"
              label={t`Customer`}
              onChange={onCustomerChange}
            />
            <ContractProject
              name="projectId"
              label={t`Project`}
              termId="project-contract"
              isRequired
            />
            <InputControlled
              name="name"
              label={t`Name`}
              value={name}
              onChange={(value) => {
                setName(value);
                setIsNameTyped(value.length > 0);
              }}
            />
            <Input name="customerReference" label={t`Contract Number`} />
            {showsCurrencyUpFront && currencyField}
          </div>
        </SetupSection>

        <SetupSection
          title={<Trans>Period of Performance</Trans>}
          description={
            <Trans>When the work under the contract starts and ends.</Trans>
          }
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <DatePicker
              name="startDate"
              label={t`Start Date`}
              onChange={onStartDateChange}
            />
            <DatePicker
              name="endDate"
              label={t`End Date`}
              minValue={startDate ? safeParseDate(startDate) : undefined}
            />
          </div>
        </SetupSection>

        <SetupSection
          title={<Trans>More Details</Trans>}
          description={<Trans>Who sold it, and when it closed.</Trans>}
        >
          <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <Employee name="salesPersonId" label={t`Sales Person`} />
            <DatePicker
              name="closeDate"
              label={t`Contract Close Date`}
              termId="contract-close-date"
            />
            {!showsCurrencyUpFront && currencyField}
            <div className="md:col-span-2">
              <TextArea name="notes" label={t`Notes`} />
            </div>
            <CustomFormFields table="customerContract" />
          </div>
        </SetupSection>
      </SetupBody>

      <SetupFooter
        actions={
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales")
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

export default ProjectContractDetailsForm;
