// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {});
  const api = carbonFor(auth);

  const { locationId } = params;

  if (!locationId)
    return {
      data: []
    };

  const employees = await api.production.getLocationEmployees({ locationId });
  if (employees.error) {
    return data(
      employees,
      await flash(
        request,
        error(employees.error, "Failed to get people employees")
      )
    );
  }

  return employees;
}
