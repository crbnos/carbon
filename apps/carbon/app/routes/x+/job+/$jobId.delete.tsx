import { json, redirect } from "@remix-run/react";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { deleteJob } from "~/modules/production";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "production",
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const quoteDelete = await deleteJob(client, jobId);

  if (quoteDelete.error) {
    return json(
      path.to.jobs,
      await flash(request, error(quoteDelete.error, "Failed to delete job"))
    );
  }

  throw redirect(path.to.jobs);
}
