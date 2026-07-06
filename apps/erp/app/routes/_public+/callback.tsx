import {
  assertIsPost,
  callbackValidator,
  carbonClient,
  error,
  safeRedirect
} from "@carbon/auth";
import { refreshAccessToken } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyId, setCompanyId } from "@carbon/auth/company.server";
import {
  destroyAuthSession,
  flash,
  getAuthSession,
  setAuthSession
} from "@carbon/auth/session.server";
import { getUserByEmail } from "@carbon/auth/users.server";
import { validator } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  LoadingBars,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLocation,
  useSearchParams
} from "react-router";
import { getCompanies, getEmployeeCompanies } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);

  if (authSession) await destroyAuthSession(request);

  return {};
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const validation = await validator(callbackValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(error(validation.error, "Invalid callback form"), {
      status: 400
    });
  }

  const { refreshToken, userId, redirectTo } = validation.data;
  const serviceRole = getCarbonServiceRole();

  // Pre-session: no user-authed client yet, so query memberships with the
  // service role. Prefer an employee company as the active one; fall back to
  // any membership so auth/RLS can deny a pure portal user later.
  const employeeCompanies =
    (await getEmployeeCompanies(serviceRole, userId)).data ?? [];
  const pickable = employeeCompanies.length
    ? employeeCompanies
    : ((await getCompanies(serviceRole, userId)).data ?? []);

  const cookieCompanyId = getCompanyId(request);
  const match =
    pickable.find((c) => c.companyId === cookieCompanyId) ?? pickable[0];
  const companyId = match?.companyId ?? undefined;
  const companyGroupId = match?.companyGroupId ?? "";

  const authSession = await refreshAccessToken(
    refreshToken,
    companyId,
    companyGroupId
  );

  if (!authSession) {
    return redirect(
      path.to.root,
      await flash(request, error(authSession, "Invalid refresh token"))
    );
  }

  const user = await getUserByEmail(authSession.email);

  if (user?.data) {
    const sessionCookie = await setAuthSession(request, {
      authSession
    });
    const headers: [string, string][] = [["Set-Cookie", sessionCookie]];

    // Only finalize the active company for single-company (and portal-only)
    // users. Multi-company users must actively choose: we leave the companyId
    // cookie unset and let x+/_layout bounce them to the picker — its presence
    // is the "has chosen this session" marker. This keeps all picker/enforcement
    // logic in one place instead of duplicating the redirect here.
    if (employeeCompanies.length <= 1) {
      headers.push(["Set-Cookie", setCompanyId(authSession.companyId)]);
    }

    return redirect(safeRedirect(redirectTo, path.to.authenticatedRoot), {
      headers
    });
  } else {
    return redirect(
      path.to.root,
      await flash(request, error(user.error, "User not found"))
    );
  }
}

export default function AuthCallback() {
  const fetcher = useFetcher<{}>();
  const isAuthenticating = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const { hash } = useLocation();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;

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
        if (redirectTo) formData.append("redirectTo", redirectTo);

        fetcher.submit(formData, { method: "post" });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetcher, redirectTo]);

  return (
    <div className="flex flex-col items-center justify-center">
      {error ? (
        <div className="rounded-lg md:bg-card md:border md:border-border md:shadow-lg p-8 mt-8 w-[380px]">
          <VStack spacing={4}>
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Error</Trans>
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            {error.includes("expired") && (
              <>
                <p className="text-sm text-muted-foreground">
                  <Trans>Something went wrong. Please try again.</Trans>
                </p>
              </>
            )}
          </VStack>
        </div>
      ) : (
        <LoadingBars />
      )}
    </div>
  );
}
