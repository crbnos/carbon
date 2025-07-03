import { requirePermissions } from "@carbon/auth/auth.server";
import { Outlet } from "@remix-run/react";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { getLocationsList } from "~/modules/resources";
import { getCompany } from "~/modules/settings";
import { onboardingSequence, path } from "~/utils/path";

import { VStack } from "@carbon/react";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { getStripeCustomerByCompanyId } from "~/lib/stripe.server";

export const shouldRevalidate: ShouldRevalidateFunction = () => true;

export const config = {
  runtime: "nodejs",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const [company, stripeCustomer, locations] = await Promise.all([
    getCompany(client, companyId),
    getStripeCustomerByCompanyId(companyId),
    getLocationsList(client, companyId),
  ]);

  const pathname = new URL(request.url).pathname;

  // Only redirect to stripeCustomer page if we're not already on it
  if (company.data?.name && locations.data?.length) {
    if (!stripeCustomer && pathname !== path.to.onboarding.plan) {
      throw redirect(path.to.onboarding.plan);
    } else if (stripeCustomer) {
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
