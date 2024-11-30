import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";

export async function action({ request }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production",
  });

  const formData = await request.formData();
  const id = formData.get("id") as string;

  if (!id) {
    return json(
      { error: "Operation ID is required" },
      {
        status: 400,
      }
    );
  }

  const { error } = await client.from("jobOperation").delete().eq("id", id);

  if (error) {
    return json(
      { success: false, error: error.message },
      {
        status: 400,
      }
    );
  }

  return json({ success: true });
}
