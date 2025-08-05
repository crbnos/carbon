import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { zfd } from "zod-form-data";

const updateDueDateSchema = zfd.formData({
  id: z.string(),
  dueDate: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "quality",
  });

  const formData = await request.formData();
  const validated = await validator(updateDueDateSchema).validate(formData);
  if (validated.error) {
    return json({ error: "Invalid form data" }, { status: 400 });
  }

  const { error } = await client
    .from("nonConformanceActionTask")
    .update({
      dueDate: validated.data.dueDate || null,
    })
    .eq("id", validated.data.id);

  if (error) {
    return json({ error: error.message }, { status: 400 });
  }

  return json({ success: true });
}
