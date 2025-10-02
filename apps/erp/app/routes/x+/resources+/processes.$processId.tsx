import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  ProcessForm,
  getProcess,
  processValidator,
  upsertProcess,
} from "~/modules/resources";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { getCompanyId, processesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
  });

  const { processId } = params;
  if (!processId) throw notFound("processId was not found");

  const process = await getProcess(client, processId);

  if (process.error) {
    throw redirect(
      path.to.processes,
      await flash(request, error(process.error, "Failed to get process"))
    );
  }

  return json({
    process: process.data,
  });
}

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
  if (!id) throw notFound("Process ID was not found");

  const createProcess = await upsertProcess(client, {
    id,
    ...data,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createProcess.error) {
    throw redirect(
      path.to.processes,
      await flash(
        request,
        error(createProcess.error, "Failed to create process.")
      )
    );
  }

  return modal ? json(createProcess) : redirect(path.to.processes);
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    processesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function ProcessRoute() {
  const { process } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const initialValues = {
    id: process.id!,
    name: process.name!,
    processType: process.processType ?? "Inside",
    defaultStandardFactor: process.defaultStandardFactor ?? "Minutes/Piece",
    workCenters: process.workCenters ?? [],
    // @ts-ignore
    suppliers: (process.suppliers ?? []).map((s) => s.id) ?? [],
    ...getCustomFields(process.customFields),
    completeAllOnScan: process.completeAllOnScan ?? false,
  };

  return <ProcessForm initialValues={initialValues} onClose={onClose} />;
}
