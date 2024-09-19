import { Toaster, TooltipProvider } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useNavigation } from "@remix-run/react";
import NProgress from "nprogress";
import { useEffect } from "react";

import { Topbar } from "~/components/Layout";
import { PrimaryNavigation } from "~/components/Navigation";
import { VERCEL_URL } from "~/config/env";
import { SupabaseProvider, getSupabase } from "~/lib/supabase";
import { getCompanies, getUser } from "~/services/auth/auth.server";
import {
  destroyAuthSession,
  requireAuthSession,
} from "~/services/session.server";
import { path, removeSubdomain } from "~/utils/path";

export const APP_URL = VERCEL_URL?.includes("localhost")
  ? "http://localhost:3000"
  : `https://app.${removeSubdomain(VERCEL_URL)}`;

export async function loader({ request }: LoaderFunctionArgs) {
  const { accessToken, companyId, expiresAt, expiresIn, userId } =
    await requireAuthSession(request, { verify: true });

  // share a client between requests
  const client = getSupabase(accessToken);

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
    throw redirect(APP_URL);
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
    <SupabaseProvider session={session}>
      <TooltipProvider>
        <div className="min-h-full flex flex-col">
          <div className="flex-none" />
          <div className="h-screen min-h-[0px] basis-0 flex-1">
            <div className="flex h-full">
              <PrimaryNavigation />
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
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </SupabaseProvider>
  );
}
