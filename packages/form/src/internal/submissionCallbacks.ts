// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useRef } from "react";

export function useSubmitComplete(isSubmitting: boolean, callback: () => void) {
  const isPending = useRef(false);
  useEffect(() => {
    if (isSubmitting) {
      isPending.current = true;
    }

    if (!isSubmitting && isPending.current) {
      isPending.current = false;
      callback();
    }
  });
}
