import { assertIsPost, error, isAuthProviderEnabled } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { verifyPasskeyRegistration } from "@carbon/auth/passkey.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  if (!isAuthProviderEnabled("passkey")) {
    return data(error(null, "Passkeys are disabled"), { status: 404 });
  }

  const { userId } = await requirePermissions(request, {});

  let body: any;
  try {
    body = await request.json();
  } catch {
    return data(error(null, "Invalid request body"), { status: 400 });
  }

  let credential: Awaited<ReturnType<typeof verifyPasskeyRegistration>>;
  try {
    credential = await verifyPasskeyRegistration(userId, body);
  } catch (e: any) {
    return data(error(null, e.message ?? "Verification failed"), {
      status: 400
    });
  }

  const serviceRole = getCarbonServiceRole();

  const { error: dbError } = await (serviceRole as any)
    .from("passkeyCredential")
    .insert({
      id: credential.id,
      userId,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credential.deviceType,
      backedUp: credential.backedUp,
      aaguid: credential.aaguid,
      credentialName: credential.credentialName,
      rpId: credential.rpId,
      userHandle: credential.userHandle
    });

  if (dbError) {
    return data(error(dbError, "Failed to save passkey"), { status: 500 });
  }

  return data({ success: true, credentialName: credential.credentialName });
}
