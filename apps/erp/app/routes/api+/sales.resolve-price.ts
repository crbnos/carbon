// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { anyOf } from "@carbon/database/access";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { priceResolutionInputValidator } from "~/modules/sales/sales.models";
import { resolvePrice } from "~/modules/sales/sales.service";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await authorize(
    request,
    anyOf(["sales.quotes", "sales.salesOrders", "sales.returns"], "View")
  );

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
