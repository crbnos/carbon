import { assertIsPost, error, isAuthProviderEnabled } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getPasskeyRegistrationOptions } from "@carbon/auth/passkey.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  if (!isAuthProviderEnabled("passkey")) {
    return data(error(null, "Passkeys are disabled"), { status: 404 });
  }

  const { userId, email } = await requirePermissions(request, {});

  const serviceRole = getCarbonServiceRole();

  // Get existing credential IDs to populate excludeCredentials (prevents duplicates)
  const { data: existing } = await (serviceRole as any)
    .from("passkeyCredential")
    .select("id")
    .eq("userId", userId);

  const existingIds: string[] = (existing ?? []).map((c: any) => c.id);

  // Get user display name
  const { data: userData } = await (serviceRole as any)
    .from("user")
    .select("firstName, lastName")
    .eq("id", userId)
    .single();

  const displayName = userData
    ? `${userData.firstName ?? ""} ${userData.lastName ?? ""}`.trim()
    : email;

  try {
    const options = await getPasskeyRegistrationOptions(
      userId,
      email,
      displayName || email,
      existingIds
    );
    return data(options);
  } catch (e: any) {
    return data(error(null, e.message ?? "Failed to generate options"), {
      status: 500
    });
  }
}
