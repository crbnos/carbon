// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { isInternalEmail } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { signBackupStaging } from "~/modules/settings/settings.service";
import { onboardingBackupPrefix } from "~/services/onboarding.server";

/**
 * A signed upload slot for the backup onboarding restores from. The browser
 * PUTs the archive straight to storage, then the industry step posts its path.
 * Restoring from a backup is internal-only, like the step that offers it.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, email } = await requirePermissions(request, {
    allowPortalAccounts: true
  });
  if (!isInternalEmail(email)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return signBackupStaging(
    getCarbonServiceRole(),
    onboardingBackupPrefix(userId)
  );
}
