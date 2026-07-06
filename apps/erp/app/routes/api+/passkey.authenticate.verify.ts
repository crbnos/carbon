import { assertIsPost, error, isAuthProviderEnabled } from "@carbon/auth";
import { signInWithPasskey } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { verifyPasskeyAuthentication } from "@carbon/auth/passkey.server";
import { setAuthSession } from "@carbon/auth/session.server";
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

    const authSession = await signInWithPasskey(
      credRow.userId,
      authUser.user.email
    );
    if (!authSession) {
      return data(error(null, "Sign-in failed. Please try again."), {
        status: 500
      });
    }

    const sessionCookie = await setAuthSession(request, { authSession });
    const companyIdCookie = setCompanyId(authSession.companyId);

    const safeRedirect =
      redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
        ? redirectTo
        : path.to.authenticatedRoot;

    return redirect(safeRedirect, {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    });
  } catch {
    return data(error(null, "Sign-in failed. Please try again."), {
      status: 401
    });
  }
}
