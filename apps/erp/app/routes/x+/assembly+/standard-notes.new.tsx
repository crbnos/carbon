import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyStandardNoteValidator,
  upsertAssemblyStandardNote
} from "~/modules/production";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const validation = await validator(assemblyStandardNoteValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is never set on create
  const { id, ...rest } = validation.data;

  const create = await upsertAssemblyStandardNote(client, {
    ...rest,
    companyId,
    createdBy: userId
  });
  if (create.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(create.error, "Failed to create standard note")
      )
    );
  }

  return { success: true, id: create.data?.id };
}
