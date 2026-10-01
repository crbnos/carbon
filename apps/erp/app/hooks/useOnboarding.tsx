// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "@carbon/react";
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
    previous: routeData?.previousPath
  };
}
