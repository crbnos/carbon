import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteQuote } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "sales"
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const quoteDelete = await deleteQuote(quoteId);

  if (quoteDelete.error) {
    return data(
      path.to.quotes,
      await flash(request, error(quoteDelete.error, quoteDelete.error.message))
    );
  }

  throw redirect(path.to.quotes);
}
