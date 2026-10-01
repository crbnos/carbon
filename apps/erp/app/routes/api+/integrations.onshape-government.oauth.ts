// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { OnshapeGovernment } from "@carbon/ee";
import type { LoaderFunctionArgs } from "react-router";
import { completeOnshapeAuthorization } from "~/modules/settings/onshape-oauth.server";

export const config = {
  runtime: "nodejs"
};

// The redirect URL a Government customer registers on the private OAuth app in
// their Onshape Enterprise. The authorization itself is started by saving the
// integration settings (see x+/settings+/integrations.$id.tsx).
export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  return completeOnshapeAuthorization({
    request,
    integrationId: OnshapeGovernment.id,
    userId,
    companyId
  });
}
