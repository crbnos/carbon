// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import { useFetcher } from "react-router";
import { SetupSteps } from "~/components/Setup";
import { path } from "~/utils/path";

export const leaseSetupSteps = [
  "details",
  "assets",
  "payments",
  "accounting",
  "review"
] as const;

export type LeaseSetupStep = (typeof leaseSetupSteps)[number];

type LeaseSetupStepsProps = {
  current: LeaseSetupStep;
  /** Absent while the lease is being created: no later step exists yet. */
  leaseId?: string;
};

/** The five steps of setting up a lease. */
const LeaseSetupSteps = ({ current, leaseId }: LeaseSetupStepsProps) => {
  const { t } = useLingui();
  return (
    <SetupSteps
      steps={leaseSetupSteps}
      current={current}
      label={t`Lease setup`}
      labels={{
        details: t`Details`,
        assets: t`Assets`,
        payments: t`Payments`,
        accounting: t`Accounting`,
        review: t`Review`
      }}
      to={leaseId ? (step) => path.to.leaseSetup(leaseId, step) : undefined}
    />
  );
};

/** The lease terms a setup step saves one at a time, as `update.tsx` names
 *  them. An asset's own fields save through its line (`$id.$lineId.update`). */
export type LeaseTerm =
  | "paymentFrequency"
  | "paymentTiming"
  | "annualEscalationPercent"
  | "discountRate";

/** Saves one term of a Draft through the update route, which validates the
 *  terms as a whole and cuts every asset's payment rows again when a payment
 *  term changes; a refusal toasts. */
export function useLeaseTermSave(leaseId: string) {
  const fetcher = useFetcher<{ error: { message: string } | null }>();
  useEffect(() => {
    if (fetcher.data?.error) toast.error(fetcher.data.error.message);
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is stable
  const save = useCallback(
    (field: LeaseTerm, value: string | null) => {
      const formData = new FormData();
      formData.append("id", leaseId);
      formData.append("field", field);
      formData.append("value", value ?? "");
      return fetcher.submit(formData, {
        method: "post",
        action: path.to.leaseUpdate
      });
    },
    [leaseId]
  );

  return { save };
}

export default LeaseSetupSteps;
