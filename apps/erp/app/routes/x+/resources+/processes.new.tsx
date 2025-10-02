import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  ProcessForm,
  processValidator,
  upsertProcess,
} from "~/modules/resources";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { getCompanyId, processesQuery } from "~/utils/react-query";

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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    processesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewProcessRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.processes);

  const initialValues = {
    name: "",
    processType: "Inside" as const,
    defaultStandardFactor: "Minutes/Piece" as const,
    completeAllOnScan: false,
  };

  return <ProcessForm initialValues={initialValues} onClose={onClose} />;
}
