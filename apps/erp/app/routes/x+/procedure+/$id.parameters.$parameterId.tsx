import { json } from "@remix-run/react";

import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { upsertProcedureParameter } from "~/modules/production/production.service";
import { procedureParameterValidator } from "~/modules/production/production.models";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "production",
  });

  const { parameterId } = params;
  if (!parameterId) throw notFound("parameter id is not found");

  const validation = await validator(procedureParameterValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json(
      { success: false },
      await flash(
        request,
        error(validation.error, "Failed to update parameter")
      )
    );
  }

  const update = await upsertProcedureParameter(client, {
    id: parameterId,
    ...validation.data,
    updatedBy: userId,
  });
  if (update.error) {
    return json(
      { success: false },
      await flash(
        request,
        error(update.error, "Failed to update procedure parameter")
      )
    );
  }

  return json({ success: true });
}
