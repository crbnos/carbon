// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Boolean, NumberControlled } from "~/components/Form";
import { SetupSection, TermForm } from "~/components/Setup";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { LeaseClassificationPreview } from "./LeaseClassificationPreview";
import { type LeaseTerm, useLeaseTermSave } from "./LeaseSetupSteps";
import type { Lease, LeasePayment, LeasePolicy } from "./types";

type LeaseAccountingProps = {
  lease: Lease;
  payments: LeasePayment[];
  leasePolicy: LeasePolicy;
};

/** Whether the lease is an operating or a finance lease (ASC 842): the live
 *  result, then the rate the payments are discounted at and the inputs the
 *  five tests read. Every field saves on its own; activation classifies for
 *  good. */
const LeaseAccounting = ({
  lease,
  payments,
  leasePolicy
}: LeaseAccountingProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const id = lease.id!;
  const currencyCode = lease.currencyCode ?? "";
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const { save } = useLeaseTermSave(id);
  const isDisabled =
    lease.status !== "Draft" || !permissions.can("update", "purchasing");
  const hasPurchaseOption = (lease.purchaseOptionAmount ?? 0) > 0;

  const onChange = (field: LeaseTerm, value: string | null) => {
    const current = lease[field];
    if ((current ?? null) === (value ?? null) || String(current) === value) {
      return;
    }
    save(field, value);
  };
  const onSwitch = (field: LeaseTerm, value: boolean) => {
    if (!!lease[field] === value) return;
    save(field, value ? "on" : "off");
  };

  const moneyFormat = INPUT_FORMAT.money(currencyCode, currencyDecimals);
  const moneyStep = INPUT_STEP.money(currencyDecimals);

  return (
    <>
      <SetupSection
        title={<Trans>Accounting Treatment</Trans>}
        description={
          <Trans>
            Decided when the lease is activated, from the payment rows and the
            inputs below.
          </Trans>
        }
      >
        <div className="w-full">
          <LeaseClassificationPreview
            lease={lease}
            payments={payments}
            policy={leasePolicy}
          />
        </div>
      </SetupSection>

      <SetupSection
        title={<Trans>Measurement</Trans>}
        description={
          <Trans>
            The rate the payments are discounted at, and what the asset is worth
            and how long it lasts.
          </Trans>
        }
      >
        <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          <TermForm name="discountRate" value={lease.discountRate}>
            <NumberControlled
              name="discountRate"
              label={t`Discount Rate (%)`}
              helperText={t`Annual. Starts from the company's incremental borrowing rate`}
              isReadOnly={isDisabled}
              value={lease.discountRate ?? 0}
              minValue={0}
              step={INPUT_STEP.percent}
              formatOptions={INPUT_FORMAT.percentPoints}
              onChange={(value) =>
                onChange(
                  "discountRate",
                  String(Number.isNaN(value) ? 0 : value)
                )
              }
            />
          </TermForm>
          <TermForm name="fairValue" value={lease.fairValue}>
            <NumberControlled
              name="fairValue"
              label={t`Fair Value`}
              helperText={t`What the asset would cost to buy today`}
              isReadOnly={isDisabled}
              value={lease.fairValue ?? 0}
              minValue={0}
              step={moneyStep}
              formatOptions={moneyFormat}
              onChange={(value) =>
                // An emptied input commits NaN; no fair value is null, not 0.
                onChange("fairValue", value > 0 ? String(value) : null)
              }
            />
          </TermForm>
          <TermForm name="economicLifeMonths" value={lease.economicLifeMonths}>
            <NumberControlled
              name="economicLifeMonths"
              label={t`Economic Life (months)`}
              helperText={t`How long the asset is usable, by anyone`}
              isReadOnly={isDisabled}
              value={lease.economicLifeMonths ?? 0}
              minValue={0}
              onChange={(value) =>
                onChange("economicLifeMonths", value > 0 ? String(value) : null)
              }
            />
          </TermForm>
        </div>
      </SetupSection>

      <SetupSection
        title={<Trans>End of Term</Trans>}
        description={
          <Trans>
            What happens to the asset when the term ends. A purchase option that
            is reasonably certain becomes a payment row.
          </Trans>
        }
      >
        <div className="grid w-full grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
          <TermForm
            name="purchaseOptionAmount"
            value={lease.purchaseOptionAmount}
          >
            <NumberControlled
              name="purchaseOptionAmount"
              label={t`Purchase Option`}
              helperText={t`What the company can buy the asset for at the end`}
              isReadOnly={isDisabled}
              value={lease.purchaseOptionAmount ?? 0}
              minValue={0}
              step={moneyStep}
              formatOptions={moneyFormat}
              onChange={(value) =>
                // An emptied input commits NaN; no option is null, not 0.
                onChange(
                  "purchaseOptionAmount",
                  value > 0 ? String(value) : null
                )
              }
            />
          </TermForm>
          <div className="flex flex-col gap-4 md:col-span-2">
            {hasPurchaseOption && (
              <TermForm
                name="purchaseOptionReasonablyCertain"
                value={lease.purchaseOptionReasonablyCertain}
              >
                <Boolean
                  name="purchaseOptionReasonablyCertain"
                  label={t`Purchase option reasonably certain`}
                  description={t`The company expects to buy the asset at the end of the term.`}
                  isDisabled={isDisabled}
                  bordered
                  onChange={(value) =>
                    onSwitch("purchaseOptionReasonablyCertain", value)
                  }
                />
              </TermForm>
            )}
            <TermForm
              name="ownershipTransfers"
              value={lease.ownershipTransfers}
            >
              <Boolean
                name="ownershipTransfers"
                label={t`Ownership transfers`}
                description={t`Title passes to the company when the term ends.`}
                isDisabled={isDisabled}
                bordered
                onChange={(value) => onSwitch("ownershipTransfers", value)}
              />
            </TermForm>
            <TermForm name="specializedAsset" value={lease.specializedAsset}>
              <Boolean
                name="specializedAsset"
                label={t`Specialized asset`}
                description={t`The asset has no other use to the supplier once the term ends.`}
                isDisabled={isDisabled}
                bordered
                onChange={(value) => onSwitch("specializedAsset", value)}
              />
            </TermForm>
          </div>
        </div>
      </SetupSection>
    </>
  );
};

export default LeaseAccounting;
