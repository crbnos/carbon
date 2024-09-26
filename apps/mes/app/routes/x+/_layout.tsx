import { Toaster, TooltipProvider } from "@carbon/react";
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
import { PrimaryNavigation } from "~/components";

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
      <TooltipProvider>
        <div className="min-h-full flex flex-col">
          <div className="flex-none" />
          <div className="h-screen min-h-[0px] basis-0 flex-1">
            <div className="flex h-full">
              <PrimaryNavigation />
              <div className="flex w-full h-full">
                <div className="w-full h-full flex-1 overflow-hidden">
                  <main className="h-full flex flex-col flex-1 max-w-[100vw] sm:max-w-[calc(100vw-56px)] overflow-x-hidden bg-muted">
                    <main className="flex-1 overflow-y-auto max-h-[calc(100vh-49px)]">
                      <Outlet />
                    </main>
                  </main>
                </div>
              </div>
            </div>
          </div>
        </div>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </CarbonProvider>
  );
}
