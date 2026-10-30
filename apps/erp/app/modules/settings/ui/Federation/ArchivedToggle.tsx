// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuArchive, LuListChecks } from "react-icons/lu";
import { useUrlParams } from "~/hooks";

/** Switches a federation list between its active and its archived rows. */
export function useShowArchived(): boolean {
  const [params] = useUrlParams();
  return params.get("archived") === "true";
}

export default function ArchivedToggle() {
  const [, setParams] = useUrlParams();
  const showArchived = useShowArchived();
  return (
    <Button
      variant="secondary"
      leftIcon={showArchived ? <LuListChecks /> : <LuArchive />}
      onClick={() => setParams({ archived: showArchived ? null : "true" })}
    >
      {showArchived ? <Trans>Show active</Trans> : <Trans>Show archived</Trans>}
    </Button>
  );
}
