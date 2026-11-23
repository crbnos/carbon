// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useRef } from "react";
import {
  useBackgroundBulkActionMessage,
  useTableJobRefusalMessage
} from "~/components/Table";
import {
  appendBulkSelection,
  type BulkSelection
} from "~/utils/bulk-selection";

/**
 * The client half of the bulk actions' "every matching row" path. Every bulk
 * action route answers such a request with the same shape
 * (`BulkActionStart`, `~/utils/table-jobs`): `{ success: true, background:
 * true }` when the background job started, `{ success: false, message }` when
 * it did not.
 */

/**
 * A function that toasts a route's answer when it is a background start (or
 * a refused one) and says whether it did, so the caller only handles its own
 * results.
 */
export function useBulkStartToast() {
  const backgroundMessage = useBackgroundBulkActionMessage();
  const refusalMessage = useTableJobRefusalMessage();
  return useCallback(
    (data: unknown): boolean => {
      if (data === null || typeof data !== "object") return false;
      const result = data as {
        success?: unknown;
        background?: unknown;
        message?: unknown;
        refusal?: unknown;
      };
      if (result.background === true) {
        toast.success(backgroundMessage);
        return true;
      }
      if (result.success === false && typeof result.message === "string") {
        toast.error(refusalMessage(result.refusal) ?? result.message);
        return true;
      }
      return false;
    },
    [backgroundMessage, refusalMessage]
  );
}

/** What a form-posted bulk action route answers. `done` / `failed` come with
 *  an error when some rows were changed before a later chunk failed. */
type BulkFormResult = {
  success?: boolean;
  background?: boolean;
  message?: string;
  error?: { message: string } | null;
  done?: number;
  failed?: number;
};

/**
 * A form-posted bulk action (the item tables' Update, Jobs and Purchase
 * Orders Delete): posts the selection plus the action's own fields and toasts
 * the answer. On success the page revalidates; nothing else is shown.
 * `fetcher` is the same fetcher, for a table's other posts whose error is
 * `{ error: { message } }` too (a row's Duplicate).
 */
export function useBulkFormAction() {
  const { t } = useLingui();
  const showStart = useBulkStartToast();
  const fetcher = useAction<BulkFormResult>({
    onSuccess: (data) => {
      showStart(data);
    },
    onError: (data) => {
      if (showStart(data)) return;
      const message = data.error?.message;
      if (!message) return;
      const { done = 0, failed = 0 } = data;
      toast.error(
        failed > 0
          ? t`Updated ${done}. Could not update ${failed}: ${message}`
          : message
      );
    }
  });

  const submitRef = useRef(fetcher.submit);
  submitRef.current = fetcher.submit;
  const submit = useCallback(
    (
      action: string,
      selection: BulkSelection,
      fields: Record<string, string | null | undefined>
    ) => {
      const formData = appendBulkSelection(new FormData(), selection);
      for (const [name, value] of Object.entries(fields)) {
        if (value !== null && value !== undefined) formData.append(name, value);
      }
      submitRef.current(formData, { method: "post", action });
    },
    []
  );

  return { submit, fetcher };
}

/**
 * The reason a bulk action is disabled for an "every matching row" selection
 * past its row limit (`isOverAllMatchingLimit`). A disabled menu item takes no
 * pointer events, so the item shows it as its second line.
 */
export function useAllMatchingLimitLabel(limit: number) {
  const { t, i18n } = useLingui();
  const rows = i18n.number(limit);
  return t`Filter the list to ${rows} rows or fewer`;
}
