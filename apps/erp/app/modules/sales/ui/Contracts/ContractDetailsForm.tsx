// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { InputControlled, SelectControlled, ValidatedForm } from "@carbon/form";
import { ChoiceCardGroup } from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP, suggestContractType } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { LuCircleStop, LuRefreshCw } from "react-icons/lu";
import type { z } from "zod";
import {
  Currency,
  Customer,
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Number,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { useDateFormatter, usePermissions, useUser } from "~/hooks";
import { useCustomers } from "~/stores";
import {
  type ContractDuration,
  contractDurations,
  contractEndDate,
  type contractRenewals,
  customerContractTypes,
  customerContractValidator
} from "../../sales.models";
import ContractProject from "./ContractProject";
import {
  ContractSetupBody,
  ContractSetupFooter,
  ContractSetupSection
} from "./ContractSetupLayout";
import type { ContractType } from "./types";
import { useContractLabels } from "./useContractLabels";

type ContractRenewal = (typeof contractRenewals)[number];

type ContractDetailsValues = z.infer<typeof customerContractValidator>;

/** The terms a later setup step owns. Posted as they are, so saving the
 *  details never resets them (an edited Draft) — and on create they carry the
 *  defaults a new contract starts with. */
const CARRIED_TERMS = [
  "invoiceCustomerId",
  "invoiceCustomerContactId",
  "invoiceCustomerLocationId",
  "shipToCustomerLocationId",
  "billingFrequency",
  "billingAlignment",
  "billingTiming",
  "firstInvoiceDate",
  "billedThrough",
  "recognizeRevenueFrom",
  "invoiceAutomation",
  "paymentTermId"
] as const;

type ContractDetailsFormProps = {
  initialValues: ContractDetailsValues;
  /** Where the form posts: the new contract route, or the setup Details step
   *  of a Draft. */
  action: string;
};

/** Step 1 of setting up a contract: who it is with, what it is called, when
 *  it runs and what happens at the end. Everything else — invoicing, the
 *  people and the project — is pre-filled or tucked under More details. */
const ContractDetailsForm = ({
  initialValues,
  action
}: ContractDetailsFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [customers] = useCustomers();
  const { formatDate } = useDateFormatter();
  const labels = useContractLabels();

  const isEditing = !!initialValues.id;
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const [customerId, setCustomerId] = useState(initialValues.customerId);
  const latestCustomerId = useRef(initialValues.customerId);
  const [name, setName] = useState(initialValues.name);
  // A name the user typed is never replaced; an empty one follows the
  // customer and the start month.
  const [isNameTyped, setIsNameTyped] = useState(!!initialValues.name);
  const [startDate, setStartDate] = useState(initialValues.startDate);
  const [duration, setDuration] = useState<ContractDuration>(
    initialValues.duration
  );
  const [renewal, setRenewal] = useState<ContractRenewal>(
    initialValues.renewal
  );
  const [contractType, setContractType] = useState<ContractType>(
    initialValues.contractType ?? "New Sales"
  );
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

    // The customer's currency and its contract history (the type a new
    // contract with it is suggested as).
    const [customer, previous] = await Promise.all([
      carbon.from("customer").select("currencyCode").eq("id", next).single(),
      carbon.from("customerContract").select("status").eq("customerId", next)
    ]);
    // The customer was changed again while this read was in flight: its
    // answer is for a customer no longer picked.
    if (latestCustomerId.current !== next) return;
    if (customer.data?.currencyCode) {
      setCurrencyCode(customer.data.currencyCode);
    }
    if (previous.data) {
      setContractType(suggestContractType(previous.data));
    }
  };

  const onStartDateChange = (date: string | null) => {
    setStartDate(date ?? "");
    if (!isNameTyped) setName(suggestedName(customerId, date ?? ""));
  };

  const derivedEnd =
    startDate && duration !== "custom" && duration !== "open"
      ? contractEndDate(startDate, duration).endDate
      : null;
  const isOpenEnded = duration === "open";
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
      defaultValues={{
        ...initialValues,
        contractType: initialValues.contractType ?? "New Sales"
      }}
      className="flex w-full flex-1 flex-col"
    >
      <Hidden name="id" />
      {CARRIED_TERMS.map((term) => (
        <Hidden key={term} name={term} />
      ))}
      <Hidden name="renewal" value={renewal} />
      {/* Not asked unless the contract renews. */}
      {(isOpenEnded || renewal !== "Renew") && (
        <Hidden name="renewalUplift" value="0" />
      )}

      <ContractSetupBody>
        <ContractSetupSection
          title={<Trans>Customer</Trans>}
          description={
            <Trans>Who the contract is with and what it is called.</Trans>
          }
        >
          <div className="grid w-full max-w-3xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <Customer
              autoFocus={!isEditing}
              name="customerId"
              label={t`Customer`}
              onChange={onCustomerChange}
            />
            <SelectControlled
              name="contractType"
              label={t`Contract Type`}
              value={contractType}
              options={customerContractTypes.map((type) => ({
                value: type,
                label: labels.contractType[type]
              }))}
              onChange={(option) => {
                const next = customerContractTypes.find(
                  (type) => type === option?.value
                );
                if (next) setContractType(next);
              }}
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
            <Input name="customerReference" label={t`PO Number`} />
            {showsCurrencyUpFront && currencyField}
          </div>
        </ContractSetupSection>

        <ContractSetupSection
          title={<Trans>Term</Trans>}
          description={
            <Trans>
              When the contract runs and what happens when it completes.
            </Trans>
          }
        >
          <div className="grid w-full max-w-3xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <DatePicker
              name="startDate"
              label={t`Start Date`}
              onChange={onStartDateChange}
            />
            <div className="flex flex-col gap-2">
              <Select
                name="duration"
                label={t`Duration`}
                options={contractDurations.map((value) => ({
                  value,
                  label: labels.duration[value]
                }))}
                onChange={(option) => {
                  const next = contractDurations.find(
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
              {isOpenEnded && (
                <p className="text-xs text-muted-foreground">
                  <Trans>Bills until it is cancelled</Trans>
                </p>
              )}
            </div>
            {duration === "custom" && (
              <DatePicker
                name="endDate"
                label={t`End Date`}
                minValue={startDate ? safeParseDate(startDate) : undefined}
              />
            )}
          </div>

          {!isOpenEnded && (
            <div className="grid w-full max-w-3xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
              <ChoiceCardGroup<ContractRenewal>
                className="md:col-span-2"
                label={t`Action on Completion`}
                value={renewal}
                onChange={setRenewal}
                options={[
                  {
                    value: "End",
                    title: labels.renewal.End,
                    description: t`The contract ends on its end date and invoicing stops.`,
                    icon: <LuCircleStop />
                  },
                  {
                    value: "Renew",
                    title: labels.renewal.Renew,
                    description: t`A new term of the same length starts when this one ends.`,
                    icon: <LuRefreshCw />
                  }
                ]}
              />
              {renewal === "Renew" && (
                <Number
                  name="renewalUplift"
                  label={t`Renewal Uplift (%)`}
                  helperText={t`Prices rise by this much at each renewal`}
                  minValue={0}
                  step={INPUT_STEP.percent}
                  formatOptions={INPUT_FORMAT.percentPoints}
                />
              )}
            </div>
          )}
        </ContractSetupSection>

        <ContractSetupSection
          title={<Trans>More Details</Trans>}
          description={
            <Trans>Who sold it, what it belongs to, and when it closed.</Trans>
          }
        >
          <div className="grid w-full max-w-3xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <Employee name="salesPersonId" label={t`Sales Person`} />
            <ContractProject name="projectId" label={t`Project`} />
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
        </ContractSetupSection>
      </ContractSetupBody>

      <ContractSetupFooter
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

export default ContractDetailsForm;
