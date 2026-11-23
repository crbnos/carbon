// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuCircleCheck, LuTriangleAlert } from "react-icons/lu";
import { Link, useParams } from "react-router";
import { SetupBody, SetupSection } from "~/components/Setup";
import { useRouteData } from "~/hooks";
import type { RentalAgreementRouteData } from "~/modules/sales/ui/Rentals";
import {
  RentalAgreementSummary,
  RentalCommencementPreview,
  rentalUnitLabel
} from "~/modules/sales/ui/Rentals";
import { path } from "~/utils/path";

/** Setup step 5: the agreement at a glance, and anything that would stop
 *  Activate. Activate and Save as Draft are in the footer. */
export default function RentalAgreementSetupReviewRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(id)
  );
  if (!routeData) return null;
  const { rentalAgreement, lines, periods, leaseInputs, leasePolicy } =
    routeData;

  // A unit at no rate would bill nothing; activation refuses it.
  const unpriced = lines.filter((line) => Number(line.rate) <= 0);
  const isReady = lines.length > 0 && unpriced.length === 0;

  return (
    <SetupBody>
      <SetupSection
        title={<Trans>Review</Trans>}
        description={
          <Trans>
            Activating fixes the terms and units, classifies each unit and cuts
            the first billing periods. After that, invoices are created
            automatically as periods come due.
          </Trans>
        }
      >
        <div className="w-full">
          <RentalAgreementSummary
            rentalAgreement={rentalAgreement}
            lines={lines}
            periods={periods}
          />
        </div>
      </SetupSection>

      <SetupSection title={<Trans>Before You Activate</Trans>}>
        <div className="flex w-full max-w-3xl flex-col gap-4">
          {isReady ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LuCircleCheck className="size-4 shrink-0" />
              <Trans>Every unit has a rate.</Trans>
            </p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {lines.length === 0 && (
                <Gap
                  to={path.to.rentalAgreementSetup(id, "units")}
                  icon={<LuTriangleAlert className="text-red-500" />}
                >
                  <Trans>Add at least one unit.</Trans>
                </Gap>
              )}
              {unpriced.map((line) => (
                <Gap
                  key={line.id}
                  to={path.to.rentalAgreementSetup(id, "units")}
                  icon={<LuTriangleAlert className="text-red-500" />}
                >
                  <Trans>{rentalUnitLabel(line)} has no rate.</Trans>
                </Gap>
              ))}
            </ul>
          )}
          <RentalCommencementPreview
            rentalAgreement={rentalAgreement}
            lines={lines}
            leaseInputs={leaseInputs}
            leasePolicy={leasePolicy}
          />
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
