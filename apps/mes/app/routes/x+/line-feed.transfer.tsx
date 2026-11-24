// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { userContext } from "~/context";
import { transferToStation } from "~/services/line-feed.server";

const transferValidator = z.object({
  workCenterId: z.string().min(1),
  itemId: z.string().min(1),
  fromStorageUnitId: z.string().min(1),
  quantity: zfd.numeric(z.number().positive()),
  trackedEntityId: zfd.text(z.string().optional())
});

/**
 * The line feed's one-tap move (`transferToStation`). The answer is a flash,
 * not a toast the button raises: a move that lands removes the row, and the
 * button with it.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await authorize(request, {
    "inventory.stockTransfers": "Create"
  });
  const locationId = context.get(userContext)?.locationId;
  const validation = await validator(transferValidator).validate(
    await request.formData()
  );

  const result =
    !locationId || validation.error
      ? { success: false, message: "Invalid transfer" }
      : await transferToStation(client, request, {
          ...validation.data,
          companyId,
          locationId
        });
  return data(
    { success: result.success },
    await flash(
      request,
      result.success ? success(result.message) : error(null, result.message)
    )
  );
}
