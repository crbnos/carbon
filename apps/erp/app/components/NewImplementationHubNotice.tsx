// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Alert, AlertDescription, AlertTitle, Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuRocket } from "react-icons/lu";
import { Link } from "react-router";
import { usesPersonalPages } from "~/modules/shared/shared.models";
import { path } from "~/utils/path";

// The Company Plan hub stays open to a company on Personal Pages (an old link,
// a bookmark); this points its people to the hub they now use.
export function NewImplementationHubNotice({
  hub
}: {
  hub: { layout?: string | null } | null | undefined;
}) {
  if (!usesPersonalPages(hub)) return null;
  return (
    <Alert variant="info" className="mb-6">
      <LuRocket />
      <AlertTitle>
        <Trans>Your company uses the new Implementation hub</Trans>
      </AlertTitle>
      <AlertDescription>
        <Trans>
          Each person has their own page there. This page stays available for
          reference.
        </Trans>
        <div className="mt-2">
          <Button asChild size="sm">
            <Link to={path.to.implementation}>
              <Trans>Open Implementation</Trans>
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
