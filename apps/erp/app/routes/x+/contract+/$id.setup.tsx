// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, useDisclosure } from "@carbon/react";
import { equals, isUnaffectedByNavigation, redirect } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { LuCircleCheck } from "react-icons/lu";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Link, Outlet, useMatches, useParams } from "react-router";
import { useCurrencyFormatter, usePermissions, useRouteData } from "~/hooks";
import type {
  ContractRouteData,
  ContractSetupStep
} from "~/modules/sales/ui/Contracts";
import {
  ContractConfirmModal,
  ContractSetupFooter,
  ContractSetupFrame,
  contractSetupSteps
} from "~/modules/sales/ui/Contracts";
import { path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["id"] })
    ? false
    : args.defaultShouldRevalidate;

/** The setup wizard is for a Draft: once confirmed, a contract is worked on
 *  from its page and changed with Amend. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const contract = await client
    .from("customerContract")
    .select("status")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (contract.data?.status !== "Draft") {
    throw redirect(path.to.contractDetails(id));
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
    currency: routeData?.contract.currencyCode ?? undefined
  });

  if (!routeData) return null;
  const { contract, lines, lineTotals, residuals, revenueResiduals } =
    routeData;

  const total = Object.values(lineTotals).reduce((sum, v) => sum + v, 0);
  const index = contractSetupSteps.indexOf(step);
  const previous = index > 0 ? contractSetupSteps[index - 1] : null;
  const next =
    index < contractSetupSteps.length - 1
      ? contractSetupSteps[index + 1]
      : null;
  const hasLines = lines.length > 0;
  const isBalanced =
    Object.values(residuals).every((r) => equals(r, 0)) &&
    Object.values(revenueResiduals).every((r) => equals(r, 0));

  return (
    <ContractSetupFrame
      title={contract.name || contract.customerContractId}
      subtitle={[contract.customerContractId, contract.customerName]
        .filter(Boolean)
        .join(" · ")}
      step={step}
      contractId={id}
    >
      <Outlet />
      {/* The Details step is a form and renders its own footer, with Next
          as its submit. */}
      {step !== "details" && (
        <ContractSetupFooter
          summary={
            <span className="flex items-baseline gap-2">
              <span className="text-muted-foreground">
                <Trans>Contract Total</Trans>
              </span>
              <span className="font-medium tabular-nums">
                {formatter.format(total)}
              </span>
            </span>
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
                    <Link to={path.to.contracts}>
                      <Trans>Save as Draft</Trans>
                    </Link>
                  </Button>
                  <Button
                    leftIcon={<LuCircleCheck />}
                    isDisabled={
                      !hasLines ||
                      !isBalanced ||
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
    </ContractSetupFrame>
  );
}
