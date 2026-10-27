// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Spinner } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

/**
 * Shown from the moment a scan is accepted until its page or action finishes.
 * A kanban start label loads the ERP and then the MES, and without this the
 * screen does not change for seconds: operators scanned it again.
 */
export function ScanPendingOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-8 py-6 shadow-lg">
        <Spinner size={32} />
        <p className="text-lg font-medium">
          <Trans>Scan received</Trans>
        </p>
        <p className="text-sm text-muted-foreground">
          <Trans>Loading. There's no need to scan again.</Trans>
        </p>
      </div>
    </div>
  );
}
