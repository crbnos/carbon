// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });
  const api = carbonFor(auth);

  if (!params.substanceId) {
    return data({ error: "Substance ID is required" }, { status: 400 });
  }

  return await api.items.getMaterialFinishList({
    materialSubstanceId: params.substanceId
  });
}
