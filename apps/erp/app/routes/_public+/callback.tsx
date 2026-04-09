import {
  assertIsPost,
  CONTROLLED_ENVIRONMENT,
  callbackValidator,
  carbonClient,
  error
} from "@carbon/auth";
import { refreshAccessToken } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import {
  destroyAuthSession,
  flash,
  getAuthSession,
  setAuthSession
} from "@carbon/auth/session.server";
import { getUserByEmail } from "@carbon/auth/users.server";
import { validator } from "@carbon/form";
import { Alert, AlertDescription, AlertTitle, cn, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useFetcher, useLocation } from "react-router";
import { getRequestI18n } from "~/services/request-i18n.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);

  if (authSession) await destroyAuthSession(request);

  return {};
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const i18n = await getRequestI18n(request);

  const validation = await validator(callbackValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(error(validation.error, i18n._(msg`Invalid callback form`)), {
      status: 400
    });
  }

  const { refreshToken, userId } = validation.data;
  const serviceRole = getCarbonServiceRole();

  const companies = await serviceRole
    .from("userToCompany")
    .select("companyId")
    .eq("userId", userId);

  const authSession = await refreshAccessToken(
    refreshToken,
    companies.data?.[0]?.companyId
  );

  if (!authSession) {
    return redirect(
      path.to.root,
      await flash(
        request,
        error(authSession, i18n._(msg`Invalid refresh token`))
      )
    );
  }

  const user = await getUserByEmail(authSession.email);

  if (user?.data) {
    const sessionCookie = await setAuthSession(request, {
      authSession
    });
    const companyIdCookie = setCompanyId(authSession.companyId);
    return redirect(path.to.authenticatedRoot, {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    });
  } else {
    return redirect(
      path.to.root,
      await flash(request, error(user.error, i18n._(msg`User not found`)))
    );
  }
}

export default function AuthCallback() {
  const fetcher = useFetcher<{}>();
  const isAuthenticating = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const { hash } = useLocation();

  useEffect(() => {
    const hashParams = new URLSearchParams(hash.slice(1));
    const errorDescription = hashParams.get("error_description");
    if (errorDescription) {
      setError(decodeURIComponent(errorDescription.replace(/\+/g, " ")));
    }
  }, [hash]);

  useEffect(() => {
    const {
      data: { subscription }
    } = carbonClient.auth.onAuthStateChange((event, session) => {
      if (
        ["SIGNED_IN", "INITIAL_SESSION"].includes(event) &&
        !isAuthenticating.current
      ) {
        isAuthenticating.current = true;

        const refreshToken = session?.refresh_token;
        const userId = session?.user.id;

        if (!refreshToken || !userId) return;

        const formData = new FormData();
        formData.append("refreshToken", refreshToken);
        formData.append("userId", userId);

        fetcher.submit(formData, { method: "post" });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetcher]);

  return (
    <div className="flex flex-col items-center justify-center">
      {error ? (
        <div className="rounded-lg md:bg-card md:border md:border-border md:shadow-lg p-8 mt-8 w-[380px]">
          <VStack spacing={4}>
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            {error.includes("expired") && (
              <>
                <p className="text-sm text-muted-foreground">
                  Something went wrong. Please try again.
                </p>
              </>
            )}
          </VStack>
        </div>
      ) : (
        <div
          className={cn(
            "hexagon-loader-container",
            CONTROLLED_ENVIRONMENT && "grayscale"
          )}
        >
          <div className="hexagon-loader">
            <div className="hexagon" />
            <div className="hexagon" />
            <div className="hexagon" />
          </div>
        </div>
      )}
    </div>
  );
}
