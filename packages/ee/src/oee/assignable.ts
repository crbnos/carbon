// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { isJobLocked } from "@carbon/utils";

/** Why an operation cannot take machine time. */
export type MachineTimeRefusal = "Done" | "Canceled" | "Locked";

/**
 * Why an operation cannot take machine time, or null when it can: it is Done
 * or Canceled, or its job is locked. The one rule for the sync, the assign
 * write and the review's suggestion cards.
 */
export function machineTimeRefusal(
  operationStatus: string | null | undefined,
  jobStatus: string | null | undefined
): MachineTimeRefusal | null {
  if (operationStatus === "Done" || operationStatus === "Canceled") {
    return operationStatus;
  }
  return isJobLocked(jobStatus) ? "Locked" : null;
}
