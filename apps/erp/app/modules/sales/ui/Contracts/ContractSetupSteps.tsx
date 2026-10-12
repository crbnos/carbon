// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

type ContractSetupStepsProps = {
  current: ContractSetupStep;
  /** Absent while the contract is being created: no later step exists yet. */
  contractId?: string;
};

/** The five steps of setting up a contract. */
const ContractSetupSteps = ({
  current,
  contractId
}: ContractSetupStepsProps) => {
  const { t } = useLingui();
  return (
    <SetupSteps
      steps={contractSetupSteps}
      current={current}
      label={t`Contract setup`}
      labels={{
        details: t`Details`,
        products: t`Services`,
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
