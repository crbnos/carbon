import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteCustomField } from "~/modules/settings/settings.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "settings",
  });

  const { table, id } = params;
  if (!table) throw new Error("table is not found");
  if (!id) throw new Error("id is not found");

  const deleteField = await deleteCustomField(client, id, companyId);
  if (deleteField.error) {
    throw redirect(
      path.to.attributes,
      await flash(
        request,
        error(deleteField.error, "Failed to delete custom field")
      )
    );
  }

  throw redirect(
    path.to.customFieldList(table),
    await flash(request, success("Successfully deleted custom field"))
  );
}
