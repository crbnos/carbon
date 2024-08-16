import { json, redirect } from "@remix-run/react";

import type { ActionFunctionArgs } from "@remix-run/node";
import { deleteQuote } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

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
