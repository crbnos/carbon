import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteJob } from "~/modules/production/production.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const jobDelete = await deleteJob(jobId);

  if (jobDelete.error) {
    return data(
      path.to.jobs,
      await flash(request, error(jobDelete.error, jobDelete.error.message))
    );
  }

  throw redirect(path.to.jobs);
}
