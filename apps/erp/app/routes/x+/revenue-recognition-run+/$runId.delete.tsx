import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { getRevenueRecognitionRun } from "~/modules/accounting";
import { deleteRevenueRecognitionRun } from "~/modules/accounting/accounting.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { runId } = params;
  if (!runId) throw notFound("runId not found");

  const run = await getRevenueRecognitionRun(client, runId);
  if (run.error) {
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(
        request,
        error(run.error, "Failed to get revenue recognition run")
      )
    );
  }

  return { run: run.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { runId } = params;
  if (!runId) {
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(
        request,
        error(params, "Failed to get revenue recognition run id")
      )
    );
  }

  try {
    await deleteRevenueRecognitionRun(getDatabaseClient(), {
      runId,
      companyId,
      userId
    });
  } catch (err) {
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(
        request,
        error(err, "Failed to delete revenue recognition run")
      )
    );
  }

  throw redirect(
    path.to.revenueRecognitionRuns,
    await flash(
      request,
      success("Successfully deleted revenue recognition run")
    )
  );
}

export default function DeleteRevenueRecognitionRunRoute() {
  const { runId } = useParams();
  const { run } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const navigate = useNavigate();

  if (!run) return null;
  if (!runId) throw new Error("runId is not found");

  const onCancel = () => navigate(path.to.revenueRecognitionRun(runId));

  return (
    <ConfirmDelete
      action={path.to.deleteRevenueRecognitionRun(runId)}
      name={run.runId}
      text={t`Are you sure you want to delete ${run.runId}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
