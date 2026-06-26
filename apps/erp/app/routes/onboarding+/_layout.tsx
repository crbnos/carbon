import { CarbonEdition } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { TooltipProvider } from "@carbon/react";
import { getStripeCustomerByCompanyId } from "@carbon/stripe/stripe.server";
import { Edition, isInternalEmail } from "@carbon/utils";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, redirect } from "react-router";
import { MeshGradientBackground } from "~/components/MeshGradientBackground";
import { getLocationsList } from "~/modules/resources";
import { getCompany } from "~/modules/settings";
import { onboardingSequence, path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = () => true;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId, email } = await requirePermissions(
    request,
    {}
  );
  const isInternal = isInternalEmail(email);

  const [company, stripeCustomer, locations] = await Promise.all([
    getCompany(client, companyId),
    getStripeCustomerByCompanyId(companyId, userId),
    getLocationsList(client, companyId)
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

  // The data-choice step (demo template / backup import) is internal-only; the
  // plan step is Cloud-only. Everyone else creates their company in the company
  // step directly.
  const onboardingSteps = onboardingSequence.filter((p) => {
    if (p === path.to.onboarding.plan) return CarbonEdition === Edition.Cloud;
    if (p === path.to.onboarding.industry) return isInternal;
    return true;
  });

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
    nextPath
  };
}

export default function OnboardingLayout() {
  return (
    <TooltipProvider>
      <div className="relative h-screen w-screen">
        <MeshGradientBackground />
        <div className="relative z-10 flex h-full w-full items-center justify-center p-4">
          <Outlet />
        </div>
      </div>
    </TooltipProvider>
  );
}
