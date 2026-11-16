// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast, useKeyboardWedge } from "@carbon/react";
import { useRef } from "react";
import type { action } from "~/routes/x+/issue-scan";
import { parseItemCode } from "~/utils/itemScan";
import { path } from "~/utils/path";

/**
 * An item sticker scanned on an operation screen is issued to this job, and
 * the operator stays on the screen. The server decides what is issued; when
 * it needs the operator to choose (a serial part, a short lot), it names the
 * material and `onChoose` opens the Issue dialog on it.
 *
 * One scan is one piece, so no scan may be lost: a scan made while an issue
 * is still in flight waits in a queue and is sent next. The callback returns
 * no promise for that reason (a pending scan makes the wedge drop the others).
 * A refusal empties the queue: the scans behind it would be refused too, or
 * would issue under a dialog the operator has not read yet.
 */
export function useItemScan({
  operationId,
  parentTrackedEntityId,
  active,
  onIssued,
  onChoose
}: {
  operationId: string;
  parentTrackedEntityId: string | undefined;
  active: boolean;
  onIssued?: () => void;
  onChoose: (materialId: string) => void;
}) {
  const queue = useRef<Record<string, string>[]>([]);
  const inFlight = useRef(false);

  const issue = useAction<typeof action>({
    // Before `onSuccess` / `onError`, and also for a result they do not get.
    onSettled: (result) => {
      const refused =
        !result ||
        "fieldErrors" in result ||
        ("success" in result && result.success === false);
      if (refused) queue.current = [];
      sendNext();
    },
    onSuccess: (result) => {
      if ("message" in result) toast.success(result.message);
      onIssued?.();
    },
    onError: (result) => {
      if (!("message" in result)) return;
      toast.error(result.message);
      if ("materialId" in result && result.materialId) {
        onChoose(result.materialId);
      }
    }
  });

  function sendNext() {
    const next = queue.current.shift();
    inFlight.current = !!next;
    if (next) issue.submit(next, { method: "post", action: path.to.issueScan });
  }

  useKeyboardWedge({
    test: (input) => !!parseItemCode(input),
    callback: (input) => {
      queue.current.push({
        jobOperationId: operationId,
        itemId: parseItemCode(input) ?? "",
        ...(parentTrackedEntityId ? { parentTrackedEntityId } : {})
      });
      if (!inFlight.current) sendNext();
    },
    inTextFields: true,
    active
  });
}
