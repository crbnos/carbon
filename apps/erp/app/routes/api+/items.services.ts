// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, { "parts.services": "View" });

  const services = await api.items.getServicesList({});
  if (services.error) {
    return data(
      services,
      await flash(request, error(services.error, "Failed to get services"))
    );
  }

  return services;
}
