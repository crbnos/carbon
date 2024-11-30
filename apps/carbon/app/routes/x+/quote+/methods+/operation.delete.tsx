import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export async function action({ request }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "sales",
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

  const { error } = await client.from("quoteOperation").delete().eq("id", id);

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
