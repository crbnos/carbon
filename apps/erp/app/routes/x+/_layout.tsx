import { TooltipProvider, useMount } from "@carbon/react";
import { Outlet, useLoaderData, useNavigation } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import NProgress from "nprogress";
import { useEffect } from "react";

import { CarbonProvider, getCarbon } from "@carbon/auth";
import {
  destroyAuthSession,
  requireAuthSession,
} from "@carbon/auth/session.server";
import { RealtimeDataProvider } from "~/components";
import { PrimaryNavigation, Topbar } from "~/components/Layout";
import { getCompanies, getCompanyIntegrations } from "~/modules/settings";
import { getCustomFieldsSchemas } from "~/modules/shared/shared.server";
import {
  getUser,
  getUserClaims,
  getUserDefaults,
  getUserGroups,
} from "~/modules/users/users.server";
import { path } from "~/utils/path";

import type { ShouldRevalidateFunction } from "@remix-run/react";
import posthog from "posthog-js";
import { useUser } from "~/hooks";

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  defaultShouldRevalidate,
}) => {
  if (
    currentUrl.pathname.startsWith("/x/settings") ||
    currentUrl.pathname.startsWith("/x/users") ||
    currentUrl.pathname.startsWith("/refresh-session")
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

  // share a client between requests
  const client = getCarbon(accessToken);

  // parallelize the requests
  const [
    companies,
    customFields,
    integrations,
    user,
    claims,
    groups,
    defaults,
  ] = await Promise.all([
    getCompanies(client, userId),
    getCustomFieldsSchemas(client, { companyId }),
    getCompanyIntegrations(client, companyId),
    getUser(client, userId),
    getUserClaims(userId, companyId),
    getUserGroups(client, userId),
    getUserDefaults(client, userId, companyId),
  ]);

  if (!claims || user.error || !user.data || !groups.data) {
    await destroyAuthSession(request);
  }

  const company = companies.data?.find((c) => c.companyId === companyId);

  const requiresOnboarding = !companies.data?.[0]?.name;
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
    customFields: customFields.data ?? [],
    defaults: defaults.data,
    integrations: integrations.data ?? [],
    groups: groups.data,
    permissions: claims?.permissions,
    role: claims?.role,
    user: user.data,
  });
}

export default function AuthenticatedRoute() {
  const { session } = useLoaderData<typeof loader>();
  const user = useUser();
  const transition = useNavigation();

  useMount(() => {
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
              <Topbar />
              <div className="flex flex-1 h-[calc(100vh-49px)] relative">
                <PrimaryNavigation />
                <main className="flex-1 overflow-y-auto scrollbar-hide border-l border-t bg-muted rounded-tl-2xl relative z-10">
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
