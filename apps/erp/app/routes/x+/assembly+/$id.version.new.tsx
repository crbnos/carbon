import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import {
  assemblyInstructionVersionValidator,
  copyAssemblyInstructionAsVersion
} from "~/modules/production";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(
    assemblyInstructionVersionValidator
  ).validate(await request.formData());

  if (validation.error) {
    return validationError(validation.error);
  }

  const copy = await copyAssemblyInstructionAsVersion(client, {
    copyFromId: validation.data.copyFromId,
    companyId,
    userId
  });

  if (copy.error || !copy.data?.id) {
    return data(
      {},
      await flash(
        request,
        error(copy.error, "Failed to create new assembly instruction version")
      )
    );
  }

  throw redirect(path.to.assemblyInstruction(copy.data.id));
}
