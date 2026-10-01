// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const materialFormId = url.searchParams.get("materialFormId");

  let query = client
    .from("materials")
    .select("id, name, readableIdWithRevision, materialFormId")
    .or(`companyId.eq.${companyId},companyId.is.null`)
    .eq("active", true)
    .order("name");

  if (materialFormId) {
    query = query.eq("materialFormId", materialFormId);
  }

  return query;
}
