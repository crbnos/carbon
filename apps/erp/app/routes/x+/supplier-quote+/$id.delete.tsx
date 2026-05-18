import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteSupplierQuote } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const quoteDelete = await deleteSupplierQuote(id);

  if (quoteDelete.error) {
    return data(
      path.to.supplierQuotes,
      await flash(request, error(quoteDelete.error, quoteDelete.error.message))
    );
  }

  throw redirect(path.to.supplierQuotes);
}
