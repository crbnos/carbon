import {
  assertIsPost,
  callbackValidator,
  carbonClient,
  error,
  getCarbonServiceRole,
} from "@carbon/auth";
import { refreshAccessToken } from "@carbon/auth/auth.server";
import {
  commitAuthSession,
  destroyAuthSession,
  flash,
  getAuthSession,
} from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useFetcher } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useEffect, useRef } from "react";

import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);

  if (authSession) await destroyAuthSession(request);

  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const validation = await validator(callbackValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json(error(validation.error, "Invalid callback form"), {
      status: 400,
    });
  }

  const { refreshToken, userId } = validation.data;
  const carbonServiceClient = getCarbonServiceRole();
  const companies = await carbonServiceClient
    .from("userToCompany")
    .select("companyId")
    .eq("userId", userId);
  if (!companies.data || companies.data.length < 1) {
    return json(error(companies.error, "No companies found for user"), {
      status: 500,
    });
  }
  const authSession = await refreshAccessToken(
    refreshToken,
    companies.data?.[0].companyId
  );
  if (!authSession) {
    return redirect(
      path.to.root,
      await flash(request, error(authSession, "Invalid refresh token"))
    );
  }

  return redirect(path.to.authenticatedRoot, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, {
        authSession,
      }),
    },
  });
}

export default function AuthCallback() {
  const fetcher = useFetcher<{}>();
  const isAuthenticating = useRef(false);

  useEffect(() => {
    const {
      data: { subscription },
    } = carbonClient.auth.onAuthStateChange((event, carbonSession) => {
      if (
        ["SIGNED_IN", "INITIAL_SESSION"].includes(event) &&
        !isAuthenticating.current
      ) {
        isAuthenticating.current = true;

        // carbon sdk has ability to read url fragment that contains your token after third party provider redirects you here
        // this fragment url looks like https://.....#access_token=evxxxxxxxx&refresh_token=xxxxxx, and it's not readable server-side (Oauth security)
        // carbon auth listener gives us a user session, based on what it founds in this fragment url
        // we can't use it directly, client-side, because we can't access sessionStorage from here

        // we should not trust what's happen client side
        // so, we only pick the refresh token, and let's back-end getting user session from it
        const refreshToken = carbonSession?.refresh_token;
        const userId = carbonSession?.user.id;

        if (!refreshToken || !userId) return;

        const formData = new FormData();
        formData.append("refreshToken", refreshToken);
        formData.append("userId", userId);

        fetcher.submit(formData, { method: "post" });
      }
    });

    return () => {
      // prevent memory leak. Listener stays alive 👨‍🎤
      subscription.unsubscribe();
    };
  }, [fetcher]);

  return (
    <div className="flex flex-col items-center justify-center">
      <div>
        <img
          src="/carbon-logo-dark.png"
          alt="Carbon Logo"
          className="block dark:hidden max-w-[100px] mb-3"
        />
        <img
          src="/carbon-logo-light.png"
          alt="Carbon Logo"
          className="hidden dark:block max-w-[100px] mb-3"
        />
      </div>
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );
}
