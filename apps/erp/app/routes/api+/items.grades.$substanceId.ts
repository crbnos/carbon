// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "parts",
    role: "employee"
  });

  if (!params.substanceId) {
    return data({ error: "Substance ID is required" }, { status: 400 });
  }

  return await api.items.getMaterialGradeList({
    materialSubstanceId: params.substanceId
  });
}
