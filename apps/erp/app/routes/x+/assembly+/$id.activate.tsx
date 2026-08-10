import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { activateAssemblyInstructionVersion } from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const update = await activateAssemblyInstructionVersion(client, {
    id,
    companyId,
    userId
  });

  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.assemblyInstruction(id),
      await flash(
        request,
        error(update.error, "Failed to make assembly instruction active")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.assemblyInstruction(id),
    await flash(request, success("Made assembly instruction active"))
  );
}
