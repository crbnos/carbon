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
import Money from "~/components/Money";
import { SetupFooter, SetupFrame } from "~/components/Setup";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type {
  LeaseRouteData,
  LeaseSetupStep
} from "~/modules/purchasing/ui/Leases";
import {
  LeaseCommencementPreview,
  LeaseSetupSteps,
  leaseActivationGaps,
  leaseSetupSteps,
  useLeaseActivateText
} from "~/modules/purchasing/ui/Leases";
import { path } from "~/utils/path";

/** The setup wizard is for a Draft: once activated, a lease is worked on
 *  from its page and changed with Modify. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const lease = await client
    .from("lease")
    .select("status")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (lease.data?.status !== "Draft") {
    throw redirect(path.to.leaseDetails(id));
  }
  return null;
}

/** The current step, from the deepest matched setup route. */
function useCurrentStep(): LeaseSetupStep {
  const matches = useMatches();
  for (const step of leaseSetupSteps) {
    if (matches.some((match) => match.id.endsWith(`$id.setup.${step}`))) {
      return step;
    }
  }
  return "assets";
}

export default function LeaseSetupRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  const step = useCurrentStep();
  const permissions = usePermissions();
  const { company } = useUser();
  const activate = useDisclosure();
  const activateText = useLeaseActivateText();

  if (!routeData) return null;
  const { lease, lines, payments, leasePolicy } = routeData;
  const readableId = lease.leaseId ?? "";

  const index = leaseSetupSteps.indexOf(step);
  const previous = index > 0 ? leaseSetupSteps[index - 1] : null;
  const next =
    index < leaseSetupSteps.length - 1 ? leaseSetupSteps[index + 1] : null;
  const hasPayments = payments.length > 0;
  const total = payments.reduce(
    (sum, payment) => sum + Number(payment.amount),
    0
  );
  const isReady =
    leaseActivationGaps({
      lease,
      lines,
      payments,
      baseCurrencyCode: company?.baseCurrencyCode,
      policy: leasePolicy
    }).length === 0;

  return (
    <SetupFrame
      title={lease.name || readableId}
      subtitle={[lease.name ? readableId : null, lease.supplierName]
        .filter(Boolean)
        .join(" · ")}
      step={step}
      steps={<LeaseSetupSteps current={step} leaseId={id} />}
    >
      <RecordOutlet />
      {/* The Details step is a form and renders its own footer, with Next
          as its submit. */}
      {step !== "details" && (
        <SetupFooter
          summary={
            <span className="flex items-baseline gap-4">
              <span className="text-muted-foreground">
                {lines.length === 1 ? t`1 asset` : t`${lines.length} assets`}
              </span>
              <span className="text-muted-foreground">
                {payments.length === 1
                  ? t`1 payment`
                  : t`${payments.length} payments`}
              </span>
              {hasPayments && (
                <span className="flex items-baseline gap-2">
                  <span className="text-muted-foreground">
                    <Trans>Total Payments</Trans>
                  </span>
                  <span className="font-medium">
                    <Money value={total} currencyCode={lease.currencyCode} />
                  </span>
                </span>
              )}
            </span>
          }
          actions={
            <>
              {previous && (
                <Button variant="secondary" asChild>
                  <Link to={path.to.leaseSetup(id, previous)}>
                    <Trans>Back</Trans>
                  </Link>
                </Button>
              )}
              {step === "review" ? (
                <>
                  <Button variant="secondary" asChild>
                    <Link to={path.to.leases}>
                      <Trans>Save as Draft</Trans>
                    </Link>
                  </Button>
                  <Button
                    leftIcon={<LuPlay />}
                    isDisabled={
                      !isReady || !permissions.can("update", "purchasing")
                    }
                    onClick={activate.onOpen}
                  >
                    <Trans>Activate</Trans>
                  </Button>
                </>
              ) : next ? (
                (step === "assets" && lines.length === 0) ||
                (step === "payments" && !hasPayments) ? (
                  <Button isDisabled>
                    <Trans>Next</Trans>
                  </Button>
                ) : (
                  <Button asChild>
                    <Link to={path.to.leaseSetup(id, next)}>
                      <Trans>Next</Trans>
                    </Link>
                  </Button>
                )
              ) : null}
            </>
          }
        />
      )}
      {activate.isOpen && (
        <Confirm
          action={path.to.leaseActivate(id)}
          title={t`Activate ${readableId}`}
          text={activateText(lease)}
          confirmText={t`Activate`}
          onCancel={activate.onClose}
          onSubmit={activate.onClose}
          details={
            <LeaseCommencementPreview
              lease={lease}
              lines={lines}
              payments={payments}
              policy={leasePolicy}
            />
          }
        />
      )}
    </SetupFrame>
  );
}
