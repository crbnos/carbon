// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Onshape } from "@carbon/ee";
import { beginOnshapeAuthorization } from "@carbon/ee/onshape.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const started = await beginOnshapeAuthorization(request, {
    integrationId: Onshape.id,
    userId,
    companyId
  });

  // `error` is an integration-errors code; the client sends it to the
  // integrations page, which renders the copy.
  if (!started.ok) {
    return data(
      { error: started.reason },
      { status: started.reason === "not-configured" ? 500 : 409 }
    );
  }

  return data(
    { url: started.url },
    { headers: { "Set-Cookie": started.cookie } }
  );
}
