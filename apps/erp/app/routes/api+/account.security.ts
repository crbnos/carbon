// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AccountSecurityData, Passkey } from "@carbon/account";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getTotpFactors } from "@carbon/auth/mfa.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

// Data and writes for the Security pane of the account settings modal.
export async function loader({ request }: LoaderFunctionArgs) {
  const { userId } = await requirePermissions(request, {});
  const serviceRole = getCarbonServiceRole();
  const [passkeysResult, totpFactors] = await Promise.all([
    (serviceRole as any)
      .from("passkeyCredential")
      .select("id, credentialName, createdAt, lastUsedAt, backedUp")
      .eq("userId", userId)
      .order("createdAt", { ascending: false }),
    getTotpFactors(userId)
  ]);

  return {
    passkeys: (passkeysResult.data ?? []) as Passkey[],
    totpFactors: totpFactors.filter((f) => f.status === "verified")
  } satisfies AccountSecurityData;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {});
  const formData = await request.formData();

  if (formData.get("intent") === "deletePasskey") {
    const credentialId = formData.get("credentialId") as string;
    if (!credentialId) {
      return data(error(null, "Missing credentialId"), { status: 400 });
    }

    const serviceRole = getCarbonServiceRole();
    const { error: dbError } = await (serviceRole as any)
      .from("passkeyCredential")
      .delete()
      .eq("id", credentialId)
      .eq("userId", userId);

    if (dbError) {
      return data(
        error(dbError, "Failed to delete passkey"),
        await flash(request, error(dbError, "Failed to delete passkey"))
      );
    }

    return data(success("Passkey removed"));
  }

  if (formData.get("intent") === "renamePasskey") {
    const credentialId = formData.get("credentialId") as string;
    const credentialName = (formData.get("credentialName") as string)?.trim();
    if (!credentialId || !credentialName) {
      return data(error(null, "Missing fields"), { status: 400 });
    }
    if (credentialName.length > 100) {
      return data(error(null, "Passkey name must be 100 characters or fewer"), {
        status: 400
      });
    }

    const serviceRole = getCarbonServiceRole();
    const { error: dbError } = await (serviceRole as any)
      .from("passkeyCredential")
      .update({ credentialName })
      .eq("id", credentialId)
      .eq("userId", userId);

    if (dbError) {
      return data(
        error(dbError, "Failed to rename passkey"),
        await flash(request, error(dbError, "Failed to rename passkey"))
      );
    }

    return data(success("Passkey renamed"));
  }

  return null;
}
