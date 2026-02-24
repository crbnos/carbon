import {
  CarbonEdition,
  CarbonProvider,
  CONTROLLED_ENVIRONMENT,
  getCarbon
} from "@carbon/auth";
import { setCompanyId } from "@carbon/auth/company.server";
import {
  destroyAuthSession,
  requireAuthSession,
  updateCompanySession
} from "@carbon/auth/session.server";
import { TooltipProvider, useMount } from "@carbon/react";
import { ItarPopup, useKeyboardWedge, useNProgress } from "@carbon/remix";
import { getStripeCustomerByCompanyId } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import posthog from "posthog-js";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { RealtimeDataProvider } from "~/components";
import { PrimaryNavigation, Topbar } from "~/components/Layout";
import {
  getCompanies,
  getCompanyIntegrations,
  getCompanySettings
} from "~/modules/settings";
import { getCustomFieldsSchemas } from "~/modules/shared/shared.server";
import { getSavedViews } from "~/modules/shared/shared.service";
import {
  getUser,
  getUserClaims,
  getUserDefaults,
  getUserGroups
} from "~/modules/users/users.server";
import { ERP_URL, MES_URL, path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  defaultShouldRevalidate
}) => {
  if (
    currentUrl.pathname.startsWith("/x/settings") ||
    currentUrl.pathname.startsWith("/x/users") ||
    currentUrl.pathname.startsWith("/refresh-session") ||
    currentUrl.pathname.startsWith("/x/acknowledge") ||
    currentUrl.pathname.startsWith("/x/shared/views")
  ) {
    return true;
  }

  return defaultShouldRevalidate;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { accessToken, companyId, expiresAt, expiresIn, userId } =
    await requireAuthSession(request, { verify: true });

  // const { computeRegion, proxyRegion } = parseVercelId(
  //   request.headers.get("x-vercel-id")
  // );

  // console.log({
  //   computeRegion,
  //   proxyRegion,
  // });

  const client = getCarbon(accessToken);

  // parallelize the requests
  const [
    companies,
    stripeCustomer,
    customFields,
    integrations,
    companySettings,
    savedViews,
    user,
    claims,
    groups,
    defaults
  ] = await Promise.all([
    getCompanies(client, userId),
    getStripeCustomerByCompanyId(companyId, userId),
    getCustomFieldsSchemas(client, { companyId }),
    getCompanyIntegrations(client, companyId),
    getCompanySettings(client, companyId),
    getSavedViews(client, userId, companyId),
    getUser(client, userId),
    getUserClaims(userId, companyId),
    getUserGroups(client, userId),
    getUserDefaults(client, userId, companyId)
  ]);

  if (!claims || user.error || !user.data || !groups.data) {
    await destroyAuthSession(request);
  }

  let company = companies.data?.find((c) => c.companyId === companyId);

  if (!company && companies.data?.length) {
    company = companies.data[0];
    const sessionCookie = await updateCompanySession(request, company.id!);
    const companyIdCookie = setCompanyId(company.id!);
    throw redirect(path.to.authenticatedRoot, {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    });
  }

  const requiresOnboarding =
    !company?.name || (CarbonEdition === Edition.Cloud && !stripeCustomer);
  if (requiresOnboarding) {
    throw redirect(path.to.onboarding.root);
  }

  return {
    session: {
      accessToken,
      expiresIn,
      expiresAt
    },
    company,
    companies: companies.data ?? [],
    companySettings: companySettings.data,
    customFields: customFields.data ?? [],
    defaults: defaults.data,
    integrations: integrations.data ?? [],
    groups: groups.data,
    permissions: claims?.permissions,
    plan: stripeCustomer?.planId,
    role: claims?.role,
    user: user.data,
    savedViews: savedViews.data ?? []
  };
}

export default function AuthenticatedRoute() {
  const { session, user } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  useNProgress();
  useKeyboardWedge({
    test: (input) => input.startsWith(MES_URL) || input.startsWith(ERP_URL),
    callback: (input) => {
      try {
        const url = new URL(input);
        navigate(url.pathname + url.search);
      } catch {
        navigate(input);
      }
    }
  });

  useMount(() => {
    if (!user) return;

    posthog.identify(user.id, {
      email: user.email,
      name: `${user.firstName} ${user.lastName}`
    });
  });

  return (
    <div className="h-[100dvh] flex flex-col">
      {user?.acknowledgedITAR === false && CONTROLLED_ENVIRONMENT ? (
        <ItarPopup
          acknowledgeAction={path.to.acknowledge}
          logoutAction={path.to.logout}
        />
      ) : (
        <CarbonProvider session={session}>
          <RealtimeDataProvider>
            <TooltipProvider>
              <div className="flex flex-col h-screen">
                <Topbar />
                <div className="flex flex-1 h-[calc(100vh-49px)] relative">
                  <PrimaryNavigation />
                  <main className="flex-1 overflow-y-auto scrollbar-hide border-l border-t bg-muted sm:rounded-tl-2xl relative z-10">
                    <Outlet />
                  </main>
                </div>
              </div>
            </TooltipProvider>
          </RealtimeDataProvider>
        </CarbonProvider>
      )}
    </div>
  );
}
