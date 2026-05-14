import {
  CarbonEdition,
  CarbonProvider,
  CONTROLLED_ENVIRONMENT,
  getCarbon,
  getMESUrl
} from "@carbon/auth";
import { setCompanyId } from "@carbon/auth/company.server";
import {
  destroyAuthSession,
  requireAuthSession,
  updateCompanySession
} from "@carbon/auth/session.server";
import { isAuditLogEnabled } from "@carbon/database/audit";
import {
  ItarPopup,
  TooltipProvider,
  useKeyboardWedge,
  useMount,
  useNProgress
} from "@carbon/react";
import { getStripeCustomerByCompanyId } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import posthog from "posthog-js";
import { Suspense } from "react";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import {
  Await,
  data,
  Outlet,
  redirect,
  useLoaderData,
  useNavigate
} from "react-router";
import { RealtimeDataProvider } from "~/components";
import { PrimaryNavigation, Topbar } from "~/components/Layout";
import { TimeCardWarning } from "~/components/TimeCardWarning";
import TrainingPanel from "~/components/TrainingPanel";
import { useTrainingPanel } from "~/hooks/useTrainingPanel";
import { getOpenClockEntry } from "~/modules/people";
import {
  getCompanies,
  getCompanyIntegrations,
  getCompanySettings
} from "~/modules/settings";
import { getCustomFieldsSchemas } from "~/modules/shared/shared.server";
import {
  getSavedViews,
  isApprovalRequired
} from "~/modules/shared/shared.service";
import {
  getModulePreferences,
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
  const authSession = await requireAuthSession(request, { verify: true });
  const { accessToken, companyId, expiresAt, expiresIn, userId } = authSession;

  // Block ERP access when console mode is active on this terminal.
  // Console terminals should only access the MES app.
  if (authSession.console) {
    throw redirect(getMESUrl());
  }

  // const { computeRegion, proxyRegion } = parseVercelId(
  //   request.headers.get("x-vercel-id")
  // );

  // console.log({
  //   computeRegion,
  //   proxyRegion,
  // });

  const client = getCarbon(accessToken);

  // Parallelize all requests
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
    auditLogEnabled,
    modulePreferences
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
    getUserDefaults(client, userId, companyId),
    isAuditLogEnabled(client, companyId),
    getModulePreferences(client, userId, companyId)
  ]);

  if (!claims || user.error || !user.data || !groups.data) {
    throw await destroyAuthSession(request);
  }

  let company = companies.data?.find((c) => c.companyId === companyId);

  if (!company && companies.data?.length) {
    company = companies.data[0];
    const sessionCookie = await updateCompanySession(
      request,
      company.id!,
      company.companyGroupId ?? ""
    );
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

  return data({
    session: {
      accessToken,
      expiresIn,
      expiresAt
    },
    auditLogEnabled,
    company,
    companies: companies.data ?? [],
    companySettings: companySettings.data ?? null,
    customFields: customFields.data ?? [],
    defaults: defaults.data,
    integrations: integrations.data ?? [],
    groups: groups.data,
    permissions: claims?.permissions,
    plan: stripeCustomer?.planId,
    role: claims?.role,
    user: user.data,
    modulePreferences: modulePreferences.data ?? [],
    savedViews: savedViews.data ?? [],
    supplierApprovalRequired: isApprovalRequired(client, "supplier", companyId),
    openClockEntry: companySettings.data?.timeCardEnabled
      ? getOpenClockEntry(client, userId, companyId)
      : null
  });
}

export default function AuthenticatedRoute() {
  const { session, user, companySettings, openClockEntry } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { isOpen, training, dismiss } = useTrainingPanel();

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
              <TrainingPanel
                training={training}
                isOpen={isOpen}
                onDismiss={dismiss}
              />
              {companySettings?.timeCardEnabled && (
                <Suspense fallback={null}>
                  <Await resolve={openClockEntry}>
                    {(resolved) => (
                      <TimeCardWarning
                        openClockEntry={
                          resolved?.data
                            ? {
                                id: resolved.data.id,
                                clockIn: resolved.data.clockIn
                              }
                            : null
                        }
                      />
                    )}
                  </Await>
                </Suspense>
              )}
            </TooltipProvider>
          </RealtimeDataProvider>
        </CarbonProvider>
      )}
    </div>
  );
}
