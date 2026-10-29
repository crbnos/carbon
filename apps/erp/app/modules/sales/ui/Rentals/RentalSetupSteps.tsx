// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import { useFetcher } from "react-router";
import { SetupSteps } from "~/components/Setup";
import { path } from "~/utils/path";

export const rentalAgreementSetupSteps = [
  "details",
  "units",
  "billing",
  "accounting",
  "review"
] as const;

export type RentalAgreementSetupStep =
  (typeof rentalAgreementSetupSteps)[number];

type RentalSetupStepsProps = {
  current: RentalAgreementSetupStep;
  /** Absent while the agreement is being created: no later step exists yet. */
  rentalAgreementId?: string;
};

/** The five steps of setting up a rental agreement. */
const RentalSetupSteps = ({
  current,
  rentalAgreementId
}: RentalSetupStepsProps) => {
  const { t } = useLingui();
  return (
    <SetupSteps
      steps={rentalAgreementSetupSteps}
      current={current}
      label={t`Rental agreement setup`}
      labels={{
        details: t`Details`,
        units: t`Units`,
        billing: t`Billing`,
        accounting: t`Accounting`,
        review: t`Review`
      }}
      to={
        rentalAgreementId
          ? (step) => path.to.rentalAgreementSetup(rentalAgreementId, step)
          : undefined
      }
    />
  );
};

/** The terms a setup step saves one at a time, as `update.tsx` names them. */
export type RentalTerm =
  | "billingCycle"
  | "billingTiming"
  | "paymentTermId"
  | "depositAmount"
  | "taxPercent"
  | "discountRate"
  | "ownershipTransfers"
  | "specializedAsset"
  | "purchaseOptionAmount"
  | "purchaseOptionReasonablyCertain";

/** Saves one term of a Draft through the properties route, which validates
 *  the terms as a whole; a refusal toasts. `saveInvoiceAutomation` sets the
 *  invoicing override (null = the company default). */
export function useRentalTermSave(rentalAgreementId: string) {
  const fetcher = useFetcher<{ error: { message: string } | null }>();
  useEffect(() => {
    if (fetcher.data?.error) toast.error(fetcher.data.error.message);
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const submit = useCallback(
    (fields: Record<string, string>) => {
      const formData = new FormData();
      formData.append("id", rentalAgreementId);
      for (const [key, value] of Object.entries(fields)) {
        formData.append(key, value);
      }
      return fetcher.submit(formData, {
        method: "post",
        action: path.to.rentalAgreementUpdate
      });
    },
    [rentalAgreementId]
  );

  const save = useCallback(
    (field: RentalTerm, value: string | null) =>
      submit({ field, value: value ?? "" }),
    [submit]
  );

  const saveInvoiceAutomation = useCallback(
    (value: string | null) =>
      submit({ intent: "invoiceAutomation", value: value ?? "" }),
    [submit]
  );

  return { save, saveInvoiceAutomation };
}

export default RentalSetupSteps;
