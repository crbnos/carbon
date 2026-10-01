// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getLocationEmployees } from "~/modules/production";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { locationId } = params;

  if (!locationId)
    return {
      data: []
    };

  const employees = await getLocationEmployees(client, companyId, locationId);
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
