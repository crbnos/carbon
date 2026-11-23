// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRevalidator } from "@carbon/query";
import { toast, useKeyboardWedge } from "@carbon/react";
import { useRef } from "react";
import { useNavigate } from "react-router";
import { parseTravelerCode } from "~/utils/traveler";
import { postTravelerScan } from "~/utils/travelerScan";

/**
 * A traveler link scanned on an operation screen. The server decides
 * (`/x/traveler/scan`): a free kit or sub-assembly joins the unit on screen,
 * or the next unit here that still needs it; a unit already in this job opens
 * it; a unit being built elsewhere opens its own work. The request names the
 * unit on screen at scan time, so a late reply never issues into another.
 */
export function useTravelerScan({
  operationId,
  parentTrackedEntityId,
  jobOperationStepId,
  unitNumber,
  active,
  onUnitOpened,
  onUnitRequired
}: {
  operationId: string;
  parentTrackedEntityId: string | undefined;
  jobOperationStepId?: string;
  unitNumber?: number;
  active: boolean;
  /** A scan named a unit of this operation: the operator holds it now. */
  onUnitOpened: (unitId: string) => void;
  /** The server refused to issue a part for want of a unit: ask for it. */
  onUnitRequired: () => void;
}) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const screen = useRef({
    operationId,
    trackedEntityId: parentTrackedEntityId,
    jobOperationStepId,
    unitNumber
  });
  screen.current = {
    operationId,
    trackedEntityId: parentTrackedEntityId,
    jobOperationStepId,
    unitNumber
  };

  useKeyboardWedge({
    test: (input) => !!parseTravelerCode(input),
    callback: async (input) => {
      const result = await postTravelerScan({ code: input, ...screen.current });
      if (!result.href) {
        if (result.pickUnit) return onUnitRequired();
        if (result.message) toast.error(result.message);
        return;
      }
      if (result.message) toast.success(result.message);
      const here = screen.current;
      if (result.operationId !== here.operationId || !result.trackedEntityId) {
        return navigate(result.href);
      }
      // This operation: the scanned unit is held now, in this view.
      onUnitOpened(result.trackedEntityId);
      return revalidator.revalidate();
    },
    inTextFields: true,
    active
  });
}
