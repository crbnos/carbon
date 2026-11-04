// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ContractBillingBasis } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { SetupSteps } from "~/components/Setup";
import { path } from "~/utils/path";

export const contractSetupSteps = [
  "details",
  "products",
  "invoicing",
  "revenue",
  "review"
] as const;

export type ContractSetupStep = (typeof contractSetupSteps)[number];

/** A project contract has no Revenue step: its revenue follows each line's
 *  billing method. */
export const projectContractSetupSteps = [
  "details",
  "products",
  "invoicing",
  "review"
] as const satisfies readonly ContractSetupStep[];

/** The steps of setting up a contract of this billing basis. */
export function contractSetupStepsFor(
  billingBasis: ContractBillingBasis | null | undefined
): readonly ContractSetupStep[] {
  return billingBasis === "Project"
    ? projectContractSetupSteps
    : contractSetupSteps;
}

type ContractSetupStepsProps = {
  current: ContractSetupStep;
  /** Absent while the contract is being created: no later step exists yet. */
  contractId?: string;
  /** A service contract (`Schedule`, the default) or a project contract. */
  billingBasis?: ContractBillingBasis | null;
};

/** The steps of setting up a contract: five for a service contract, four
 *  for a project contract. */
const ContractSetupSteps = ({
  current,
  contractId,
  billingBasis
}: ContractSetupStepsProps) => {
  const { t } = useLingui();
  return (
    <SetupSteps
      steps={contractSetupStepsFor(billingBasis)}
      current={current}
      label={t`Contract setup`}
      labels={{
        details: t`Details`,
        products: billingBasis === "Project" ? t`Lines` : t`Services`,
        invoicing: t`Invoicing`,
        revenue: t`Revenue`,
        review: t`Review`
      }}
      to={
        contractId
          ? (step) => path.to.contractSetup(contractId, step)
          : undefined
      }
    />
  );
};

export default ContractSetupSteps;
