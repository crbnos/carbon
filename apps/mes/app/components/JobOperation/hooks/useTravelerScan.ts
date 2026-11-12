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

/**
 * A traveler link scanned on an operation screen. An available unit is issued
 * into this operation, a unit already inside this job's unit opens that unit,
 * and anything else goes to the traveler route.
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

  useKeyboardWedge({
    test: (input) => !!parseTravelerCode(input),
    callback: (input) =>
      lookupFetcher.load(
        `${path.to.travelerResolve}?code=${encodeURIComponent(input)}`
      ),
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

    if (result.status !== "found") {
      toast.error(t`This label does not belong to a unit in this company`);
      return;
    }

    const action = travelerScanAction({
      scannedStatus: result.scannedStatus,
      targetTrackedEntityId: result.target?.trackedEntityId ?? null,
      targetStatus: result.target?.status ?? null,
      targetJobMakeMethodId: result.target?.jobMakeMethodId ?? null,
      operationJobMakeMethodId: jobMakeMethodId ?? null
    });

    if (action.kind === "issue") {
      issueFetcher.submit(
        JSON.stringify({
          travelerScan: true,
          jobOperationId: operationId,
          parentTrackedEntityId,
          children: [{ trackedEntityId: result.trackedEntityId, quantity: 1 }],
          jobOperationStepId,
          unitNumber
        }),
        {
          method: "post",
          action: path.to.issueTrackedEntity,
          encType: "application/json"
        }
      );
    } else if (action.kind === "open") {
      navigate(
        `${path.to.operation(operationId)}?trackedEntityId=${action.trackedEntityId}`
      );
    } else {
      navigate(path.to.traveler(result.trackedEntityId));
    }
  }, [
    lookupFetcher.state,
    lookupFetcher.data,
    issueFetcher,
    navigate,
    operationId,
    jobMakeMethodId,
    parentTrackedEntityId,
    jobOperationStepId,
    unitNumber,
    t
  ]);

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
