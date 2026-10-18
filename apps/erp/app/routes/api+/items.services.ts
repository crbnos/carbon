// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "parts"
  });
  const api = carbonFor(auth);

  const services = await api.items.getServicesList({});
  if (services.error) {
    return data(
      services,
      await flash(request, error(services.error, "Failed to get services"))
    );
  }

  return services;
}
