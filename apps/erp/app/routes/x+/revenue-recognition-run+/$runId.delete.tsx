// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { getRevenueRecognitionRun } from "~/modules/accounting/accounting.service";
import { RUN_PAGES } from "~/modules/accounting/ui/RevenueRecognition/runPages";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { runId } = params;
  if (!runId) throw notFound("runId not found");

  const run = await getRevenueRecognitionRun(client, runId, companyId);
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["runId"] });
  if ("invalid" in input) return input.invalid;
  const { runId } = input.params;
  const api = await carbon(args.request);
  const result = await api.accounting.deleteRevenueRecognitionRun({ runId });
  // Back to the list of the run's own type.
  return respond(args.request, result).redirect(
    result.data
      ? RUN_PAGES[result.data.type].listPath
      : path.to.revenueRecognitionRun(runId),
    { message: "Successfully deleted the run" }
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
