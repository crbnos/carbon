// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(
    request,
    { "parts.types": "View" },
    { role: "employee" }
  );

  if (!params.substanceId || !params.formId) {
    return data(
      { error: "Substance ID and Form ID are required" },
      { status: 400 }
    );
  }

  return await api.items.getMaterialTypeList({
    materialSubstanceId: params.substanceId,
    materialFormId: params.formId
  });
}

export const clientLoader = cachedClientLoader<typeof loader>();
