// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "users",
    role: "employee"
  });
  const api = carbonFor(auth);

  const page = await api.users.getEmployeeTypes({});
  return {
    data: page.data?.rows ?? null,
    count: page.data?.count ?? null,
    error: page.error
  };
}
