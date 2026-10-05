// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DatePicker, Select, ValidatedForm } from "@carbon/form";
import {
  Button,
  Checkbox,
  ChoiceCardGroup,
  Switch,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  LuCalendarCheck,
  LuCalendarClock,
  LuChevronDown,
  LuChevronRight
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { z } from "zod";
import {
  Customer,
  CustomerContact,
  CustomerLocation,
  PaymentTerm
} from "~/components/Form";
import { useDateFormatter, usePermissions, useSettings } from "~/hooks";
import { path } from "~/utils/path";
import {
  contractBillingFrequencies,
  type contractBillingTimings,
  invoiceAutomations
} from "../../sales.models";
import { ContractSetupSection } from "./ContractSetupLayout";
import type { Contract } from "./types";
import { useContractLabels } from "./useContractLabels";

type BillingTiming = (typeof contractBillingTimings)[number];

type Term =
  | "invoiceCustomerId"
  | "invoiceCustomerContactId"
  | "invoiceCustomerLocationId"
  | "shipToCustomerLocationId"
  | "paymentTermId"
  | "billingFrequency"
  | "billingAlignment"
  | "billingTiming"
  | "firstInvoiceDate"
  | "billedThrough"
  | "recognizeRevenueFrom";

/** The Select's value for "no override": Radix refuses an empty item value. */
const COMPANY_DEFAULT = "default";

/** One field in its own form, so it validates and saves on its own. Keyed by
 *  its stored value: when a save changes it (or clears it, as a new bill-to
 *  clears the contact), the field shows what was stored. */
const TermForm = ({
  name,
  value,
  children
}: {
  name: string;
  value: unknown;
  children: ReactNode;
}) => (
  <ValidatedForm
    key={`${name}:${String(value ?? "")}`}
    defaultValues={{ [name]: value ?? "" }}
    validator={z.object({ [name]: z.any() })}
    className="w-full"
  >
    {children}
  </ValidatedForm>
);

/** Saves one term of a Draft through the properties route, which validates
 *  the terms as a whole; a refusal toasts. Returns `save` and a way to save
 *  several terms one after another (each read-modify-write must land before
 *  the next starts). */
export function useContractTermSave(contractId: string) {
  const fetcher = useFetcher<{ error: { message: string } | null }>();
  useEffect(() => {
    if (fetcher.data?.error) toast.error(fetcher.data.error.message);
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const submit = useCallback(
    (fields: Record<string, string>) => {
      const formData = new FormData();
      formData.append("id", contractId);
      for (const [key, value] of Object.entries(fields)) {
        formData.append(key, value);
      }
      return fetcher.submit(formData, {
        method: "post",
        action: path.to.contractUpdate
      });
    },
    [contractId]
  );

  const save = useCallback(
    (field: Term, value: string | null) =>
      submit({ field, value: value ?? "" }),
    [submit]
  );

  return { save, submit };
}

type ContractBillToProps = {
  contract: Contract;
  /** The first invoice the schedule plans — what an empty First Invoice
   *  means. */
  plannedFirstInvoice: string | null;
};

/** Who the invoices go to, and when they are drafted. Every field saves on
 *  its own as it changes; the invoice preview below follows. */
const ContractBillTo = ({
  contract,
  plannedFirstInvoice
}: ContractBillToProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const companySettings = useSettings();
  const labels = useContractLabels();
  const { formatDate } = useDateFormatter();

  const contractId = contract.id!;
  const { save, submit } = useContractTermSave(contractId);
  const isDisabled =
    contract.status !== "Draft" || !permissions.can("update", "sales");
  const billTo = contract.invoiceCustomerId ?? contract.customerId ?? "";

  const onChange = (field: Term, value: string | null) => {
    if ((contract[field as keyof Contract] ?? null) === (value ?? null)) return;
    save(field, value);
  };

  return (
    <>
      <ContractSetupSection
        title={<Trans>Bill To</Trans>}
        description={
          <Trans>Who receives the invoices, where, and on what terms.</Trans>
        }
      >
        <div className="grid w-full max-w-3xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          <TermForm name="invoiceCustomerId" value={contract.invoiceCustomerId}>
            <Customer
              name="invoiceCustomerId"
              label={t`Bill To`}
              helperText={t`Defaults to the customer`}
              isReadOnly={isDisabled}
              onChange={(option) =>
                onChange("invoiceCustomerId", option?.value ?? null)
              }
            />
          </TermForm>
          <TermForm
            name="invoiceCustomerContactId"
            value={contract.invoiceCustomerContactId}
          >
            <CustomerContact
              name="invoiceCustomerContactId"
              label={t`Invoice Contact`}
              helperText={t`Receives the invoice email`}
              customer={billTo}
              isReadOnly={isDisabled}
              onChange={(contact) =>
                onChange("invoiceCustomerContactId", contact?.id ?? null)
              }
            />
          </TermForm>
          <TermForm
            name="invoiceCustomerLocationId"
            value={contract.invoiceCustomerLocationId}
          >
            <CustomerLocation
              name="invoiceCustomerLocationId"
              label={t`Invoice Address`}
              customer={billTo}
              isReadOnly={isDisabled}
              onChange={(location) =>
                onChange("invoiceCustomerLocationId", location?.id ?? null)
              }
            />
          </TermForm>
          <TermForm
            name="shipToCustomerLocationId"
            value={contract.shipToCustomerLocationId}
          >
            <CustomerLocation
              name="shipToCustomerLocationId"
              label={t`Ship To`}
              helperText={t`Where the service is delivered`}
              customer={contract.customerId ?? ""}
              isReadOnly={isDisabled}
              onChange={(location) =>
                onChange("shipToCustomerLocationId", location?.id ?? null)
              }
            />
          </TermForm>
          <TermForm name="paymentTermId" value={contract.paymentTermId}>
            <PaymentTerm
              name="paymentTermId"
              label={t`Payment Terms`}
              isReadOnly={isDisabled}
              onChange={(term) =>
                onChange("paymentTermId", term?.value ?? null)
              }
            />
          </TermForm>
        </div>
      </ContractSetupSection>

      <ContractSetupSection
        title={<Trans>Schedule</Trans>}
        description={
          <Trans>
            How often the customer is invoiced, and from when. The invoices
            below follow.
          </Trans>
        }
      >
        <div className="grid w-full max-w-3xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          <TermForm name="billingFrequency" value={contract.billingFrequency}>
            <Select
              name="billingFrequency"
              label={t`Frequency`}
              isReadOnly={isDisabled}
              options={contractBillingFrequencies.map((value) => ({
                value,
                label: labels.billingFrequency[value]
              }))}
              onChange={(option) => {
                if (option?.value) onChange("billingFrequency", option.value);
              }}
            />
          </TermForm>
          <TermForm name="firstInvoiceDate" value={contract.firstInvoiceDate}>
            <DatePicker
              name="firstInvoiceDate"
              label={t`First Invoice`}
              isDisabled={isDisabled}
              helperText={
                !contract.firstInvoiceDate && plannedFirstInvoice
                  ? t`Planned for ${formatDate(plannedFirstInvoice)}`
                  : undefined
              }
              onChange={(date) => onChange("firstInvoiceDate", date)}
            />
          </TermForm>
          <ChoiceCardGroup<BillingTiming>
            className="md:col-span-2"
            label={t`Billing Timing`}
            value={contract.billingTiming ?? "Advance"}
            onChange={(value) => onChange("billingTiming", value)}
            options={[
              {
                value: "Advance",
                title: labels.billingTiming.Advance,
                description: t`Each period is invoiced on its first day, before the service is delivered.`,
                icon: <LuCalendarClock />,
                disabled: isDisabled
              },
              {
                value: "Arrears",
                title: labels.billingTiming.Arrears,
                description: t`Each period is invoiced on its last day, after the service is delivered.`,
                icon: <LuCalendarCheck />,
                disabled: isDisabled
              }
            ]}
          />
          <div className="flex items-start gap-3">
            <Checkbox
              id="billingAlignment"
              isChecked={contract.billingAlignment === "Calendar"}
              disabled={isDisabled}
              onCheckedChange={(checked) =>
                onChange(
                  "billingAlignment",
                  checked === true ? "Calendar" : "Anniversary"
                )
              }
            />
            <label htmlFor="billingAlignment" className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                <Trans>Align to calendar periods</Trans>
              </span>
              <span className="text-xs text-muted-foreground">
                <Trans>
                  Bill whole months, quarters or years, with a part period
                  first.
                </Trans>
              </span>
            </label>
          </div>
        </div>
      </ContractSetupSection>

      <ContractInvoicingAdvanced
        contract={contract}
        isDisabled={isDisabled}
        companyLabel={
          labels.invoiceAutomation[companySettings.invoiceAutomation]
        }
        onSave={onChange}
        onSubmit={submit}
      />
    </>
  );
};

/** Rarely touched: how drafted invoices are handled, and the date a
 *  contract moved from another system was billed through. */
const ContractInvoicingAdvanced = ({
  contract,
  isDisabled,
  companyLabel,
  onSave,
  onSubmit
}: {
  contract: Contract;
  isDisabled: boolean;
  companyLabel: string;
  onSave: (field: Term, value: string | null) => void;
  onSubmit: (fields: Record<string, string>) => Promise<void>;
}) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const labels = useContractLabels();
  const [isOpen, setIsOpen] = useState(
    !!contract.billedThrough || !!contract.invoiceAutomation
  );

  return (
    <section className="flex w-full flex-col gap-6 border-t border-border pt-8">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        leftIcon={isOpen ? <LuChevronDown /> : <LuChevronRight />}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Trans>Advanced</Trans>
      </Button>
      {isOpen && (
        <div className="grid w-full max-w-3xl grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          <TermForm
            name="invoiceAutomation"
            value={contract.invoiceAutomation ?? COMPANY_DEFAULT}
          >
            <Select
              name="invoiceAutomation"
              label={t`Invoicing`}
              helperText={t`What happens to an invoice once it is drafted`}
              isReadOnly={!permissions.can("update", "sales")}
              options={[
                {
                  value: COMPANY_DEFAULT,
                  label: t`Company default (${companyLabel})`
                },
                ...invoiceAutomations.map((mode) => ({
                  value: mode,
                  label: labels.invoiceAutomation[mode]
                }))
              ]}
              onChange={(option) => {
                const next =
                  !option?.value || option.value === COMPANY_DEFAULT
                    ? null
                    : option.value;
                if ((contract.invoiceAutomation ?? null) === next) return;
                onSubmit({ intent: "invoiceAutomation", value: next ?? "" });
              }}
            />
          </TermForm>
          <div className="md:col-span-2">
            <ContractMigrationSwitch
              contract={contract}
              field="billedThrough"
              isDisabled={isDisabled}
              onSave={onSave}
              onSubmit={onSubmit}
            />
          </div>
        </div>
      )}
    </section>
  );
};

/**
 * "Migrating from another system?" — on while either cut-over date is set.
 * On, it shows this step's date (Billed Through here, Recognize Revenue From
 * on the Revenue step); turned off, it clears both, one save after another.
 */
export const ContractMigrationSwitch = ({
  contract,
  field,
  isDisabled,
  onSave,
  onSubmit
}: {
  contract: Contract;
  field: "billedThrough" | "recognizeRevenueFrom";
  isDisabled: boolean;
  onSave: (field: Term, value: string | null) => void;
  onSubmit: (fields: Record<string, string>) => Promise<void>;
}) => {
  const { t } = useLingui();
  const isSet = !!contract.billedThrough || !!contract.recognizeRevenueFrom;
  const [isOn, setIsOn] = useState(isSet);
  useEffect(() => {
    if (isSet) setIsOn(true);
  }, [isSet]);

  const turnOff = async () => {
    setIsOn(false);
    if (contract.billedThrough) {
      await onSubmit({ field: "billedThrough", value: "" });
    }
    if (contract.recognizeRevenueFrom) {
      await onSubmit({ field: "recognizeRevenueFrom", value: "" });
    }
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <Switch
        variant="small"
        label={t`Migrating from another system?`}
        checked={isOn}
        disabled={isDisabled}
        onCheckedChange={(checked) => {
          if (checked) setIsOn(true);
          else turnOff();
        }}
      />
      {isOn && (
        <div className="max-w-sm">
          <TermForm name={field} value={contract[field]}>
            <DatePicker
              name={field}
              label={
                field === "billedThrough"
                  ? t`Billed Through`
                  : t`Recognize Revenue From`
              }
              helperText={
                field === "billedThrough"
                  ? t`Periods up to this date were invoiced in your previous system`
                  : t`Revenue before this month was recognized in your previous system`
              }
              isDisabled={isDisabled}
              onChange={(date) => onSave(field, date)}
            />
          </TermForm>
        </div>
      )}
    </div>
  );
};

/** The Revenue step's half of the migration switch: Recognize Revenue From. */
export const ContractRevenueMigration = ({
  contract
}: {
  contract: Contract;
}) => {
  const permissions = usePermissions();
  const { save, submit } = useContractTermSave(contract.id!);
  return (
    <div className="w-full border-t border-border pt-6">
      <ContractMigrationSwitch
        contract={contract}
        field="recognizeRevenueFrom"
        isDisabled={
          contract.status !== "Draft" || !permissions.can("update", "sales")
        }
        onSave={(field, value) => {
          if ((contract[field as keyof Contract] ?? null) === (value ?? null))
            return;
          save(field, value);
        }}
        onSubmit={submit}
      />
    </div>
  );
};

export default ContractBillTo;
