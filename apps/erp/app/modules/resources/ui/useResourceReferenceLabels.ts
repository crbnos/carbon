// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type {
  ResourceReference,
  ResourceReferenceKey
} from "~/modules/resources/types";

/**
 * What blocks deleting a work center or process, as one line ("job
 * operations (3), procedures (1)"), or null when nothing does.
 */
export function useResourceReferenceLabels(
  references: ResourceReference<ResourceReferenceKey>[]
) {
  const { t } = useLingui();
  const labels: Record<ResourceReferenceKey, string> = {
    methodOperation: t`method operations`,
    quoteOperation: t`quote operations`,
    jobOperation: t`job operations`,
    jobOperationBatch: t`operation batches`,
    productionEvent: t`production events`,
    maintenanceSchedule: t`maintenance schedules`,
    maintenanceDispatch: t`maintenance dispatches`,
    maintenanceDispatchWorkCenter: t`maintenance dispatch work centers`,
    maintenanceDispatchEvent: t`maintenance events`,
    workCenterReplacementPart: t`replacement parts`,
    storageUnit: t`storage units`,
    fixedAsset: t`fixed assets`,
    workCenterDevice: t`machine devices`,
    machineStateChange: t`machine state changes`,
    unattributedMachineTime: t`unattributed machine time entries`,
    procedure: t`procedures`,
    training: t`trainings`,
    nonConformanceActionProcess: t`issue actions`,
    supplierProcess: t`supplier processes`,
    itemShelfLife: t`item shelf life rules`,
    employeeAbility: t`qualified employees`,
    contractorAbility: t`contractors`,
    partner: t`partners`,
    requiredAbility: t`work centers requiring its ability`
  };

  if (references.length === 0) return null;
  return references
    .map((reference) => `${labels[reference.key]} (${reference.count})`)
    .join(", ");
}
