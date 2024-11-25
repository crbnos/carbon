import { CarbonProvider, getCarbon, getCompanies, getUser } from "@carbon/auth";
import {
  destroyAuthSession,
  requireAuthSession,
} from "@carbon/auth/session.server";
import { SidebarInset, SidebarProvider, TooltipProvider } from "@carbon/react";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { Outlet, useLoaderData, useNavigation } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import NProgress from "nprogress";
import { useEffect } from "react";
import { AppSidebar } from "~/components";
import RealtimeDataProvider from "~/components/RealtimeDataProvider";
import { getLocation, setLocation } from "~/services/location.server";
import {
  getActiveJobCount,
  getLocationsByCompany,
} from "~/services/operations.service";
import { path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  defaultShouldRevalidate,
}) => {
  if (
    currentUrl.pathname.startsWith("/refresh-session") ||
    currentUrl.pathname.startsWith("/switch-company")
  ) {
    return true;
  }

  return defaultShouldRevalidate;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { accessToken, companyId, expiresAt, expiresIn, userId } =
    await requireAuthSession(request, { verify: true });

  // share a client between requests
  const client = getCarbon(accessToken);

  // parallelize the requests
  const [companies, user] = await Promise.all([
    getCompanies(client, userId),
    getUser(client, userId),
  ]);

  if (user.error || !user.data) {
    await destroyAuthSession(request);
  }

  const company = companies.data?.find((c) => c.companyId === companyId);
  if (!company) {
    throw redirect(path.to.accountSettings);
  }

  let [storedLocations, locations, activeEvents] = await Promise.all([
    getLocation(request, client, {
      companyId,
      userId,
    }),
    getLocationsByCompany(client, companyId),
    getActiveJobCount(client, {
      employeeId: userId,
      companyId,
    }),
  ]);

  if (!locations.data || locations.data.length === 0) {
    throw new Error(`No locations found for ${company.name}`);
  }

  return json(
    {
      session: {
        accessToken,
        expiresIn,
        expiresAt,
      },
      activeEvents: activeEvents.data ?? 0,
      company,
      companies: companies.data ?? [],
      location: storedLocations.location,
      locations: locations.data ?? [],
      user: user.data,
    },
    storedLocations.updated
      ? {
          headers: {
            "Set-Cookie": setLocation(companyId, storedLocations.location),
          },
        }
      : undefined
  );
}

export default function AuthenticatedRoute() {
  const { session, activeEvents, company, companies, location, locations } =
    useLoaderData<typeof loader>();

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
    <div className="h-screen w-screen overflow-y-auto md:overflow-hidden">
      <CarbonProvider session={session}>
        <RealtimeDataProvider>
          <SidebarProvider defaultOpen={false}>
            <TooltipProvider delayDuration={0}>
              <AppSidebar
                activeEvents={activeEvents}
                company={company}
                companies={companies}
                location={location}
                locations={locations}
              />
              <SidebarInset className="bg-card">
                <Outlet />
              </SidebarInset>
            </TooltipProvider>
          </SidebarProvider>
        </RealtimeDataProvider>
      </CarbonProvider>
    </div>
  );
}
