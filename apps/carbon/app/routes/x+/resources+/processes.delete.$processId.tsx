import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteProcess, getProcess } from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee",
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

  return json({
    process: process.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "resources",
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
        error(deleteProcessError, "Failed to delete process")
      )
    );
  }

  throw redirect(
    path.to.processes,
    await flash(request, success("Successfully deleted process"))
  );
}

export default function DeleteProcessRoute() {
  const { processId } = useParams();
  const { process } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!process) return null;
  if (!processId) throw new Error("processId is not found");

  const onCancel = () => navigate(path.to.processes);

  return (
    <ConfirmDelete
      action={path.to.deleteProcess(processId)}
      name={process.name!}
      text={`Are you sure you want to delete the process: ${process.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
