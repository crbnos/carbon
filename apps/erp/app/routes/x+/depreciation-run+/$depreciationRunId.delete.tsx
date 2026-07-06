import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteDepreciationRun,
  getDepreciationRun
} from "~/modules/accounting";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { depreciationRunId } = params;
  if (!depreciationRunId) throw notFound("depreciationRunId not found");

  const run = await getDepreciationRun(client, depreciationRunId);
  if (run.error) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(run.error, "Failed to get depreciation run"))
    );
  }

  return { run: run.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { depreciationRunId } = params;
  if (!depreciationRunId) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(params, "Failed to get depreciation run id"))
    );
  }

  const { error: deleteError } = await deleteDepreciationRun(
    client,
    depreciationRunId
  );
  if (deleteError) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(deleteError, "Failed to delete depreciation run")
      )
    );
  }

  throw redirect(
    path.to.depreciationRuns,
    await flash(request, success("Successfully deleted depreciation run"))
  );
}

export default function DeleteDepreciationRunRoute() {
  const { depreciationRunId } = useParams();
  const { run } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!run) return null;
  if (!depreciationRunId) throw new Error("depreciationRunId is not found");

  const onCancel = () => navigate(path.to.depreciationRun(depreciationRunId));

  return (
    <ConfirmDelete
      action={path.to.deleteDepreciationRun(depreciationRunId)}
      name={run.depreciationRunId}
      text={`Are you sure you want to delete ${run.depreciationRunId}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
