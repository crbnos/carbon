import { CarbonEdition } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { getStripeCustomerByCompanyId } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { Outlet } from "@remix-run/react";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { getLocationsList } from "~/modules/resources";
import { getCompany } from "~/modules/settings";
import { onboardingSequence, path } from "~/utils/path";

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

  if (company.data?.name && locations.data?.length) {
    if (CarbonEdition !== Edition.Cloud || stripeCustomer) {
      throw redirect(path.to.authenticatedRoot);
    }

    if (
      CarbonEdition === Edition.Cloud &&
      pathname !== path.to.onboarding.plan
    ) {
      throw redirect(path.to.onboarding.plan);
    }
  }

  const onboardingSteps =
    CarbonEdition === Edition.Cloud
      ? onboardingSequence
      : onboardingSequence.filter((p) => p !== path.to.onboarding.plan);

  const pathIndex = onboardingSteps.findIndex((p) => p === pathname);

  const previousPath =
    pathIndex === 0 ? undefined : onboardingSteps[pathIndex - 1];

  const nextPath =
    pathIndex === onboardingSteps.length - 1
      ? path.to.authenticatedRoot
      : onboardingSteps[pathIndex + 1];

  return {
    currentIndex: pathIndex,
    onboardingSteps: onboardingSteps.length,
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
