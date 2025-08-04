import { CarbonEdition, CarbonProvider, getCarbon } from "@carbon/auth";
import {
  destroyAuthSession,
  requireAuthSession,
} from "@carbon/auth/session.server";
import { Button, IconButton, TooltipProvider, useMount } from "@carbon/react";
import { getStripeCustomerByCompanyId } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import {
  Outlet,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import NProgress from "nprogress";
import { useEffect } from "react";

import posthog from "posthog-js";
import { LuArrowUpRight, LuX } from "react-icons/lu";
import { RealtimeDataProvider } from "~/components";
import { PrimaryNavigation, Topbar } from "~/components/Layout";
import {
  getCompanies,
  getCompanyIntegrations,
  getCompanySettings,
} from "~/modules/settings";
import { getCustomFieldsSchemas } from "~/modules/shared/shared.server";
import {
  getUser,
  getUserClaims,
  getUserDefaults,
  getUserGroups,
} from "~/modules/users/users.server";
import { path } from "~/utils/path";

import { getSavedViews } from "~/modules/shared/shared.service";

export const config = {
  runtime: "nodejs",
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  defaultShouldRevalidate,
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
    defaults,
  ] = await Promise.all([
    getCompanies(client, userId),
    getStripeCustomerByCompanyId(companyId),
    getCustomFieldsSchemas(client, { companyId }),
    getCompanyIntegrations(client, companyId),
    getCompanySettings(client, companyId),
    getSavedViews(client, userId, companyId),
    getUser(client, userId),
    getUserClaims(userId, companyId),
    getUserGroups(client, userId),
    getUserDefaults(client, userId, companyId),
  ]);

  if (!claims || user.error || !user.data || !groups.data) {
    await destroyAuthSession(request);
  }

  const company = companies.data?.find((c) => c.companyId === companyId);

  const requiresOnboarding =
    !company?.name || (CarbonEdition === Edition.Cloud && !stripeCustomer);
  if (requiresOnboarding) {
    throw redirect(path.to.onboarding.root);
  }

  return json({
    session: {
      accessToken,
      expiresIn,
      expiresAt,
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
    savedViews: savedViews.data ?? [],
  });
}

export default function AuthenticatedRoute() {
  const { session, user } = useLoaderData<typeof loader>();

  const transition = useNavigation();

  useMount(() => {
    if (!user) return;

    posthog.identify(user.id, {
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
    });
  });

  /* NProgress */
  useEffect(() => {
    if (
      (transition.state === "loading" || transition.state === "submitting") &&
      !NProgress.isStarted()
    ) {
      NProgress.start();
    } else {
      NProgress.done();
    }
  }, [transition.state]);

  return (
    <div className="h-[100dvh] flex flex-col">
      <CarbonProvider session={session}>
        <RealtimeDataProvider>
          <TooltipProvider>
            <div className="flex flex-col h-screen">
              {user?.acknowledgedUniversity ? null : <AcademyBanner />}
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
    </div>
  );
}

function AcademyBanner() {
  const fetcher = useFetcher<{}>();

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 flex items-center justify-between gap-10  bg-[#212278] dark:bg-[#2f31ae] text-white py-1 px-2 rounded-lg z-50 shadow-md">
      <div />
      <fetcher.Form method="post" action={path.to.acknowledge}>
        <input type="hidden" name="intent" value="academy" />
        <input
          type="hidden"
          name="redirectTo"
          value="https://learn.carbon.ms"
        />
        <Button
          type="submit"
          variant="ghost"
          size="lg"
          className="hover:bg-transparent text-white hover:text-white"
          rightIcon={<LuArrowUpRight />}
        >
          <span>Introducing Carbon Academy</span>
        </Button>
      </fetcher.Form>
      <fetcher.Form method="post" action={path.to.acknowledge}>
        <input type="hidden" name="intent" value="academy" />
        <IconButton
          type="submit"
          aria-label="Close"
          variant="ghost"
          className="text-white dark:text-white hover:text-white"
          icon={<LuX />}
        />
      </fetcher.Form>
    </div>
  );
}
