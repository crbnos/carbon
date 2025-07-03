import { getCompanyPlan, requirePermissions } from "@carbon/auth/auth.server";
import { Outlet } from "@remix-run/react";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { getLocationsList } from "~/modules/resources";
import { getCompany } from "~/modules/settings";
import { onboardingSequence, path } from "~/utils/path";

import { VStack } from "@carbon/react";
import type { ShouldRevalidateFunction } from "@remix-run/react";

export const shouldRevalidate: ShouldRevalidateFunction = () => true;

export const config = {
  runtime: "nodejs",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const [company, plan, locations] = await Promise.all([
    getCompany(client, companyId),
    getCompanyPlan(client, companyId),
    getLocationsList(client, companyId),
  ]);

  const pathname = new URL(request.url).pathname;
  const isOnPlanRoute = pathname === path.to.onboarding.plan;

  // Only redirect to plan page if we're not already on it
  if (company.data?.name && locations.data?.length) {
    if (!plan.data?.id && !isOnPlanRoute) {
      throw redirect(path.to.onboarding.plan);
    } else if (plan.data?.id) {
      throw redirect(path.to.authenticatedRoot);
    }
  }

  const pathIndex = onboardingSequence.findIndex((p) => p === pathname);

  const previousPath =
    pathIndex === 0 ? undefined : onboardingSequence[pathIndex - 1];

  const nextPath =
    pathIndex === onboardingSequence.length - 1
      ? path.to.authenticatedRoot
      : onboardingSequence[pathIndex + 1];

  return {
    currentIndex: pathIndex,
    onboardingSteps: onboardingSequence.length,
    previousPath,
    nextPath,
  };
}

export default function OnboardingLayout() {
  return (
    <VStack
      spacing={4}
      className="h-screen w-screen justify-center items-center p-4"
    >
      <Outlet />
    </VStack>
  );
}
