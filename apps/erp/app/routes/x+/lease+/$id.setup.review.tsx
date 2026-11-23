// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuCircleCheck, LuTriangleAlert } from "react-icons/lu";
import { Link, useParams } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import { useDateFormatter, useRouteData, useUser } from "~/hooks";
import type { LeaseRouteData } from "~/modules/purchasing/ui/Leases";
import {
  LeaseCommencementPreview,
  LeaseSummary,
  leaseActivationGaps,
  OpenEndedExpedientNotice,
  skippedPaymentBlockers
} from "~/modules/purchasing/ui/Leases";
import { path } from "~/utils/path";

/** Setup step 5: the lease at a glance, and anything that would stop
 *  Activate. Activate and Save as Draft are in the footer. */
export default function LeaseSetupReviewRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  const { company } = useUser();
  const { formatDate } = useDateFormatter();
  if (!routeData) return null;
  const { lease, lines, payments, schedule, leasePolicy } = routeData;

  const gaps = leaseActivationGaps({
    lease,
    lines,
    payments,
    baseCurrencyCode: company?.baseCurrencyCode,
    policy: leasePolicy
  });
  const skipped = gaps.includes("skippedPayment")
    ? skippedPaymentBlockers({ lease, lines, payments, policy: leasePolicy })
    : [];

  return (
    <SetupBody>
      <SetupSection
        title={<Trans>Review</Trans>}
        description={
          <Trans>
            Activating fixes the terms and the payment rows, classifies each
            asset and books it. After that, purchase invoices are drafted
            automatically as payments come due.
          </Trans>
        }
      >
        <div className="w-full">
          <LeaseSummary
            lease={lease}
            lines={lines}
            payments={payments}
            schedule={schedule}
          />
        </div>
      </SetupSection>

      <SetupSection title={<Trans>Before You Activate</Trans>}>
        <div className="flex w-full max-w-3xl flex-col gap-4">
          {gaps.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LuCircleCheck className="size-4 shrink-0" />
              <Trans>The lease is ready to activate.</Trans>
            </p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {gaps.includes("openEndedWithoutExpedient") && (
                <li>
                  <OpenEndedExpedientNotice leaseId={id} />
                </li>
              )}
              {gaps.includes("noAssets") && (
                <Gap
                  to={path.to.leaseSetup(id, "assets")}
                  icon={<LuTriangleAlert className="text-red-500" />}
                >
                  <Trans>Add at least one asset.</Trans>
                </Gap>
              )}
              {gaps.includes("assetWithoutPayments") && (
                <Gap
                  to={path.to.leaseSetup(id, "assets")}
                  icon={<LuTriangleAlert className="text-red-500" />}
                >
                  <Trans>Give every asset a payment.</Trans>
                </Gap>
              )}
              {skipped.map((blocker) => {
                const asset = blocker.description;
                const dueDate = formatDate(blocker.dueDate);
                return (
                  <Gap
                    key={`${blocker.leaseLineId}:${blocker.dueDate}`}
                    to={path.to.leaseSetup(id, "details")}
                    icon={<LuTriangleAlert className="text-red-500" />}
                  >
                    <Trans>
                      {asset}: the payment due {dueDate} is Skipped (paid
                      outside Carbon), so nothing would take it off the lease
                      liability. Set Invoice From on or before {dueDate}.
                    </Trans>
                  </Gap>
                );
              })}
              {gaps.includes("foreignCurrency") && (
                <Gap
                  to={path.to.leaseSetup(id, "details")}
                  icon={<LuTriangleAlert className="text-red-500" />}
                >
                  <Trans>
                    A lease must be in the company's base currency to be
                    activated.
                  </Trans>
                </Gap>
              )}
            </ul>
          )}
          {gaps.length === 0 && (
            <LeaseCommencementPreview
              lease={lease}
              lines={lines}
              payments={payments}
              policy={leasePolicy}
            />
          )}
        </div>
      </SetupSection>
    </SetupBody>
  );
}

/** One thing stopping Activate, linked to the step that fixes it. */
function Gap({
  to,
  icon,
  children
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 size-4 shrink-0 [&>svg]:size-4">{icon}</span>
      <Link to={to} className="hover:underline">
        {children}
      </Link>
    </li>
  );
}
