import {
  ClientOnly,
  cn,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Separator,
  Toaster,
  TooltipProvider,
} from "@carbon/react";
import { Outlet, useLoaderData, useNavigation } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import NProgress from "nprogress";
import { useEffect, useState } from "react";

import { CarbonProvider, getCarbon, getCompanies, getUser } from "@carbon/auth";
import {
  destroyAuthSession,
  requireAuthSession,
} from "@carbon/auth/session.server";
import { LuActivity, LuClock, LuInbox } from "react-icons/lu";
import { AvatarMenu, Nav } from "~/components";
import { getActiveJobCount, getLocationsByCompany } from "~/services/jobs";
import {
  getLocationAndWorkCenter,
  setLocationAndWorkCenter,
} from "~/services/location.server";
import { defaultLayout } from "~/utils/layout";
import { path } from "~/utils/path";

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

  const [storedLocations, locations, activeEvents] = await Promise.all([
    getLocationAndWorkCenter(request, client, {
      companyId,
      userId,
    }),
    getLocationsByCompany(client, companyId),
    getActiveJobCount(client, {
      employeeId: userId,
      companyId,
    }),
  ]);

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
            "Set-Cookie": setLocationAndWorkCenter(
              storedLocations.location,
              storedLocations.workCenter
            ),
          },
        }
      : undefined
  );
}

export default function AuthenticatedRoute() {
  const { session, activeEvents, location, locations } =
    useLoaderData<typeof loader>();
  const [isCollapsed, setIsCollapsed] = useState(false);

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
    <CarbonProvider session={session}>
      <TooltipProvider delayDuration={0}>
        <ClientOnly fallback={null}>
          {() => (
            <ResizablePanelGroup
              direction="horizontal"
              className="h-full items-stretch"
            >
              <ResizablePanel
                defaultSize={defaultLayout[0]}
                collapsedSize={4}
                collapsible={true}
                minSize={15}
                maxSize={25}
                onCollapse={() => {
                  setIsCollapsed(true);
                }}
                onExpand={() => {
                  setIsCollapsed(false);
                }}
                className={cn(
                  isCollapsed &&
                    "min-w-[50px] transition-all duration-300 ease-in-out"
                )}
              >
                <div
                  className={cn(
                    "flex h-[52px] items-center justify-start bg-background",
                    isCollapsed ? "h-[52px]" : "px-2"
                  )}
                >
                  <div
                    className={cn("flex w-full items-center justify-center")}
                  >
                    <AvatarMenu
                      // company={company}
                      // companies={companies}
                      isCollapsed={isCollapsed}
                      location={location}
                      locations={locations}
                    />
                  </div>
                </div>
                <div className="flex flex-col h-[calc(100%-52px)] justify-between overflow-y-auto bg-background">
                  <div className="flex flex-col">
                    <Separator />
                    <Nav
                      isCollapsed={isCollapsed}
                      links={[
                        {
                          title: "Jobs",
                          icon: LuInbox,
                          to: path.to.jobs,
                        },
                        {
                          title: "Active",
                          icon: LuActivity,
                          label: (activeEvents ?? 0).toString(),
                          to: path.to.active,
                        },
                        {
                          title: "Recent",
                          icon: LuClock,
                          to: path.to.recent,
                        },
                      ]}
                    />
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <Outlet />
            </ResizablePanelGroup>
          )}
        </ClientOnly>
      </TooltipProvider>
      <Toaster position="bottom-right" />
    </CarbonProvider>
  );
}
