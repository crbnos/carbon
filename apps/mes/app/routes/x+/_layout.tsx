import {
  CarbonEdition,
  CarbonProvider,
  CONTROLLED_ENVIRONMENT,
  getCarbon,
  getCompanies,
  getUser
} from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  destroyAuthSession,
  requireAuthSession
} from "@carbon/auth/session.server";
import type { PrintingSettings } from "@carbon/printing";
import { getPrinterRoutes } from "@carbon/printing";
import { PrintingProvider } from "@carbon/printing/ui";
import {
  ItarPopup,
  SidebarProvider,
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
  MiddlewareFunction,
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
import { AppSidebar } from "~/components";
import { ConsolePill } from "~/components/ConsolePill";
import { PinInOverlay } from "~/components/PinInOverlay";
import RealtimeDataProvider from "~/components/RealtimeDataProvider";
import { TimeCardWarning } from "~/components/TimeCardWarning";
import { userContext } from "~/context";
import { userMiddleware } from "~/middleware/user";
import { refreshConsolePinIn } from "~/services/console.server";
import { getActiveMaintenanceEventsCount } from "~/services/maintenance.service";
import {
  getActiveJobCount,
  getLocationsByCompany
} from "~/services/operations.service";
import { getOpenClockEntry } from "~/services/people.service";
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

  // Get the location and console state from middleware context
  const ctx = context.get(userContext);
  const locationId = ctx?.locationId;
  const consoleMode = ctx?.consoleMode ?? false;
  const pinnedInUser = ctx?.pinnedInUser ?? null;
  const effectiveUserId = ctx?.effectiveUserId ?? userId;

  const serviceRole = getCarbonServiceRole();

  let [
    companyPlan,
    locations,
    activeEvents,
    companySettings,
    openClockEntry,
    locationEmployees,
    printerRoutes
  ] = await Promise.all([
    getStripeCustomerByCompanyId(companyId, userId),
    getLocationsByCompany(client, companyId),
    getActiveJobCount(client, {
      employeeId: effectiveUserId,
      companyId
    }),
    client
      .from("companySettings")
      .select("timeCardEnabled, consoleEnabled, printing, useMetric")
      .eq("id", companyId)
      .single(),
    getOpenClockEntry(client, effectiveUserId, companyId),
    // Get employees at current location for console mode pin-in filtering
    consoleMode && locationId
      ? serviceRole
          .from("employeeJob")
          .select("id")
          .eq("locationId", locationId)
          .eq("companyId", companyId)
      : Promise.resolve({ data: [] as { id: string }[] }),
    getPrinterRoutes(serviceRole, companyId)
  ]);

  const locationEmployeeIds =
    locationEmployees.data?.map((e: { id: string }) => e.id) ?? [];
  const timeCardEnabled = companySettings.data?.timeCardEnabled ?? false;
  const consoleEnabled = companySettings.data?.consoleEnabled ?? false;

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

  // Sliding window: refresh pin-in cookie on every page load
  const headers = new Headers();
  if (pinnedInUser && ctx) {
    headers.append(
      "Set-Cookie",
      refreshConsolePinIn(companyId, {
        userId: pinnedInUser.userId,
        name: pinnedInUser.name,
        avatarUrl: pinnedInUser.avatarUrl,
        pinnedAt: Date.now()
      })
    );
  }

  return data(
    {
      session: {
        accessToken,
        expiresIn,
        expiresAt
      },
      activeEvents: activeEvents.data ?? 0,
      activeMaintenanceCount: activeMaintenanceCount.count ?? 0,
      company,
      companies: companies.data ?? [],
      consoleEnabled,
      consoleMode: consoleEnabled && consoleMode,
      location: locationId,
      locationEmployeeIds,
      locations: locations.data ?? [],
      openClockEntry: openClockEntry?.data
        ? getOpenClockEntry(client, userId, companyId)
        : null,
      effectiveUserId,
      pinnedInUser,
      plan: companyPlan?.planId,
      printing:
        (companySettings.data?.printing as PrintingSettings | null) ?? null,
      printerRoutes: printerRoutes.data ?? [],
      timeCardEnabled,
      useMetric: companySettings.data?.useMetric ?? false,
      user: user.data
    },
    headers.has("Set-Cookie") ? { headers } : undefined
  );
}

export default function AuthenticatedRoute() {
  const {
    session,
    activeEvents,
    activeMaintenanceCount,
    company,
    companies,
    consoleEnabled,
    consoleMode,
    location,
    locationEmployeeIds,
    locations,
    openClockEntry,
    pinnedInUser,
    printing,
    printerRoutes,
    timeCardEnabled,
    useMetric,
    user
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
          <PrintingProvider
            value={{
              printing,
              printerRoutes,
              useMetric,
              printPath: path.to.manualPrint,
              settingsPath: path.to.printingSettings,
              settingsExternal: true
            }}
          >
            <RealtimeDataProvider>
              <SidebarProvider defaultOpen={false} touch>
                <TooltipProvider delayDuration={0}>
                  <AppSidebar
                    activeEvents={activeEvents}
                    activeMaintenanceCount={activeMaintenanceCount}
                    company={company}
                    companies={companies}
                    consoleEnabled={consoleEnabled}
                    consoleMode={consoleMode}
                    location={location}
                    locations={locations}
                    openClockEntry={openClockEntry}
                    pinnedInUser={pinnedInUser}
                    timeCardEnabled={timeCardEnabled}
                  />
                  <Outlet />
                  {timeCardEnabled && (
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
                  {consoleMode && !pinnedInUser && (
                    <PinInOverlay
                      companyId={company.companyId!}
                      locationEmployeeIds={locationEmployeeIds}
                      sessionUserId={user?.id ?? ""}
                      hasPinnedUser={false}
                    />
                  )}
                  {consoleMode && pinnedInUser && (
                    <ConsolePill
                      user={pinnedInUser}
                      companyId={company.companyId!}
                      locationEmployeeIds={locationEmployeeIds}
                      sessionUserId={user?.id ?? ""}
                    />
                  )}
                </TooltipProvider>
              </SidebarProvider>
            </RealtimeDataProvider>
          </PrintingProvider>
        </CarbonProvider>
      )}
    </div>
  );
}
