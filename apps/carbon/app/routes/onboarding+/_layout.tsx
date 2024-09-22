import { Outlet } from "@remix-run/react";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { getLocationsList } from "~/modules/resources";
import { getCompany } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { onboardingSequence, path } from "~/utils/path";

import { VStack } from "@carbon/react";
import type { ShouldRevalidateFunction } from "@remix-run/react";

export const shouldRevalidate: ShouldRevalidateFunction = () => true;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const [company, locations] = await Promise.all([
    getCompany(client, companyId),
    getLocationsList(client, companyId),
  ]);
  // we don't need to do onboarding if we have a company name or locations
  if (company.data?.name && locations.data?.length) {
    throw redirect(path.to.authenticatedRoot);
  }

  const pathname = new URL(request.url).pathname;
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
