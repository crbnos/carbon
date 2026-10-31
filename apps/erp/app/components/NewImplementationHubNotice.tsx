// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Alert, AlertDescription, AlertTitle, Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuRocket } from "react-icons/lu";
import { Link } from "react-router";
import { useUsesImplementationHub2 } from "~/hooks/useImplementationNavItem";
import { path } from "~/utils/path";

// Implementation Hub 1.0 stays open to a company on Implementation Hub 2.0 (an
// old link, a bookmark); this points its people to the version they now use.
// Which version the company gets comes from the app shell, which reads the
// flag with the hub row; the `hub` the 1.0 layout passes is the same row.
export function NewImplementationHubNotice(_props: {
  hub: { hubVersion?: string | null } | null | undefined;
}) {
  if (!useUsesImplementationHub2()) return null;
  return (
    <Alert variant="info" className="mb-6">
      <LuRocket />
      <AlertTitle>
        <Trans>Your company has a new Implementation Hub</Trans>
      </AlertTitle>
      <AlertDescription>
        <Trans>
          Each person has their own page there. This page stays available for
          reference.
        </Trans>
        <div className="mt-2">
          <Button asChild size="sm">
            <Link to={path.to.implementation}>
              <Trans>Open Implementation Hub</Trans>
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
