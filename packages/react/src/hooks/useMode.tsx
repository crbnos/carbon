// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Mode } from "@carbon/utils";
import { modeValidator } from "@carbon/utils";
import { useFetchers } from "react-router";
import { useRouteData } from "./useRouteData";

export function useOptimisticMode() {
  const fetchers = useFetchers();
  const modeFetcher = fetchers.find((f) => f.formAction === "/");

  if (modeFetcher && modeFetcher.formData) {
    const mode = { mode: modeFetcher.formData.get("mode") };
    const submission = modeValidator.safeParse(mode);

    if (submission.success) {
      return submission.data.mode;
    }
  }
}

export function useMode() {
  const optimisticMode = useOptimisticMode();
  const routeData = useRouteData<{ mode: Mode }>("/");

  let mode = routeData?.mode ?? "light";

  if (optimisticMode && optimisticMode !== "system") {
    mode = optimisticMode;
  }

  return mode;
}
