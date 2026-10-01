// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { priceResolutionInputValidator, resolvePrice } from "~/modules/sales";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const payload = priceResolutionInputValidator.safeParse(await request.json());

  if (!payload.success) {
    return data(
      { errors: payload.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const result = await resolvePrice(client, companyId, payload.data);

  return data(result);
}
