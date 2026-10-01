// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getSlackInstallUrl } from "@carbon/ee/slack.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const url = await getSlackInstallUrl({
    companyId,
    userId
  });

  return { url };
}
