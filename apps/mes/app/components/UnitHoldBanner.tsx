// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { HoldingIssue } from "~/utils/unitHold";

// Shown on a serial unit with an open quality issue when the company holds
// such units. Work that needs the unit open is also refused server-side
// (`resolveWorkUnit`).
export function UnitHoldBanner({
  serialNumber,
  issues
}: {
  serialNumber?: string | null;
  issues: HoldingIssue[];
}) {
  if (issues.length === 0) return null;

  return (
    <Alert variant="destructive">
      <LuTriangleAlert className="size-4" />
      <AlertTitle>
        {serialNumber ? (
          <Trans>{serialNumber} is on hold</Trans>
        ) : (
          <Trans>This unit is on hold</Trans>
        )}
      </AlertTitle>
      <AlertDescription>
        <span className="text-pretty">
          <Trans>
            Work on this unit waits until quality closes every issue below.
            Other units are not affected.
          </Trans>
        </span>
        <ul className="mt-2 flex flex-col gap-2">
          {issues.map((issue) => (
            <li key={issue.id} className="flex flex-col">
              <span className="font-medium">
                {[issue.readableId, issue.type, issue.status]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="text-pretty">{issue.name}</span>
              {issue.description ? (
                <span className="text-pretty whitespace-pre-line">
                  {issue.description}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
