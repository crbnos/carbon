// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { makeEmptyPermissionsFromModules } from "@carbon/ee/permissions.server";
import { requireFeature } from "@carbon/ee/plan.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "users",
    role: "employee"
  });
  const { client, companyId } = auth;
  const api = carbonFor(auth);

  await requireFeature({
    request,
    client,
    companyId,
    redirectTo: path.to.employeeAccounts,
    feature: "PERMISSIONS"
  });

  const modules = await api.users.getModules({});
  if (modules.error || modules.data === null) {
    return data(
      {
        permissions: {}
      },
      await flash(request, error(modules.error, "Failed to fetch modules"))
    );
  }

  return {
    permissions: makeEmptyPermissionsFromModules(modules.data)
  };
}
