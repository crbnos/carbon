// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { setLocation } from "~/services/location.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {});
  const formData = await request.formData();

  const currentLocation = formData.get("location");
  if (!currentLocation || typeof currentLocation !== "string") {
    return null;
  }

  throw redirect(path.to.authenticatedRoot, {
    headers: {
      "Set-Cookie": setLocation(companyId, currentLocation)
    }
  });
}
