// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ChoiceCardGroup } from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCalendarCheck,
  LuCalendarClock,
  LuCalendarDays,
  LuRepeat
} from "react-icons/lu";
import { NumberControlled, PaymentTerm, Select } from "~/components/Form";
import { SetupSection, TermForm } from "~/components/Setup";
import { useCurrencyDecimals, usePermissions, useSettings } from "~/hooks";
import {
  invoiceAutomations,
  type rentalBillingCycles,
  type rentalBillingTimings
} from "../../sales.models";
import { useRentalTermSave } from "./RentalSetupSteps";
import type { RentalAgreement } from "./types";

type BillingCycle = (typeof rentalBillingCycles)[number];
type BillingTiming = (typeof rentalBillingTimings)[number];

/** The Select's value for "no override": Radix refuses an empty item value. */
const COMPANY_DEFAULT = "default";

type RentalAgreementBillingProps = {
  rentalAgreement: RentalAgreement;
  /** The customer contact's email; null when there is none to send to. */
  contactEmail: string | null;
};

/** How the agreement bills: the period, when in it the invoice goes out,
 *  payment terms, deposit, tax and what happens to each invoice. Every
 *  field saves on its own as it changes. */
const RentalAgreementBilling = ({
  rentalAgreement,
  contactEmail
}: RentalAgreementBillingProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const companySettings = useSettings();

  const id = rentalAgreement.id!;
  const currencyCode = rentalAgreement.currencyCode ?? "";
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const { save, saveInvoiceAutomation } = useRentalTermSave(id);
  const isDisabled =
    rentalAgreement.status !== "Draft" || !permissions.can("update", "sales");

  const onChange = (
    field: Parameters<typeof save>[0],
    value: string | null
  ) => {
    const current = rentalAgreement[field];
    if ((current ?? null) === (value ?? null) || String(current) === value) {
      return;
    }
    save(field, value);
  };

  const invoiceAutomationLabels: Record<
    (typeof invoiceAutomations)[number],
    string
  > = {
    "Draft Only": t`Draft only`,
    Post: t`Post`,
    "Post and Email": t`Post and email`,
    "Post and Send via Stripe": t`Post and send via Stripe`
  };
  const companyLabel =
    invoiceAutomationLabels[companySettings.invoiceAutomation];

  return (
    <>
      <SetupSection
        title={<Trans>Billing Periods</Trans>}
        description={
          <Trans>
            How each unit's rent is cut into periods, and when in a period it is
            invoiced.
          </Trans>
        }
      >
        <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          <ChoiceCardGroup<BillingCycle>
            className="md:col-span-2"
            direction="row"
            label={t`Billing Cycle`}
            value={rentalAgreement.billingCycle ?? "Calendar Month"}
            onChange={(value) => onChange("billingCycle", value)}
            options={[
              {
                value: "Calendar Month",
                title: t`Calendar Month`,
                description: t`Each period is a calendar month, with a part month first.`,
                icon: <LuCalendarDays />,
                disabled: isDisabled
              },
              {
                value: "28 Days",
                title: t`28 Days`,
                description: t`Each period is 28 days from the start date.`,
                icon: <LuRepeat />,
                disabled: isDisabled
              }
            ]}
          />
          <ChoiceCardGroup<BillingTiming>
            className="md:col-span-2"
            direction="row"
            label={t`Billing Timing`}
            value={rentalAgreement.billingTiming ?? "Advance"}
            onChange={(value) => onChange("billingTiming", value)}
            options={[
              {
                value: "Advance",
                title: t`Advance`,
                description: t`Each period is invoiced on its first day, before the units are used.`,
                icon: <LuCalendarClock />,
                disabled: isDisabled
              },
              {
                value: "Arrears",
                title: t`Arrears`,
                description: t`Each period is invoiced on its last day, after the units are used.`,
                icon: <LuCalendarCheck />,
                disabled: isDisabled
              }
            ]}
          />
        </div>
      </SetupSection>

      <SetupSection
        title={<Trans>Terms</Trans>}
        description={
          <Trans>
            What the customer pays up front, the tax on rent, and when invoices
            are due.
          </Trans>
        }
      >
        <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          <TermForm name="paymentTermId" value={rentalAgreement.paymentTermId}>
            <PaymentTerm
              name="paymentTermId"
              label={t`Payment Terms`}
              isReadOnly={isDisabled}
              onChange={(term) =>
                onChange("paymentTermId", term?.value ?? null)
              }
            />
          </TermForm>
          <TermForm name="depositAmount" value={rentalAgreement.depositAmount}>
            <NumberControlled
              name="depositAmount"
              label={t`Deposit`}
              helperText={t`Paid up front; record it as a payment once received`}
              isReadOnly={isDisabled}
              value={rentalAgreement.depositAmount ?? 0}
              minValue={0}
              step={INPUT_STEP.money(currencyDecimals)}
              formatOptions={INPUT_FORMAT.money(currencyCode, currencyDecimals)}
              onChange={(value) =>
                onChange(
                  "depositAmount",
                  String(Number.isNaN(value) ? 0 : value)
                )
              }
            />
          </TermForm>
          <TermForm name="taxPercent" value={rentalAgreement.taxPercent}>
            <NumberControlled
              name="taxPercent"
              label={t`Tax Percent`}
              helperText={t`Charged on each rent invoice line`}
              isReadOnly={isDisabled}
              value={rentalAgreement.taxPercent ?? 0}
              minValue={0}
              maxValue={1}
              step={INPUT_STEP.percent}
              formatOptions={INPUT_FORMAT.percent}
              onChange={(value) =>
                onChange("taxPercent", String(Number.isNaN(value) ? 0 : value))
              }
            />
          </TermForm>
        </div>
      </SetupSection>

      <SetupSection
        title={<Trans>Invoicing</Trans>}
        description={
          <Trans>
            Invoices are created every day for whatever is due. This decides
            what happens to each one next.
          </Trans>
        }
      >
        <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          <TermForm
            name="invoiceAutomation"
            value={rentalAgreement.invoiceAutomation ?? COMPANY_DEFAULT}
          >
            <Select
              name="invoiceAutomation"
              label={t`Invoicing`}
              helperText={
                contactEmail
                  ? t`What happens to an invoice once it is created`
                  : t`Add a contact with an email to send invoices`
              }
              isReadOnly={!permissions.can("update", "sales")}
              options={[
                {
                  value: COMPANY_DEFAULT,
                  label: t`Company default (${companyLabel})`
                },
                ...invoiceAutomations
                  // Sending needs an email to send to.
                  .filter((mode) => mode !== "Post and Email" || !!contactEmail)
                  .map((mode) => ({
                    value: mode,
                    label: invoiceAutomationLabels[mode]
                  }))
              ]}
              onChange={(option) => {
                const next =
                  !option?.value || option.value === COMPANY_DEFAULT
                    ? null
                    : option.value;
                if ((rentalAgreement.invoiceAutomation ?? null) === next) {
                  return;
                }
                saveInvoiceAutomation(next);
              }}
            />
          </TermForm>
        </div>
      </SetupSection>
    </>
  );
};

export default RentalAgreementBilling;
