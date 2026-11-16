// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast, useKeyboardWedge } from "@carbon/react";
import type { action } from "~/routes/x+/issue-scan";
import { parseItemCode } from "~/utils/itemScan";
import { path } from "~/utils/path";

/**
 * An item sticker scanned on an operation screen is issued to this job, and
 * the operator stays on the screen. The server decides what is issued; when
 * it needs the operator to choose (a serial part, a short lot), it names the
 * material and `onChoose` opens the Issue dialog on it.
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
  const issue = useAction<typeof action>({
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

  useKeyboardWedge({
    test: (input) => !!parseItemCode(input),
    callback: (input) =>
      issue.submit(
        {
          jobOperationId: operationId,
          itemId: parseItemCode(input) ?? "",
          ...(parentTrackedEntityId ? { parentTrackedEntityId } : {})
        },
        { method: "post", action: path.to.issueScan }
      ),
    inTextFields: true,
    active
  });
}
