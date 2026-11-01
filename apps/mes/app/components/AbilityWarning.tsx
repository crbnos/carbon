// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { AbilityShortfall } from "~/services/operations.service";

// Shown on an operation whose process requires an ability the operator does
// not hold. With policy 'Block' its production work is also refused server-side.
export function AbilityWarning({ warning }: { warning: AbilityShortfall }) {
  const { processName, trainingName } = warning;
  const isBlocked = warning.policy === "Block";
  const expiredDate = warning.expiredOn ? formatDate(warning.expiredOn) : null;

  return (
    <Alert variant={isBlocked ? "destructive" : "warning"}>
      <LuTriangleAlert className="size-4" />
      <AlertTitle>
        {isBlocked ? (
          <Trans>You can't work on this operation</Trans>
        ) : (
          <Trans>You don't have the {processName} ability</Trans>
        )}
      </AlertTitle>
      <AlertDescription>
        <span className="text-pretty">
          {expiredDate && (
            <>
              <Trans>
                Your {processName} qualification expired on {expiredDate}.
              </Trans>{" "}
            </>
          )}
          {trainingName ? (
            <Trans>
              Complete the {trainingName} training to get the {processName}{" "}
              ability.
            </Trans>
          ) : (
            <Trans>
              Ask a supervisor to add the {processName} ability to your profile.
            </Trans>
          )}
          {!isBlocked && (
            <>
              {" "}
              <Trans>You can still start this operation.</Trans>
            </>
          )}
        </span>
      </AlertDescription>
    </Alert>
  );
}
