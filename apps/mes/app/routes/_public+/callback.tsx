import {
  assertIsPost,
  callbackValidator,
  carbonClient,
  error
} from "@carbon/auth";
import { refreshAccessToken } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { userHasVerifiedTotpFactor } from "@carbon/auth/mfa.server";
import {
  destroyAuthSession,
  flash,
  getAuthSession,
  setAuthSession,
  setPendingMfaSession
} from "@carbon/auth/session.server";
import { getUserByEmail } from "@carbon/auth/users.server";
import {
  getSsoConnectionByProviderId,
  getSsoProviderIdFromSession,
  isSsoEnabled,
  isSsoRequiredForEmail
} from "@carbon/ee/sso.server";
import { validator } from "@carbon/form";
import { AccountLockout, redis } from "@carbon/kv";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  LoadingBars,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, redirect, useFetcher, useLocation } from "react-router";
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

  const { refreshToken, userId } = validation.data;
  const serviceRole = getCarbonServiceRole();
  const companies = await serviceRole
    .from("userToCompany")
    .select("companyId, ...company(companyGroupId)")
    .eq("userId", userId);

  const firstCompany = companies.data?.[0] as
    | { companyId: string; companyGroupId: string | null }
    | undefined;
  const companyId = firstCompany?.companyId;
  const companyGroupId = firstCompany?.companyGroupId ?? "";

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

  // ── SSO branch ─────────────────────────────────────────────────────────
  // Mirrors the ERP callback's enforcement (provider → company binding +
  // registered email domain), but MES runs no invite migration: a first SSO
  // login must happen in the ERP, which owns the invite-accept transaction.
  // Outside Enterprise the classification (and its admin API call) is skipped.
  let ssoProviderId: string | null = null;
  if (isSsoEnabled()) {
    const authUser = await serviceRole.auth.admin.getUserById(userId);
    ssoProviderId = authUser.data?.user
      ? getSsoProviderIdFromSession(authSession.accessToken, authUser.data.user)
      : null;
  }

  if (ssoProviderId) {
    const connection = await getSsoConnectionByProviderId(
      serviceRole,
      ssoProviderId
    );
    if (!connection.data) {
      return redirect(
        path.to.root,
        await flash(
          request,
          error(
            connection.error,
            "SAML SSO connection is not active. Contact your administrator."
          )
        )
      );
    }

    const emailDomain = authSession.email.split("@")[1]?.toLowerCase() ?? "";
    if (!connection.data.domains.includes(emailDomain)) {
      return redirect(
        path.to.root,
        await flash(
          request,
          error(
            null,
            "SAML SSO sign-in rejected: this email domain is not registered for your company's SAML SSO connection."
          )
        )
      );
    }

    const ssoCompanyId = connection.data.companyId;
    const isMember = (companies.data ?? []).some(
      (c) => c.companyId === ssoCompanyId
    );
    if (!isMember) {
      return redirect(
        path.to.root,
        await flash(
          request,
          error(
            null,
            "Complete your first SAML SSO sign-in in Carbon ERP, then return here."
          )
        )
      );
    }

    const ssoCompany = await serviceRole
      .from("company")
      .select("companyGroupId")
      .eq("id", ssoCompanyId)
      .maybeSingle();
    authSession.companyId = ssoCompanyId;
    authSession.companyGroupId = ssoCompany.data?.companyGroupId ?? "";
    authSession.ssoProviderId = ssoProviderId;

    await new AccountLockout({ redis }).reset(authSession.email);

    // The IdP owns MFA for SSO sessions, including controlled environments
    // (user decision — attestation shifts to the IdP policy).
    authSession.mfaVerified = true;

    const ssoSessionCookie = await setAuthSession(request, { authSession });
    return redirect(path.to.authenticatedRoot, {
      headers: [
        ["Set-Cookie", ssoSessionCookie],
        ["Set-Cookie", setCompanyId(ssoCompanyId)]
      ]
    });
  }

  const user = await getUserByEmail(authSession.email);

  if (user?.data) {
    // Require-SSO gate: this is the non-SSO path (magic link, Google/Azure
    // OAuth, magic links minted elsewhere) — a covered + enforced domain may
    // only authenticate via SSO, so refuse before any session state is minted.
    if (await isSsoRequiredForEmail(serviceRole, authSession.email)) {
      return redirect(
        path.to.root,
        await flash(
          request,
          error(
            null,
            "Your organization requires single sign-on. Sign in with your work email to continue."
          )
        )
      );
    }

    // Genuine login (magic-link / OAuth first factor verified) — clear any
    // accumulated per-account lockout state (NIST 3.1.8 reset-on-success). Runs
    // before the TOTP gate so an MFA-enrolled user's counter clears too.
    await new AccountLockout({ redis }).reset(authSession.email);

    // TOTP gate: park the tokens in the pending-MFA key and challenge before
    // any full session cookie exists. The /mfa action mints the real session.
    if (await userHasVerifiedTotpFactor(authSession.userId)) {
      const pendingCookie = await setPendingMfaSession(request, {
        authSession
      });
      return redirect(path.to.mfa, {
        headers: [["Set-Cookie", pendingCookie]]
      });
    }

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
      await flash(request, error(user.error, "User not found"))
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
              <AlertTitle>
                <Trans>Error</Trans>
              </AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            {error.includes("expired") && (
              <>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    But don't worry. You can use the forgot password flow to
                    request a new magic link.
                  </Trans>
                </p>
                <Button size="lg" asChild className="w-full">
                  <Link to={path.to.login}>
                    <Trans>Login</Trans>
                  </Link>
                </Button>
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
