import { useRouteData } from "@carbon/remix";
import { path } from "~/utils/path";

export function useOnboarding() {
  const routeData = useRouteData<{
    currentIndex: number;
    onboardingSteps: number;
    nextPath: string;
    previousPath: string;
  }>(path.to.onboarding.root);

  if (!routeData) {
    throw new Error("useOnboarding must be used within an onboarding route");
  }

  return {
    currentIndex: routeData?.currentIndex,
    onboardingSteps: routeData?.onboardingSteps,
    next: routeData?.nextPath,
    previous: routeData?.previousPath,
  };
}
