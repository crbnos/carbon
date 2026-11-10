// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ChoiceCardGroup } from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCalendar,
  LuCalendarCheck,
  LuCalendarClock,
  LuCalendarDays,
  LuCalendarRange
} from "react-icons/lu";
import { NumberControlled } from "~/components/Form";
import { SetupSection, TermForm } from "~/components/Setup";
import { usePermissions } from "~/hooks";
import type {
  leasePaymentFrequencies,
  leasePaymentTimings
} from "../../purchasing.models";
import { type LeaseTerm, useLeaseTermSave } from "./LeaseSetupSteps";
import type { Lease } from "./types";
import { useLeaseFrequencyLabel } from "./useLeaseLabels";

type PaymentFrequency = (typeof leasePaymentFrequencies)[number];
type PaymentTiming = (typeof leasePaymentTimings)[number];

type LeasePaymentTermsProps = {
  lease: Lease;
};

/** How often the lease pays, and how the payments grow: the terms every
 *  asset's payment rows are cut from, at the asset's own payment. Every field
 *  saves on its own as it changes, and a change cuts the rows again. */
const LeasePaymentTerms = ({ lease }: LeasePaymentTermsProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const frequencyLabel = useLeaseFrequencyLabel();

  const id = lease.id!;
  const { save } = useLeaseTermSave(id);
  const isDisabled =
    lease.status !== "Draft" || !permissions.can("update", "purchasing");

  const onChange = (field: LeaseTerm, value: string | null) => {
    const current = lease[field];
    if ((current ?? null) === (value ?? null) || String(current) === value) {
      return;
    }
    save(field, value);
  };

  return (
    <SetupSection
      title={<Trans>Payment Terms</Trans>}
      description={
        <Trans>
          Each asset's payment rows below are cut from these terms at its own
          payment. Changing a term cuts them again.
        </Trans>
      }
    >
      <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
        <TermForm
          name="annualEscalationPercent"
          value={lease.annualEscalationPercent}
        >
          <NumberControlled
            name="annualEscalationPercent"
            label={t`Annual Escalation (%)`}
            helperText={t`Applied on each anniversary of the commencement date`}
            isReadOnly={isDisabled}
            value={lease.annualEscalationPercent ?? 0}
            minValue={0}
            step={INPUT_STEP.percent}
            formatOptions={INPUT_FORMAT.percentPoints}
            onChange={(value) =>
              onChange(
                "annualEscalationPercent",
                String(Number.isNaN(value) ? 0 : value)
              )
            }
          />
        </TermForm>
        <ChoiceCardGroup<PaymentFrequency>
          className="md:col-span-2"
          direction="row"
          label={t`Payment Frequency`}
          value={lease.paymentFrequency ?? "Monthly"}
          onChange={(value) => onChange("paymentFrequency", value)}
          options={[
            {
              value: "Monthly",
              title: frequencyLabel("Monthly"),
              description: t`One payment for each month of the term.`,
              icon: <LuCalendarDays />,
              disabled: isDisabled
            },
            {
              value: "Quarterly",
              title: frequencyLabel("Quarterly"),
              description: t`One payment for every three months.`,
              icon: <LuCalendarRange />,
              disabled: isDisabled
            },
            {
              value: "Annual",
              title: frequencyLabel("Annual"),
              description: t`One payment for each year of the term.`,
              icon: <LuCalendar />,
              disabled: isDisabled
            }
          ]}
        />
        <ChoiceCardGroup<PaymentTiming>
          className="md:col-span-2"
          direction="row"
          label={t`Payment Timing`}
          value={lease.paymentTiming ?? "Advance"}
          onChange={(value) => onChange("paymentTiming", value)}
          options={[
            {
              value: "Advance",
              title: t`Advance`,
              description: t`Each payment is due on the first day of its period.`,
              icon: <LuCalendarClock />,
              disabled: isDisabled
            },
            {
              value: "Arrears",
              title: t`Arrears`,
              description: t`Each payment is due on the last day of its period.`,
              icon: <LuCalendarCheck />,
              disabled: isDisabled
            }
          ]}
        />
      </div>
    </SetupSection>
  );
};

export default LeasePaymentTerms;
