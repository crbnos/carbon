// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { Link } from "react-router";
import { SetupFooter, SetupSteps } from "~/components/Setup";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { AccountListItem } from "../../types";

export const activationSteps = [
  "readiness",
  "inventory",
  "fixed-assets",
  "trial-balance",
  "enable"
] as const;

export type ActivationStep = (typeof activationSteps)[number];

/** What the wizard's layout loader returns. */
export type ActivationRouteData = {
  cutoverDate: string;
  earliestCutoverDate: string;
  latestCutoverDate: string;
};

/** The wizard's layout data, which every step reads. */
export function useActivationRouteData() {
  return useRouteData<ActivationRouteData>(path.to.accountingActivation);
}

/** Every active posting account, by id, from the accounting layout. */
export function useAccountsById() {
  const routeData = useRouteData<{
    balanceSheetAccounts: AccountListItem[];
    incomeStatementAccounts: AccountListItem[];
  }>(path.to.accounting);
  return useMemo(() => {
    const byId = new Map<string, AccountListItem>();
    for (const account of [
      ...(routeData?.balanceSheetAccounts ?? []),
      ...(routeData?.incomeStatementAccounts ?? [])
    ]) {
      byId.set(account.id, account);
    }
    return byId;
  }, [routeData]);
}

/** "1200 Raw Materials", or the id when the account is not in the chart. */
export function accountLabel(
  accountsById: Map<string, AccountListItem>,
  accountId: string
) {
  const account = accountsById.get(accountId);
  return account ? `${account.number} ${account.name}` : accountId;
}

/** A step's URL. The cutover date rides along in the search params, so it
 *  stays the same from step to step. */
export function activationStepPath(step: ActivationStep, cutoverDate: string) {
  return `${path.to.accountingActivationStep(step)}?${new URLSearchParams({
    cutover: cutoverDate
  })}`;
}

type ActivationStepsProps = {
  current: ActivationStep;
  cutoverDate: string;
};

/** The five steps of setting up accounting. */
const ActivationSteps = ({ current, cutoverDate }: ActivationStepsProps) => {
  const { t } = useLingui();
  return (
    <SetupSteps
      steps={activationSteps}
      current={current}
      label={t`Accounting setup`}
      labels={{
        readiness: t`Readiness`,
        inventory: t`Inventory`,
        "fixed-assets": t`Fixed assets`,
        "trial-balance": t`Trial balance`,
        enable: t`Enable`
      }}
      to={(step) => activationStepPath(step, cutoverDate)}
    />
  );
};

/** A step's bottom bar: Back to the step before, Next to the step after. */
export const ActivationFooter = ({
  step,
  cutoverDate,
  canContinue = true,
  summary
}: {
  step: ActivationStep;
  cutoverDate: string;
  /** False keeps Next disabled, as on Readiness while a check fails. */
  canContinue?: boolean;
  summary?: ReactNode;
}) => {
  const index = activationSteps.indexOf(step);
  const previous = index > 0 ? activationSteps[index - 1] : null;
  const next =
    index < activationSteps.length - 1 ? activationSteps[index + 1] : null;

  return (
    <SetupFooter
      summary={summary}
      actions={
        <>
          {previous && (
            <Button variant="secondary" asChild>
              <Link to={activationStepPath(previous, cutoverDate)}>
                <Trans>Back</Trans>
              </Link>
            </Button>
          )}
          {next &&
            (canContinue ? (
              <Button asChild>
                <Link to={activationStepPath(next, cutoverDate)}>
                  <Trans>Next</Trans>
                </Link>
              </Button>
            ) : (
              <Button isDisabled>
                <Trans>Next</Trans>
              </Button>
            ))}
        </>
      }
    />
  );
};

export default ActivationSteps;
