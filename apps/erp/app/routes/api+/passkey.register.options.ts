// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

  // Existing credentials populate excludeCredentials (prevents duplicates)
  const { data: existing } = await (serviceRole as any)
    .from("passkeyCredential")
    .select("id, transports")
    .eq("userId", userId);

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
      existing ?? []
    );
    return data(options);
  } catch (e: any) {
    return data(error(null, e.message ?? "Failed to generate options"), {
      status: 500
    });
  }
}
