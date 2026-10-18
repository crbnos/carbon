// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authorized = await authorize(request, {});

  const { processId } = params;

  if (!processId)
    return {
      data: []
    };

  const processes =
    await authorized.api.purchasing.getSupplierProcessesByProcess({
      processId
    });
  if (processes.error) {
    return data(
      processes,
      await flash(
        request,
        error(processes.error, "Failed to get supplier processes")
      )
    );
  }

  return processes;
}

export const clientLoader = cachedClientLoader<typeof loader>();
