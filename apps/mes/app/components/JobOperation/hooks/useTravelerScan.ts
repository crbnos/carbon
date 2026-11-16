// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast, useKeyboardWedge } from "@carbon/react";
import { useRef } from "react";
import { useNavigate, useRevalidator } from "react-router";
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
  active
}: {
  operationId: string;
  parentTrackedEntityId: string | undefined;
  jobOperationStepId?: string;
  unitNumber?: number;
  active: boolean;
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
        if (result.message) toast.error(result.message);
        return;
      }
      if (result.message) toast.success(result.message);
      const here = screen.current;
      if (result.operationId !== here.operationId || !result.trackedEntityId) {
        return navigate(result.href);
      }
      // This operation: stay in this view (operation or assembly).
      if (result.trackedEntityId === here.trackedEntityId) {
        return revalidator.revalidate();
      }
      const url = new URL(window.location.href);
      url.searchParams.set("trackedEntityId", result.trackedEntityId);
      url.searchParams.delete("unit");
      return navigate(`${url.pathname}${url.search}`);
    },
    inTextFields: true,
    active
  });
}
