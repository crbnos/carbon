// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast, useKeyboardWedge } from "@carbon/react";
import { formatQuantity } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useRef } from "react";
import type { action } from "~/routes/x+/issue-scan";
import { parseItemCode } from "~/utils/itemScan";
import {
  afterItemScanRefusal,
  enqueueItemScan,
  type QueuedItemScan,
  queuedPieces
} from "~/utils/itemScanQueue";
import { path } from "~/utils/path";

/** One toast for the scans still on their way, updated in place. */
const PROGRESS_TOAST = "item-scan-progress";

/**
 * An item sticker scanned on an operation screen is issued to this job, and
 * the operator stays on the screen. The server decides what is issued; when
 * it needs the operator to choose (a serial part, a short lot), it names the
 * material and `onChoose` opens the Issue dialog on it.
 *
 * One scan of a part is one piece, so no scan may be lost. A scan made while
 * an issue is in flight waits in a queue (`~/utils/itemScanQueue`): scans of
 * one item are sent together as a count, and a toast shows how many wait, so
 * the operator sees each scan land without scanning again. The wedge callback
 * returns no promise, and takes scans while another is pending, for the same
 * reason: a pending scan makes the wedge drop the others.
 */
export function useItemScan({
  operationId,
  parentTrackedEntityId,
  active,
  isDialogOpen,
  onIssued,
  onChoose
}: {
  operationId: string;
  parentTrackedEntityId: string | undefined;
  active: boolean;
  /** The Issue dialog is open: a scan made now closes it once issued. */
  isDialogOpen: boolean;
  onIssued?: () => void;
  onChoose: (materialId: string) => void;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const queue = useRef<QueuedItemScan[]>([]);
  /** The entry the server is working on. */
  const sent = useRef<QueuedItemScan | null>(null);

  const showProgress = () => {
    const waiting = queuedPieces(queue.current);
    if (!sent.current && waiting === 0) {
      toast.dismiss(PROGRESS_TOAST);
      return;
    }
    toast.loading(
      waiting > 0 ? t`Issuing. ${waiting} more scanned.` : t`Issuing`,
      { id: PROGRESS_TOAST }
    );
  };

  const issue = useAction<typeof action>({
    // Before `onSuccess` / `onError`, and also for a result they do not get.
    onSettled: (result) => {
      const settled = sent.current;
      const refused =
        !result ||
        "fieldErrors" in result ||
        ("success" in result && result.success === false);
      if (refused && settled) {
        queue.current = afterItemScanRefusal(queue.current, {
          itemId: settled.itemId,
          needsOperator:
            !!result && "materialId" in result && !!result.materialId
        });
      }
      if (
        settled?.closeDialog &&
        result &&
        "success" in result &&
        result.success
      ) {
        onIssued?.();
      }
      sendNext();
    },
    onSuccess: (result) => {
      if (!("issued" in result)) return;
      const quantity = formatQuantity(result.quantity, locale);
      const issued = formatQuantity(result.issued, locale);
      const required = formatQuantity(result.required, locale);
      const { name } = result;
      const batches = result.batches.join(", ");
      toast.success(
        batches
          ? t`Issued ${quantity} ${name} from ${batches} (${issued} of ${required})`
          : t`Issued ${quantity} ${name} (${issued} of ${required})`
      );
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
    const [next, ...rest] = queue.current;
    queue.current = rest;
    sent.current = next ?? null;
    showProgress();
    if (!next) return;
    issue.submit(
      {
        jobOperationId: operationId,
        itemId: next.itemId,
        pieces: String(next.pieces),
        ...(parentTrackedEntityId ? { parentTrackedEntityId } : {})
      },
      { method: "post", action: path.to.issueScan }
    );
  }

  useKeyboardWedge({
    test: (input) => !!parseItemCode(input),
    callback: (input) => {
      queue.current = enqueueItemScan(queue.current, {
        itemId: parseItemCode(input) ?? "",
        closeDialog: isDialogOpen
      });
      if (sent.current) showProgress();
      else sendNext();
    },
    inTextFields: true,
    whilePending: true,
    active
  });

  // Leaving the screen (the operation finished, another unit was opened) ends
  // the queue: say what was scanned and never sent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on unmount only
  useEffect(
    () => () => {
      toast.dismiss(PROGRESS_TOAST);
      const lost = queuedPieces(queue.current);
      queue.current = [];
      if (lost > 0) {
        toast.error(
          t`${lost} scanned pieces were not issued. Scan them again.`
        );
      }
    },
    []
  );
}
