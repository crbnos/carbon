// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import { MaintenanceAddPartModal } from "~/components/MaintenanceDispatch";
import { path } from "~/utils/path";

/**
 * Adds a part to a service job and issues it from stock: the maintenance
 * dispatch's modal, posting to `service.$jobId.add-and-issue`.
 */
export function ServiceJobAddPartModal({
  serviceJobId,
  itemOptions,
  onClose
}: {
  serviceJobId: string;
  itemOptions: { value: string; label: string; helper?: string }[];
  onClose: () => void;
}) {
  return (
    <MaintenanceAddPartModal
      dispatchId={serviceJobId}
      itemOptions={itemOptions}
      onClose={onClose}
      action={path.to.addAndIssueServiceJobItem(serviceJobId)}
      title={<Trans>Add Part</Trans>}
    />
  );
}
