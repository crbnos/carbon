// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getOutsideOperationsByJobId } from "~/modules/production";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {
    view: "production"
  });

  const { jobId } = params;

  if (!jobId)
    return {
      data: []
    };

  const operations = await getOutsideOperationsByJobId(
    authorized.client,
    jobId,
    authorized.companyId
  );
  if (operations.error) {
    return data(
      operations,
      await flash(
        request,
        error(operations.error, "Failed to get outside operations")
      )
    );
  }

  return operations;
}
