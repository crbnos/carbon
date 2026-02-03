import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { Confirm } from "~/components/Modals";
import { deleteProcess, getProcess } from "~/modules/resources";
import { path } from "~/utils/path";
import { getCompanyId, processesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { processId } = params;
  if (!processId) throw notFound("processId not found");

  const process = await getProcess(client, processId);
  if (process.error) {
    throw redirect(
      path.to.processes,
      await flash(request, error(process.error, "Failed to get process"))
    );
  }

  return {
    process: process.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "resources"
  });

  const { processId } = params;
  if (!processId) {
    throw redirect(
      path.to.processes,
      await flash(request, error(params, "Failed to get process id"))
    );
  }

  const { error: deleteProcessError } = await deleteProcess(client, processId);
  if (deleteProcessError) {
    throw redirect(
      path.to.processes,
      await flash(
        request,
        error(deleteProcessError, deleteProcessError.details)
      )
    );
  }

  throw redirect(
    path.to.processes,
    await flash(request, success("Successfully deactivated process"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    processesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeleteProcessRoute() {
  const { processId } = useParams();
  const { process } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!process) return null;
  if (!processId) throw new Error("processId is not found");

  const onCancel = () => navigate(path.to.processes);

  return (
    <Confirm
      action={path.to.deleteProcess(processId)}
      title={`Deactivate ${process.name}`}
      text={`Are you sure you want to deactivate the process: ${process.name}? It will no longer appear in dropdowns.`}
      confirmText="Deactivate"
      isOpen={true}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
