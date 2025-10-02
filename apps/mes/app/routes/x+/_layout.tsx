import {
  CarbonEdition,
  CarbonProvider,
  CONTROLLED_ENVIRONMENT,
  getCarbon,
  getCompanies,
  getUser,
} from "@carbon/auth";
import {
  destroyAuthSession,
  requireAuthSession,
} from "@carbon/auth/session.server";
import { SidebarProvider, TooltipProvider, useMount } from "@carbon/react";
import {
  AcademyBanner,
  ItarPopup,
  useKeyboardWedge,
  useNProgress,
} from "@carbon/remix";
import { getStripeCustomerByCompanyId } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import type { ShouldRevalidateFunction } from "@remix-run/react";
import { Outlet, useLoaderData, useNavigate } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import posthog from "posthog-js";
import { AppSidebar } from "~/components";
import RealtimeDataProvider from "~/components/RealtimeDataProvider";
import { getLocation, setLocation } from "~/services/location.server";
import {
  getActiveJobCount,
  getLocationsByCompany,
} from "~/services/operations.service";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

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

  let [storedLocations, companyPlan, locations, activeEvents] =
    await Promise.all([
      getLocation(request, client, {
        companyId,
        userId,
      }),
      getStripeCustomerByCompanyId(companyId),
      getLocationsByCompany(client, companyId),
      getActiveJobCount(client, {
        employeeId: userId,
        companyId,
      }),
    ]);

  if (!companyPlan && CarbonEdition === Edition.Cloud) {
    throw redirect(path.to.onboarding);
  }

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
      plan: companyPlan?.planId,
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
  const {
    session,
    activeEvents,
    company,
    companies,
    location,
    locations,
    user,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  useNProgress();
  useKeyboardWedge({
    test: (input) => input.startsWith("http"),
    callback: (input) => {
      try {
        const url = new URL(input);
        navigate(url.pathname + url.search);
      } catch {
        navigate(input);
      }
    },
  });

  useMount(() => {
    posthog.identify(user?.id, {
      email: user?.email,
      name: `${user?.firstName} ${user?.lastName}`,
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
                {user?.acknowledgedUniversity ? null : (
                  <AcademyBanner acknowledgeAction={path.to.acknowledge} />
                )}

                <AppSidebar
                  activeEvents={activeEvents}
                  company={company}
                  companies={companies}
                  location={location}
                  locations={locations}
                />
                <Outlet />
              </TooltipProvider>
            </SidebarProvider>
          </RealtimeDataProvider>
        </CarbonProvider>
      )}
    </div>
  );
}
