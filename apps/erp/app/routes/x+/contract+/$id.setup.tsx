// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, RecordOutlet, useDisclosure } from "@carbon/react";
import { equals, redirect } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { LuCircleCheck } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useMatches, useParams } from "react-router";
import { SetupFooter, SetupFrame } from "~/components/Setup";
import { useCurrencyFormatter, usePermissions, useRouteData } from "~/hooks";
import type {
  ContractRouteData,
  ContractSetupStep
} from "~/modules/sales/ui/Contracts";
import {
  ContractConfirmModal,
  ContractSetupSteps,
  contractSetupSteps,
  contractSetupStepsFor,
  useProjectContractGaps
} from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";

/** The setup wizard is for a Draft: once confirmed, a contract is worked on
 *  from its page and changed with Amend. A project contract has no Revenue
 *  step, so a link to it lands on Review. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const contract = await client
    .from("customerContract")
    .select("status, billingBasis")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (contract.data?.status !== "Draft") {
    throw redirect(path.to.contractDetails(id));
  }
  if (
    contract.data.billingBasis === "Project" &&
    new URL(request.url).pathname
      .replace(/\.data$/, "")
      .endsWith("/setup/revenue")
  ) {
    throw redirect(path.to.contractSetup(id, "review"));
  }
  return null;
}

/** The current step, from the deepest matched setup route. */
function useCurrentStep(): ContractSetupStep {
  const matches = useMatches();
  for (const step of contractSetupSteps) {
    if (matches.some((match) => match.id.endsWith(`$id.setup.${step}`))) {
      return step;
    }
  }
  return "products";
}

export default function ContractSetupRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  const step = useCurrentStep();
  const permissions = usePermissions();
  const confirm = useDisclosure();
  const formatter = useCurrencyFormatter({
    currency: routeData?.contract.currencyCode
  });
  // A project contract's Review step lists its gaps; a blocking one keeps
  // Confirm disabled, as the server would refuse it.
  const projectGaps = useProjectContractGaps(id);

  if (!routeData) return null;
  const { contract, lines, lineTotals, residuals, revenueResiduals } =
    routeData;

  const isProject = contract.billingBasis === "Project";
  const total = Object.values(lineTotals).reduce((sum, v) => sum + v, 0);
  // A project contract has no contract total: its Time & Materials and Cost
  // Plus lines bill from project cost. Only its Fixed Price lines have a
  // price (the rate, at quantity 1).
  const fixedLines = lines.filter((line) => line.billingMethod === "Fixed");
  const fixedPriceTotal = fixedLines.reduce(
    (sum, line) => sum + Number(line.rate) * Number(line.quantity),
    0
  );
  const steps = contractSetupStepsFor(contract.billingBasis);
  const index = steps.indexOf(step);
  const previous = index > 0 ? steps[index - 1] : null;
  const next = index < steps.length - 1 ? steps[index + 1] : null;
  const hasLines = lines.length > 0;
  const isBalanced =
    Object.values(residuals).every((r) => equals(r, 0)) &&
    Object.values(revenueResiduals).every((r) => equals(r, 0));
  const hasBlockingGap = (projectGaps ?? []).some((gap) => gap.blocking);

  return (
    <SetupFrame
      title={contract.name || contract.customerContractId}
      subtitle={[contract.customerContractId, contract.customerName]
        .filter(Boolean)
        .join(" · ")}
      step={step}
      steps={
        <ContractSetupSteps
          current={step}
          contractId={id}
          billingBasis={contract.billingBasis}
        />
      }
    >
      <RecordOutlet />
      {/* The Details step is a form and renders its own footer, with Next
          as its submit. */}
      {step !== "details" && (
        <SetupFooter
          summary={
            isProject ? (
              fixedLines.length > 0 ? (
                <span className="flex items-baseline gap-2">
                  <span className="text-muted-foreground">
                    <Trans>Fixed Price Total</Trans>
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatter.format(fixedPriceTotal)}
                  </span>
                </span>
              ) : null
            ) : (
              <span className="flex items-baseline gap-2">
                <span className="text-muted-foreground">
                  <Trans>Contract Total</Trans>
                </span>
                <span className="font-medium tabular-nums">
                  {formatter.format(total)}
                </span>
              </span>
            )
          }
          actions={
            <>
              {previous && (
                <Button variant="secondary" asChild>
                  <Link to={path.to.contractSetup(id, previous)}>
                    <Trans>Back</Trans>
                  </Link>
                </Button>
              )}
              {step === "review" ? (
                <>
                  <Button variant="secondary" asChild>
                    <Link
                      to={
                        isProject ? path.to.projectContracts : path.to.contracts
                      }
                    >
                      <Trans>Save as Draft</Trans>
                    </Link>
                  </Button>
                  <Button
                    leftIcon={<LuCircleCheck />}
                    isDisabled={
                      !hasLines ||
                      !isBalanced ||
                      hasBlockingGap ||
                      !permissions.can("update", "sales")
                    }
                    onClick={confirm.onOpen}
                  >
                    <Trans>Confirm</Trans>
                  </Button>
                </>
              ) : next ? (
                hasLines || step !== "products" ? (
                  <Button asChild>
                    <Link to={path.to.contractSetup(id, next)}>
                      <Trans>Next</Trans>
                    </Link>
                  </Button>
                ) : (
                  <Button isDisabled>
                    <Trans>Next</Trans>
                  </Button>
                )
              ) : null}
            </>
          }
        />
      )}
      {confirm.isOpen && (
        <ContractConfirmModal contract={contract} onClose={confirm.onClose} />
      )}
    </SetupFrame>
  );
}
