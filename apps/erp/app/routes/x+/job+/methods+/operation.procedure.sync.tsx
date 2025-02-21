import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { validator } from "@carbon/form";
import { procedureSyncValidator } from "~/modules/production";
import { flash } from "@carbon/auth/session.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production",
  });

  const formData = await request.formData();
  const validation = await validator(procedureSyncValidator).validate(formData);

  if (validation.error) {
    return json(
      { success: false },
      await flash(request, error(validation.error, "Invalid form data"))
    );
  }

  const serviceRole = await getCarbonServiceRole();
  const sync = await serviceRole.functions.invoke("get-method", {
    body: {
      type: "procedureToOperation",
      sourceId: validation.data.procedureId,
      targetId: validation.data.operationId,
      companyId,
      userId,
    },
  });

  if (sync.error) {
    return json(
      { success: false },
      await flash(request, error(sync.error, "Failed to sync procedure"))
    );
  }

  return { success: true };
}
