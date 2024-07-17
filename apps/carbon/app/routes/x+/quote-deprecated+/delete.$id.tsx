import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { deleteQuote } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const remove = await deleteQuote(client, id);

  if (remove.error) {
    throw redirect(
      path.to.quotes,
      await flash(request, error(remove.error, "Failed to delete quote"))
    );
  }

  throw redirect(path.to.quotes);
}
