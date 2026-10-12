// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, RecordOutlet, useDisclosure } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPlay } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useMatches, useParams } from "react-router";
import { Confirm } from "~/components/Modals";
import { SetupFooter, SetupFrame } from "~/components/Setup";
import { useCurrencyFormatter, usePermissions, useRouteData } from "~/hooks";
import type {
  RentalAgreementRouteData,
  RentalAgreementSetupStep
} from "~/modules/sales/ui/Rentals";
import {
  RentalCommencementPreview,
  RentalSetupSteps,
  rentalAgreementSetupSteps
} from "~/modules/sales/ui/Rentals";
import { path } from "~/utils/path";

/** The setup wizard is for a Draft: once activated, an agreement is worked
 *  on from its page. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const agreement = await client
    .from("rentalAgreement")
    .select("status")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (agreement.data?.status !== "Draft") {
    throw redirect(path.to.rentalAgreementDetails(id));
  }
  return null;
}

/** The current step, from the deepest matched setup route. */
function useCurrentStep(): RentalAgreementSetupStep {
  const matches = useMatches();
  for (const step of rentalAgreementSetupSteps) {
    if (matches.some((match) => match.id.endsWith(`$id.setup.${step}`))) {
      return step;
    }
  }
  return "units";
}

export default function RentalAgreementSetupRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(id)
  );
  const step = useCurrentStep();
  const permissions = usePermissions();
  const activate = useDisclosure();
  const formatter = useCurrencyFormatter({
    currency: routeData?.rentalAgreement.currencyCode ?? undefined
  });

  if (!routeData) return null;
  const { rentalAgreement, lines, leaseInputs, leasePolicy } = routeData;
  const readableId = rentalAgreement.rentalAgreementId ?? "";

  const index = rentalAgreementSetupSteps.indexOf(step);
  const previous = index > 0 ? rentalAgreementSetupSteps[index - 1] : null;
  const next =
    index < rentalAgreementSetupSteps.length - 1
      ? rentalAgreementSetupSteps[index + 1]
      : null;
  const hasLines = lines.length > 0;
  // Activation refuses a unit at no rate; Review lists them.
  const hasUnpricedUnit = lines.some((line) => Number(line.rate) <= 0);
  // Only a sum of like rates means anything: shown when every unit bills
  // monthly, as on the agreement's summary.
  const monthlyRent =
    hasLines && lines.every((line) => line.rateUnit === "Month")
      ? lines.reduce((sum, line) => sum + Number(line.rate), 0)
      : null;
  const unitCount = lines.length;

  return (
    <SetupFrame
      title={readableId}
      subtitle={rentalAgreement.customerName}
      step={step}
      steps={<RentalSetupSteps current={step} rentalAgreementId={id} />}
    >
      <RecordOutlet />
      {/* The Details step is a form and renders its own footer, with Next
          as its submit. */}
      {step !== "details" && (
        <SetupFooter
          summary={
            <span className="flex items-baseline gap-4">
              <span className="text-muted-foreground">
                {unitCount === 1 ? t`1 unit` : t`${unitCount} units`}
              </span>
              {monthlyRent !== null && (
                <span className="flex items-baseline gap-2">
                  <span className="text-muted-foreground">
                    <Trans>Monthly Rent</Trans>
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatter.format(monthlyRent)}
                  </span>
                </span>
              )}
            </span>
          }
          actions={
            <>
              {previous && (
                <Button variant="secondary" asChild>
                  <Link to={path.to.rentalAgreementSetup(id, previous)}>
                    <Trans>Back</Trans>
                  </Link>
                </Button>
              )}
              {step === "review" ? (
                <>
                  <Button variant="secondary" asChild>
                    <Link to={path.to.rentalAgreements}>
                      <Trans>Save as Draft</Trans>
                    </Link>
                  </Button>
                  <Button
                    leftIcon={<LuPlay />}
                    isDisabled={
                      !hasLines ||
                      hasUnpricedUnit ||
                      !permissions.can("update", "sales")
                    }
                    onClick={activate.onOpen}
                  >
                    <Trans>Activate</Trans>
                  </Button>
                </>
              ) : next ? (
                hasLines || step !== "units" ? (
                  <Button asChild>
                    <Link to={path.to.rentalAgreementSetup(id, next)}>
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
      {activate.isOpen && (
        <Confirm
          action={path.to.rentalAgreementActivate(id)}
          title={t`Activate ${readableId}`}
          text={t`Activating checks every unit is available, classifies each unit's accounting treatment and cuts the first billing periods at each unit's rate. The terms and lines are fixed afterwards.`}
          confirmText={t`Activate`}
          onCancel={activate.onClose}
          onSubmit={activate.onClose}
          details={
            <RentalCommencementPreview
              rentalAgreement={rentalAgreement}
              lines={lines}
              leaseInputs={leaseInputs}
              leasePolicy={leasePolicy}
            />
          }
        />
      )}
    </SetupFrame>
  );
}
