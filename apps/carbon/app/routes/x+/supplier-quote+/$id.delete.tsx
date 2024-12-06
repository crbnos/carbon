import { json, redirect } from "@remix-run/react";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { deleteSupplierQuote } from "~/modules/purchasing/purchasing.service";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "purchasing",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const quoteDelete = await deleteSupplierQuote(client, id);

  if (quoteDelete.error) {
    return json(
      path.to.supplierQuotes,
      await flash(request, error(quoteDelete.error, quoteDelete.error.message))
    );
  }

  throw redirect(path.to.supplierQuotes);
}
