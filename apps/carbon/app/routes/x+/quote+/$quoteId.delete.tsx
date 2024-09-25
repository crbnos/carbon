import { json, redirect } from "@remix-run/react";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { deleteQuote } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const quoteDelete = await deleteQuote(client, quoteId);

  if (quoteDelete.error) {
    return json(
      path.to.quotes,
      await flash(request, error(quoteDelete.error, "Failed to delete quote"))
    );
  }

  throw redirect(path.to.quotes);
}
