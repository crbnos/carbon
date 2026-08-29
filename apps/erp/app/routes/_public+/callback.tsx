import {
  assertIsPost,
  callbackValidator,
  carbonClient,
  error,
  getCarbon,
  safeRedirect
} from "@carbon/auth";
import { refreshAccessToken } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyId, setCompanyId } from "@carbon/auth/company.server";
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
  deleteJitSsoUser,
  getSsoConnectionByProviderId,
  getSsoProviderIdFromSession,
  isSsoEnabled,
  isSsoRequiredForEmail,
  linkSsoIdentityToUser,
  migrateUserToSso
} from "@carbon/ee/sso.server";
import { validator } from "@carbon/form";
import { AccountLockout, redis } from "@carbon/kv";
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
import { getDatabaseClient } from "~/services/database.server";
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

  // ── SSO branch ─────────────────────────────────────────────────────────
  // A SAML session is company-bound by its provider. Enforce the
  // provider → company binding and the asserted email's registered domain
  // BEFORE anything is attached — GoTrue's own checks are not trusted here —
  // then run the invite-first migration on a first login. Every non-SSO
  // session falls through to the unchanged path below. Outside Enterprise the
  // classification (and its admin API call) is skipped entirely.
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

    const memberships =
      (
        await serviceRole
          .from("userToCompany")
          .select("companyId")
          .eq("userId", userId)
      ).data ?? [];

    const emailDomain = authSession.email.split("@")[1]?.toLowerCase() ?? "";
    if (!connection.data.domains.includes(emailDomain)) {
      // The IdP asserted an email outside its registered domains. Never
      // attach it; remove the JIT-created orphan — auth user AND the
      // trigger-created profile rows — so a retry (or a later invite for
      // this email) starts clean.
      if (memberships.length === 0) {
        await deleteJitSsoUser(serviceRole, getDatabaseClient(), userId);
      }
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

    // Link-instead-of-archive: when an ACTIVE account already owns this
    // email, move the SAML identity onto it and continue as that account —
    // nothing is deactivated, and magic link keeps working. Safe because the
    // domain check above bound this assertion to the connection's registered
    // domains. The duplicate auth user GoTrue just created is deleted; its
    // tokens die with it, so a fresh session is minted server-side.
    const existingUser = (
      await serviceRole
        .from("user")
        .select("id")
        .eq("email", authSession.email.toLowerCase())
        .neq("id", userId)
        .eq("active", true)
        .maybeSingle()
    ).data;

    if (existingUser) {
      const linked = await linkSsoIdentityToUser(getDatabaseClient(), {
        fromUserId: userId,
        toUserId: existingUser.id
      });
      if (linked.error) {
        return redirect(
          path.to.root,
          await flash(
            request,
            error(
              linked.error,
              "SAML SSO sign-in failed while linking your account. Contact your administrator."
            )
          )
        );
      }
      await serviceRole.auth.admin.deleteUser(userId);

      // Server-side magic-link redemption for the linked account — the
      // token hash never leaves this request and no email is sent.
      const link = await serviceRole.auth.admin.generateLink({
        type: "magiclink",
        email: authSession.email
      });
      const tokenHash = link.data?.properties?.hashed_token;
      const verified = tokenHash
        ? await getCarbon().auth.verifyOtp({
            type: "magiclink",
            token_hash: tokenHash
          })
        : null;
      const linkedSession = verified?.data?.session?.refresh_token
        ? await refreshAccessToken(
            verified.data.session.refresh_token,
            ssoCompanyId,
            ""
          )
        : null;
      if (!linkedSession) {
        // The identity IS linked — the next SSO attempt resolves directly
        // to the existing account, so this is self-healing.
        return redirect(
          path.to.root,
          await flash(
            request,
            error(
              link.error ?? verified?.error,
              "Your single sign-on identity was linked. Sign in with your work email again to continue."
            )
          )
        );
      }
      Object.assign(authSession, linkedSession);
      const linkedMemberships =
        (
          await serviceRole
            .from("userToCompany")
            .select("companyId")
            .eq("userId", authSession.userId)
        ).data ?? [];
      memberships.length = 0;
      memberships.push(...linkedMemberships);
    }

    const isMember = memberships.some((m) => m.companyId === ssoCompanyId);

    if (!isMember) {
      // ilike for the case fold only (invite emails are stored as typed, the
      // asserted email is lowercased) — escape LIKE metacharacters so %/_ in
      // an address can never act as wildcards and match someone else's invite.
      const inviteEmailPattern = authSession.email.replace(
        /[\\%_]/g,
        (match) => `\\${match}`
      );
      const invite = await serviceRole
        .from("invite")
        .select("id, companyId, role, permissions")
        .ilike("email", inviteEmailPattern)
        .eq("companyId", ssoCompanyId)
        .is("acceptedAt", null)
        .is("revokedAt", null)
        .maybeSingle();

      if (!invite.data) {
        // Only ever delete the throwaway duplicate — never a linked account.
        // The whole throwaway goes: auth user plus its trigger-created
        // profile rows, or the leftover profile makes the email un-invitable.
        if (memberships.length === 0 && authSession.userId === userId) {
          await deleteJitSsoUser(serviceRole, getDatabaseClient(), userId);
        }
        return redirect(
          path.to.root,
          await flash(
            request,
            error(
              invite.error,
              `SAML SSO sign-in succeeded but no invite exists for ${authSession.email}. Contact your administrator.`
            )
          )
        );
      }

      const migration = await migrateUserToSso(
        getDatabaseClient(),
        serviceRole,
        {
          newUserId: authSession.userId,
          email: authSession.email,
          companyId: ssoCompanyId,
          invite: invite.data
        }
      );

      if (migration.error) {
        return redirect(
          path.to.root,
          await flash(
            request,
            error(
              migration.error,
              "SAML SSO sign-in failed while activating your account. Contact your administrator."
            )
          )
        );
      }
    }

    // Bind the session to the connection's company (a first login just
    // created the membership, so the pre-session company resolution above
    // could not have seen it).
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
    return redirect(safeRedirect(redirectTo, path.to.authenticatedRoot), {
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
        authSession,
        redirectTo
      });
      return redirect(path.to.mfa, {
        headers: [["Set-Cookie", pendingCookie]]
      });
    }

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
