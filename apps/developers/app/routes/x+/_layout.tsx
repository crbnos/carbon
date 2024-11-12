import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  Toaster,
} from "@carbon/react";
import { Outlet, useLoaderData, useNavigation } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import NProgress from "nprogress";
import { useEffect } from "react";

import {
  CarbonProvider,
  getCarbon,
  getCompanies,
  getUser,
  VERCEL_URL,
} from "@carbon/auth";
import {
  destroyAuthSession,
  requireAuthSession,
} from "@carbon/auth/session.server";

import { AppSidebar } from "~/components/AppSidebar";
import Breadcrumbs from "~/components/Breadcrumbs";
import { path } from "~/utils/path";

export const ERP_URL = VERCEL_URL?.includes("localhost")
  ? "http://localhost:3000"
  : `https://app.carbonos.dev`;

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

  if (!user.data?.developer) {
    throw redirect(path.to.requestAccess);
  }

  const company = companies.data?.find((c) => c.companyId === companyId);
  if (!company) {
    throw redirect(ERP_URL);
  }

  return json({
    session: {
      accessToken,
      expiresIn,
      expiresAt,
    },
    company,
    companies: companies.data ?? [],
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
    <CarbonProvider session={session}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Breadcrumbs />
            </div>
          </header>
          <div className="flex flex-1 flex-col">
            <div className="min-h-[100vh] flex-1 rounded-xl bg-muted/50 md:min-h-min">
              <Outlet />
            </div>
          </div>
        </SidebarInset>
        <Toaster position="bottom-right" />
      </SidebarProvider>
    </CarbonProvider>
  );
}
