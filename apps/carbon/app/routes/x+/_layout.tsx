import { Toaster, TooltipProvider } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useNavigation } from "@remix-run/react";
import NProgress from "nprogress";
import { useEffect } from "react";
import { IconSidebar, Topbar } from "~/components/Layout";
import { SupabaseProvider, getSupabase } from "~/lib/supabase";
import { getCompanies, getCompanyIntegrations } from "~/modules/settings";
import { RealtimeDataProvider } from "~/modules/shared";
import { getCustomFieldsSchemas } from "~/modules/shared/shared.server";
import {
  getUser,
  getUserClaims,
  getUserDefaults,
  getUserGroups,
} from "~/modules/users/users.server";
import {
  destroyAuthSession,
  requireAuthSession,
} from "~/services/session.server";
import { path } from "~/utils/path";

import type { ShouldRevalidateFunction } from "@remix-run/react";

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  defaultShouldRevalidate,
}) => {
  if (
    currentUrl.pathname.startsWith("/x/settings") ||
    currentUrl.pathname.startsWith("/x/users")
  ) {
    return true;
  }

  return defaultShouldRevalidate;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { accessToken, companyId, expiresAt, expiresIn, userId } =
    await requireAuthSession(request, { verify: true });

  // share a client between requests
  const client = getSupabase(accessToken);

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
    getUserClaims(userId),
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

  const transition = useNavigation();

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
    <SupabaseProvider session={session}>
      <RealtimeDataProvider>
        <TooltipProvider>
          <div className="min-h-full flex flex-col">
            <div className="flex-none" />
            <div className="h-screen min-h-[0px] basis-0 flex-1">
              <div className="flex h-full">
                <IconSidebar />
                <div className="flex w-full h-full">
                  <div className="w-full h-full flex-1 overflow-hidden">
                    <main className="h-full flex flex-col flex-1 max-w-[100vw] sm:max-w-[calc(100vw-56px)] overflow-x-hidden bg-muted">
                      <Topbar />
                      <main className="flex-1 overflow-y-auto max-h-[calc(100vh-49px)]">
                        <Outlet />
                      </main>
                    </main>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <Toaster richColors position="bottom-right" />
        </TooltipProvider>
      </RealtimeDataProvider>
    </SupabaseProvider>
  );
}
