import { assertIsPost, error, isAuthProviderEnabled } from "@carbon/auth";
import { signInWithPasskey } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { userHasVerifiedTotpFactor } from "@carbon/auth/mfa.server";
import { verifyPasskeyAuthentication } from "@carbon/auth/passkey.server";
import {
  setAuthSession,
  setPendingMfaSession
} from "@carbon/auth/session.server";
import { isSsoRequiredForEmail } from "@carbon/ee/sso.server";
import { AccountLockout, redis } from "@carbon/kv";
import type { WebAuthnCredential } from "@simplewebauthn/browser";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  if (!isAuthProviderEnabled("passkey")) {
    return data(error(null, "Passkeys are disabled"), { status: 404 });
  }

  let body: { credential: any; challengeId: string; redirectTo?: string };
  try {
    body = await request.json();
  } catch {
    return data(error(null, "Sign-in failed. Please try again."), {
      status: 400
    });
  }

  const { credential: webAuthnResponse, challengeId, redirectTo } = body;

  if (!webAuthnResponse?.id || !challengeId) {
    return data(error(null, "Sign-in failed. Please try again."), {
      status: 400
    });
  }

  const serviceRole = getCarbonServiceRole();

  // Look up stored credential by ID
  const { data: credRow, error: credError } = await (serviceRole as any)
    .from("passkeyCredential")
    .select("id, userId, publicKey, counter, transports")
    .eq("id", webAuthnResponse.id)
    .maybeSingle();

  if (credError || !credRow) {
    // Return info so client can call signalUnknownCredential
    return data(
      {
        success: false,
        unknownCredential: true,
        credentialId: webAuthnResponse.id
      },
      { status: 404 }
    );
  }

  const storedCredential: WebAuthnCredential = {
    id: credRow.id,
    publicKey: new Uint8Array(Buffer.from(credRow.publicKey, "base64url")),
    counter: credRow.counter,
    transports: credRow.transports ?? null
  };

  try {
    const { newCounter } = await verifyPasskeyAuthentication(
      challengeId,
      webAuthnResponse,
      storedCredential
    );

    const returnedHandle = webAuthnResponse.response?.userHandle;
    if (returnedHandle) {
      const expectedHandle = Buffer.from(
        new TextEncoder().encode(credRow.userId)
      ).toString("base64url");
      if (returnedHandle !== expectedHandle) {
        return data(error(null, "Sign-in failed. Please try again."), {
          status: 401
        });
      }
    }

    const { error: counterError } = await (serviceRole as any)
      .from("passkeyCredential")
      .update({ counter: newCounter, lastUsedAt: new Date().toISOString() })
      .eq("id", credRow.id);

    if (counterError) {
      return data(error(null, "Sign-in failed. Please try again."), {
        status: 500
      });
    }

    const { data: authUser } = await serviceRole.auth.admin.getUserById(
      credRow.userId
    );
    if (!authUser.user?.email) {
      return data(error(null, "Sign-in failed. Please try again."), {
        status: 401
      });
    }

    // Require-SSO gate: a covered + enforced domain may only authenticate via
    // SSO — refuse the passkey before any session is minted. The login page
    // surfaces this message via its existing error toast.
    if (await isSsoRequiredForEmail(serviceRole, authUser.user.email)) {
      return data(
        error(
          null,
          "Your organization requires single sign-on. Sign in with your work email to continue."
        ),
        { status: 403 }
      );
    }

    const authSession = await signInWithPasskey(
      credRow.userId,
      authUser.user.email
    );
    if (!authSession) {
      return data(error(null, "Sign-in failed. Please try again."), {
        status: 500
      });
    }

    // Genuine passkey login verified — clear any per-account lockout state
    // (NIST 3.1.8 reset-on-success), before the TOTP gate below.
    await new AccountLockout({ redis }).reset(authUser.user.email);

    const safeRedirect =
      redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
        ? redirectTo
        : path.to.authenticatedRoot;

    // TOTP gate: a passkey sign-in still lands at AAL1 (it is minted through
    // a server-side magic link), so an enrolled user is challenged like any
    // other login before the full session cookie exists. The /mfa route mints
    // the real session cookie AND the company cookie on success.
    if (await userHasVerifiedTotpFactor(credRow.userId)) {
      const pendingCookie = await setPendingMfaSession(request, {
        authSession,
        redirectTo: safeRedirect
      });
      return redirect(path.to.mfa, {
        headers: [["Set-Cookie", pendingCookie]]
      });
    }

    const sessionCookie = await setAuthSession(request, { authSession });

    // MES has no company picker (shop floor): always stamp the resolved company
    // cookie, matching the magic-link callback rather than ERP's <=1 gating.
    return redirect(safeRedirect, {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", setCompanyId(authSession.companyId)]
      ]
    });
  } catch {
    return data(error(null, "Sign-in failed. Please try again."), {
      status: 401
    });
  }
}
