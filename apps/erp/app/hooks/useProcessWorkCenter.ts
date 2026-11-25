// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useControlField } from "@carbon/form";
import { useCallback, useRef } from "react";
import { workCenterForProcess } from "~/modules/shared/shared.utils";

type ProcessWorkCenter = { id: string; locationId: string | null };

/**
 * Applies `workCenterForProcess` to an operation form's `workCenterId` field
 * once a process change has read the new process's work centers, and returns
 * the value it wrote. The user can pick a work center while those reads run,
 * so it decides from the value in the field when it writes, not the one the
 * process change started with.
 */
export function useProcessWorkCenter(formId: string) {
  const [workCenterId, setWorkCenterId] = useControlField<string | undefined>(
    "workCenterId",
    formId
  );
  const current = useRef(workCenterId);
  current.current = workCenterId;

  const keepForProcess = useCallback(
    (processWorkCenters: ProcessWorkCenter[], locationId?: string | null) => {
      const next = workCenterForProcess({
        workCenterId: current.current,
        processWorkCenters,
        locationId
      });
      current.current = next;
      setWorkCenterId(next);
      return next;
    },
    [setWorkCenterId]
  );

  return keepForProcess;
}
