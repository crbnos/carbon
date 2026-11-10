// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";

/** Why an open-ended lease cannot activate while the short-term expedient is
 *  off, with both ways to fix it linked: turn the expedient on, or give the
 *  lease a fixed duration. Mirrors `OPEN_ENDED_NEEDS_EXPEDIENT`. */
export function OpenEndedExpedientNotice({ leaseId }: { leaseId: string }) {
  return (
    <Alert variant="destructive">
      <LuTriangleAlert className="h-4 w-4" />
      <AlertTitle>
        <Trans>The short-term lease expedient is off</Trans>
      </AlertTitle>
      <AlertDescription>
        <p>
          <Trans>
            An open-ended lease can be ended on notice, so it is a short-term
            lease. This company does not account for short-term leases off the
            balance sheet, so it cannot be activated. Either:
          </Trans>
        </p>
        <ul className="mt-2 list-disc pl-5">
          <li>
            <Trans>
              Turn on{" "}
              <Link
                to={`${path.to.accountingSettings}#lease-classification`}
                className="font-medium underline"
              >
                Short-Term Lease Expedient in Settings → Accounting
              </Link>
              , or
            </Trans>
          </li>
          <li>
            <Trans>
              Give the lease a{" "}
              <Link
                to={path.to.leaseSetup(leaseId, "details")}
                className="font-medium underline"
              >
                fixed duration on its Details step
              </Link>
              .
            </Trans>
          </li>
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export default OpenEndedExpedientNotice;
