// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuCheck } from "react-icons/lu";
import { Link } from "react-router";
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

/** The five steps of setting up a contract, numbered, the current one
 *  underlined. Every step of a saved Draft is a link — each step saves as it
 *  goes, so moving between them never loses anything. */
const ContractSetupSteps = ({
  current,
  contractId
}: ContractSetupStepsProps) => {
  const { t } = useLingui();
  const labels: Record<ContractSetupStep, string> = {
    details: t`Details`,
    products: t`Services`,
    invoicing: t`Invoicing`,
    revenue: t`Revenue`,
    review: t`Review`
  };
  const currentIndex = contractSetupSteps.indexOf(current);

  return (
    <nav aria-label={t`Contract setup`} className="w-full overflow-x-auto">
      <ol className="flex items-center gap-8">
        {contractSetupSteps.map((step, index) => {
          const isCurrent = step === current;
          const isDone = index < currentIndex;
          const content = (
            <span
              className={cn(
                "flex items-center gap-2 border-b-2 pb-3 text-sm whitespace-nowrap transition-colors",
                isCurrent
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground",
                contractId && !isCurrent && "hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                  isCurrent
                    ? "border-foreground bg-foreground text-background"
                    : isDone
                      ? "border-foreground/40 text-foreground"
                      : "border-border"
                )}
              >
                {isDone ? <LuCheck className="size-3" /> : index + 1}
              </span>
              {labels[step]}
            </span>
          );

          return (
            <li key={step} aria-current={isCurrent ? "step" : undefined}>
              {contractId && !isCurrent ? (
                <Link
                  to={path.to.contractSetup(contractId, step)}
                  className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm block"
                >
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default ContractSetupSteps;
