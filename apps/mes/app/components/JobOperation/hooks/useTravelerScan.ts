// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast, useKeyboardWedge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { useFetcher, useNavigate } from "react-router";
import type { loader as resolveLoader } from "~/routes/x+/traveler.resolve";
import { path } from "~/utils/path";
import { parseTravelerCode, travelerScanAction } from "~/utils/traveler";

/** The unit and step a traveler scan issues into. */
type ScanContext = {
  operationId: string;
  jobMakeMethodId: string | null;
  parentTrackedEntityId: string | undefined;
  jobOperationStepId: string | undefined;
  unitNumber: number | undefined;
};

function isSameScanContext(a: ScanContext, b: ScanContext) {
  return (
    a.operationId === b.operationId &&
    a.jobMakeMethodId === b.jobMakeMethodId &&
    a.parentTrackedEntityId === b.parentTrackedEntityId &&
    a.jobOperationStepId === b.jobOperationStepId &&
    a.unitNumber === b.unitNumber
  );
}

/**
 * A traveler link scanned on an operation screen. An available unit is issued
 * into this operation, a unit already inside this job's unit opens that unit,
 * and anything else goes to the traveler route. The issue route refuses a
 * unit the current unit already has ("This unit already has its …"), and the
 * hook shows that refusal as a toast.
 *
 * A lookup is bound to the unit it was scanned for: when the operator moves
 * to another unit (or step) before it returns, the result is dropped, so a
 * component is never issued into a unit it was not scanned for.
 */
export function useTravelerScan({
  operationId,
  jobMakeMethodId,
  parentTrackedEntityId,
  jobOperationStepId,
  unitNumber,
  active
}: {
  operationId: string;
  jobMakeMethodId: string | null | undefined;
  parentTrackedEntityId: string | undefined;
  jobOperationStepId?: string;
  unitNumber?: number;
  active: boolean;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const lookupFetcher = useFetcher<typeof resolveLoader>();
  const issueFetcher = useFetcher<{ success: boolean; message: string }>();

  const context: ScanContext = {
    operationId,
    jobMakeMethodId: jobMakeMethodId ?? null,
    parentTrackedEntityId,
    jobOperationStepId,
    unitNumber
  };
  const currentContext = useRef(context);
  currentContext.current = context;
  // The context of the scan whose lookup is in flight.
  const scanContext = useRef<ScanContext | null>(null);

  useKeyboardWedge({
    test: (input) => !!parseTravelerCode(input),
    callback: (input) => {
      scanContext.current = currentContext.current;
      return lookupFetcher.load(
        `${path.to.travelerResolve}?code=${encodeURIComponent(input)}`
      );
    },
    inTextFields: true,
    active
  });

  const processedLookup = useRef<typeof lookupFetcher.data | null>(null);
  useEffect(() => {
    const result = lookupFetcher.data;
    if (
      lookupFetcher.state !== "idle" ||
      !result ||
      result === processedLookup.current
    ) {
      return;
    }
    processedLookup.current = result;

    const scanned = scanContext.current;
    scanContext.current = null;
    if (!scanned) return;
    if (!isSameScanContext(scanned, currentContext.current)) {
      toast.error(t`The unit changed. Scan again.`);
      return;
    }

    if (result.status === "error") {
      toast.error(t`Could not look up this label. Try again.`);
      return;
    }
    if (result.status !== "found") {
      toast.error(t`This label does not belong to a unit in this company`);
      return;
    }

    const action = travelerScanAction({
      scannedStatus: result.scannedStatus,
      targetTrackedEntityId: result.target?.trackedEntityId ?? null,
      targetStatus: result.target?.status ?? null,
      targetJobMakeMethodId: result.target?.jobMakeMethodId ?? null,
      targetInProduction: result.targetInProduction ?? false,
      operationJobMakeMethodId: scanned.jobMakeMethodId
    });

    if (action.kind === "issue") {
      issueFetcher.submit(
        JSON.stringify({
          travelerScan: true,
          jobOperationId: scanned.operationId,
          parentTrackedEntityId: scanned.parentTrackedEntityId,
          children: [{ trackedEntityId: result.trackedEntityId, quantity: 1 }],
          jobOperationStepId: scanned.jobOperationStepId,
          unitNumber: scanned.unitNumber
        }),
        {
          method: "post",
          action: path.to.issueTrackedEntity,
          encType: "application/json"
        }
      );
    } else if (action.kind === "open") {
      navigate(
        `${path.to.operation(scanned.operationId)}?trackedEntityId=${action.trackedEntityId}`
      );
    } else {
      navigate(path.to.traveler(result.trackedEntityId));
    }
  }, [lookupFetcher.state, lookupFetcher.data, issueFetcher, navigate, t]);

  const processedIssue = useRef<typeof issueFetcher.data | null>(null);
  useEffect(() => {
    const result = issueFetcher.data;
    if (
      issueFetcher.state !== "idle" ||
      !result ||
      result === processedIssue.current
    ) {
      return;
    }
    processedIssue.current = result;
    if (result.success) {
      toast.success(t`Issued`);
    } else {
      toast.error(result.message);
    }
  }, [issueFetcher.state, issueFetcher.data, t]);
}
