// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "@carbon/react";
import { useFetchers } from "react-router";
import { themeValidator } from "~/modules/settings";
import { path } from "~/utils/path";

export function useOptimisticTheme() {
  const fetchers = useFetchers();
  const themeFetcher = fetchers.find((f) => f.formAction === path.to.theme);

  if (themeFetcher && themeFetcher.formData) {
    const theme = { theme: themeFetcher.formData.get("theme") };
    const submission = themeValidator.safeParse(theme);

    if (submission.success) {
      return submission.data.theme;
    }
  }
}

export function useTheme() {
  const optimisticTheme = useOptimisticTheme();
  const routeData = useRouteData<{ theme: string }>(path.to.root);

  let theme = routeData?.theme ?? "zinc";

  if (optimisticTheme) {
    theme = optimisticTheme;
  }

  return theme;
}
