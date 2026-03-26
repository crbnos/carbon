import {
  CarbonEdition,
  CarbonProvider,
  CONTROLLED_ENVIRONMENT,
  getCarbon,
  getCompanies,
  getUser
} from "@carbon/auth";

import {
  destroyAuthSession,
  requireAuthSession
} from "@carbon/auth/session.server";
import { SidebarProvider, TooltipProvider, useMount } from "@carbon/react";
import { ItarPopup, useKeyboardWedge, useNProgress } from "@carbon/remix";
import { getStripeCustomerByCompanyId } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import posthog from "posthog-js";
import type {
  LoaderFunctionArgs,
  MiddlewareFunction,
  ShouldRevalidateFunction
} from "react-router";
import {
  data,
  Outlet,
  redirect,
  useLoaderData,
  useNavigate
} from "react-router";
import { AppSidebar } from "~/components";
import RealtimeDataProvider from "~/components/RealtimeDataProvider";
import { TimeCardWarning } from "~/components/TimeCardWarning";
import { userContext } from "~/context";
import { userMiddleware } from "~/middleware/user";
import { getActiveMaintenanceEventsCount } from "~/services/maintenance.service";
import {
  getActiveJobCount,
  getLocationsByCompany
} from "~/services/operations.service";
import {
  endOpenBreakOnLogin,
  ensureDailyAutoClockIn,
  getOpenClockEntry,
  getOpenTimeCardBreak
} from "~/services/people.service";
import { ERP_URL, MES_URL, path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  defaultShouldRevalidate
}) => {
  if (
    currentUrl.pathname.startsWith("/refresh-session") ||
    currentUrl.pathname.startsWith("/switch-company")
  ) {
    return true;
  }

  return defaultShouldRevalidate;
};

export const middleware: MiddlewareFunction[] = [userMiddleware];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { accessToken, companyId, expiresAt, expiresIn, userId } =
    await requireAuthSession(request, { verify: true });

  // share a client between requests
  const client = getCarbon(accessToken);

  // parallelize the requests
  const [companies, user] = await Promise.all([
    getCompanies(client, userId),
    getUser(client, userId)
  ]);

  if (user.error || !user.data) {
    await destroyAuthSession(request);
  }

  const company = companies.data?.find((c) => c.companyId === companyId);
  if (!company) {
    throw redirect(path.to.accountSettings);
  }

  // Get the location from middleware context
  const locationId = context.get(userContext)?.locationId;

  let [
    companyPlan,
    locations,
    activeEvents,
    companySettings,
    openClockEntry,
    openBreak
  ] = await Promise.all([
    getStripeCustomerByCompanyId(companyId, userId),
    getLocationsByCompany(client, companyId),
    getActiveJobCount(client, {
      employeeId: userId,
      companyId
    }),
    client
      .from("companySettings")
      .select("timeCardEnabled")
      .eq("id", companyId)
      .single(),
    getOpenClockEntry(client, userId, companyId),
    getOpenTimeCardBreak(client, userId, companyId)
  ]);

  if (companySettings.data?.timeCardEnabled && openBreak.data) {
    const resumedAt = new Date().toISOString();

    await endOpenBreakOnLogin(client as any, {
      employeeId: userId,
      companyId,
      endedBy: userId,
      endTime: resumedAt
    });

    await ensureDailyAutoClockIn(client as any, {
      employeeId: userId,
      companyId,
      createdBy: userId,
      loginAt: resumedAt,
      timeZone: "UTC",
      forceNewSession: true
    });

    openClockEntry = await getOpenClockEntry(client, userId, companyId);
  }

  // Get active maintenance count after we have the location
  const activeMaintenanceCount = await getActiveMaintenanceEventsCount(
    client,
    locationId
  );

  if (!companyPlan && CarbonEdition === Edition.Cloud) {
    throw redirect(path.to.onboarding);
  }

  if (!locations.data || locations.data.length === 0) {
    throw new Error(`No locations found for ${company.name}`);
  }

  return data({
    session: {
      accessToken,
      expiresIn,
      expiresAt
    },
    activeEvents: activeEvents.data ?? 0,
    activeMaintenanceCount: activeMaintenanceCount.count ?? 0,
    company,
    companies: companies.data ?? [],
    location: locationId,
    locations: locations.data ?? [],
    plan: companyPlan?.planId,
    user: user.data,
    timeCardEnabled: companySettings.data?.timeCardEnabled ?? false,
    openClockEntry: openClockEntry.data
      ? { id: openClockEntry.data.id, clockIn: openClockEntry.data.clockIn }
      : null,
    openBreak: openBreak.data
      ? {
          id: openBreak.data.id,
          startTime: openBreak.data.startTime,
          breakType: openBreak.data.breakType
        }
      : null
  });
}

export default function AuthenticatedRoute() {
  const {
    session,
    activeEvents,
    activeMaintenanceCount,
    company,
    companies,
    location,
    locations,
    user,
    timeCardEnabled,
    openClockEntry,
    openBreak
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  useNProgress();
  useKeyboardWedge({
    test: (input) =>
      (input.startsWith(MES_URL) || input.startsWith(ERP_URL)) &&
      !input.includes("/kanban/complete/"), // we handle this more gracefully in JobOperation
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
    posthog.identify(user?.id, {
      email: user?.email,
      name: `${user?.firstName} ${user?.lastName}`
    });
  });

  return (
    <div className="h-screen w-screen overflow-y-auto md:overflow-hidden">
      {user?.acknowledgedITAR === false && CONTROLLED_ENVIRONMENT ? (
        <ItarPopup
          acknowledgeAction={path.to.acknowledge}
          logoutAction={path.to.logout}
        />
      ) : (
        <CarbonProvider session={session}>
          <RealtimeDataProvider>
            <SidebarProvider defaultOpen={false}>
              <TooltipProvider delayDuration={0}>
                <AppSidebar
                  activeEvents={activeEvents}
                  activeMaintenanceCount={activeMaintenanceCount}
                  company={company}
                  companies={companies}
                  location={location}
                  locations={locations}
                  timeCardEnabled={timeCardEnabled}
                  openClockEntry={openClockEntry}
                  openBreak={openBreak}
                />
                <Outlet />
                {timeCardEnabled && (
                  <TimeCardWarning openClockEntry={openClockEntry} />
                )}
              </TooltipProvider>
            </SidebarProvider>
          </RealtimeDataProvider>
        </CarbonProvider>
      )}
    </div>
  );
}
