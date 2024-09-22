import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  ProcessForm,
  processValidator,
  upsertProcess,
} from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(processValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createProcess = await upsertProcess(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createProcess.error) {
    return modal
      ? json(createProcess)
      : redirect(
          path.to.processes,
          await flash(
            request,
            error(createProcess.error, "Failed to create process.")
          )
        );
  }

  return modal
    ? json(createProcess)
    : redirect(
        path.to.processes,
        await flash(request, success("Process created"))
      );
}

export default function NewProcessRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.processes);

  const initialValues = {
    name: "",
    processType: "Inside" as const,
    defaultStandardFactor: "Minutes/Piece" as const,
  };

  return <ProcessForm initialValues={initialValues} onClose={onClose} />;
}
