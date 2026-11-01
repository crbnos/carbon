// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CarbonPulse } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";

/**
 * Shown from the moment a scan is accepted until its page or action finishes.
 * A kanban start label loads the ERP and then the MES, and without this the
 * screen does not change for seconds: operators scanned it again.
 */
export function ScanPendingOverlay() {
  const { t } = useLingui();
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-card">
      <CarbonPulse label={t`Scan received`} />
      <p className="text-lg font-medium" aria-hidden>
        <Trans>Scan received</Trans>
      </p>
      <p className="text-sm text-muted-foreground">
        <Trans>Loading. There's no need to scan again.</Trans>
      </p>
    </div>
  );
}
