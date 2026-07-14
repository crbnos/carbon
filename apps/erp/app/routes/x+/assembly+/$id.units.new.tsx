import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  assemblyUnitValidator,
  upsertAssemblyUnit
} from "~/modules/production";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const validation = await validator(assemblyUnitValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to create unit"))
    );
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is never set on create
  const { id, ...rest } = validation.data;

  const create = await upsertAssemblyUnit(client, {
    ...rest,
    companyId,
    createdBy: userId
  });
  if (create.error) {
    return data(
      { success: false },
      await flash(request, error(create.error, "Failed to create unit"))
    );
  }

  return { success: true, id: create.data?.id };
}
