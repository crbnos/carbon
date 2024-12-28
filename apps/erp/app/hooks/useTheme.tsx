import { useFetchers } from "@remix-run/react";

import { useRouteData } from "@carbon/remix";
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

  let theme = routeData?.theme ?? "carbon";

  if (optimisticTheme) {
    theme = optimisticTheme;
  }

  return theme;
}
