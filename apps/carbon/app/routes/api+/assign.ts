import { json, type ActionFunctionArgs } from "@vercel/remix";
import { assign } from "~/modules/shared/shared.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  const formData = await request.formData();
  const id = formData.get("id") as string;
  const assignee = formData.get("assignee") as string;
  const table = formData.get("table") as string;

  if (table && id) {
    const result = await assign(client, { table, id, assignee });

    if (result.error) {
      return json(
        { success: false },
        await flash(request, error(result.error, "Failed to assign"))
      );
    }
    return json({ success: true });
  } else {
    return json(
      { success: false },
      await flash(request, error(null, "Failed to assign"))
    );
  }
}
