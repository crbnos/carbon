// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { serverFns } from "@carbon/server-functions";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });
  const { id } = params;
  if (!id) {
    return { success: false, message: "Missing charge id" };
  }

  try {
    const result = await serverFns
      .system({ db: getDatabaseClient(), companyId, userId })
      .invoke("post-charge", { type: "void", chargeId: id });
    if (result.error) {
      // The operation's own refusal ("Charge is already voided", "Cannot void
      // a Draft charge") is the only useful thing to say here; the generic
      // string is the last resort.
      const message = result.error.message || "Failed to void charge";
      throw redirect(
        path.to.charge(id),
        await flash(request, error(result.error, message))
      );
    }
  } catch (err) {
    // A redirect is control flow, not a failure — including the one thrown just
    // above carrying the server function's own message ("Charge is already
    // voided"). Swallowing it replaced that with a generic string and handed a
    // `Response` object to `error()` as the thing to log.
    if (err instanceof Response) throw err;
    throw redirect(
      path.to.charge(id),
      await flash(request, error(err, "Failed to void charge"))
    );
  }

  throw redirect(
    path.to.charge(id),
    await flash(request, success("Charge voided"))
  );
}
