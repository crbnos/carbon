import { useRouteData } from "@carbon/remix";
import { useFetchers } from "@remix-run/react";
import type { Mode } from "~/types/validators";
import { modeValidator } from "~/types/validators";
import { path } from "~/utils/path";

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
  const routeData = useRouteData<{ mode: Mode }>(path.to.root);

  let mode = routeData?.mode ?? "light";

  if (optimisticMode && optimisticMode !== "system") {
    mode = optimisticMode;
  }

  return mode;
}
