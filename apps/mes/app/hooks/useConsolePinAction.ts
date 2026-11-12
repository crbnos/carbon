// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { useCallback, useEffect, useRef } from "react";
import { beginConsolePinChange } from "~/utils/console-pin-activity";

type ConsolePinResult = { success?: boolean; error?: string };

/** A router action that pauses operator heartbeats until the PIN change settles. */
export function useConsolePinAction({
  onSuccess,
  onError
}: {
  onSuccess?: (result: ConsolePinResult) => void;
  onError?: (result: ConsolePinResult) => void;
} = {}) {
  const finishRef = useRef<(() => void) | null>(null);
  const action = useAction<ConsolePinResult>({
    onSuccess,
    onError,
    onSettled: () => {
      finishRef.current?.();
      finishRef.current = null;
    }
  });

  useEffect(
    () => () => {
      finishRef.current?.();
    },
    []
  );

  const submit = useCallback(
    (formData: FormData | null, path: string) => {
      finishRef.current ??= beginConsolePinChange();
      action.submit(formData, { method: "POST", action: path });
    },
    [action.submit]
  );

  return { action, submit };
}
