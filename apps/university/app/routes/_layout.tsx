import { Outlet, useLoaderData, useNavigation } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import NProgress from "nprogress";
import { useEffect } from "react";

import { CarbonProvider, getCarbon } from "@carbon/auth";
import { getAuthSession } from "@carbon/auth/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getAuthSession(request);

  let user = null;

  console.log("session", session);

  if (session) {
    const client = getCarbon(session.accessToken);

    const authUser = await client
      .from("user")
      .select("*")
      .eq("id", session.userId)
      .single();

    console.log("authUser", authUser);

    if (authUser.data) {
      user = authUser.data;
    }
  }

  return json({ session, user });
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

  if (!session) {
    return <Outlet />;
  }

  return (
    <CarbonProvider session={session}>
      <Outlet />
    </CarbonProvider>
  );
}
