import { json } from "@remix-run/react";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { upsertProcedureAttribute } from "~/modules/production/production.service";
import { procedureAttributeValidator } from "~/modules/production/production.models";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
  });

  const { id: procedureId } = params;
  if (!procedureId) throw new Error("id is not found");

  const validation = await validator(procedureAttributeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json(
      { success: false },
      await flash(
        request,
        error(validation.error, "Failed to create attribute")
      )
    );
  }

  const { id, ...data } = validation.data;

  const create = await upsertProcedureAttribute(client, {
    ...data,
    companyId,
    createdBy: userId,
  });
  if (create.error) {
    return json(
      {
        success: false,
      },
      await flash(
        request,
        error(create.error, "Failed to insert procedure attribute")
      )
    );
  }

  return json({ success: true });
}
