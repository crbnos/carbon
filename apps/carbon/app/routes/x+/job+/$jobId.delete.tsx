import { json, redirect } from "@remix-run/react";

import type { ActionFunctionArgs } from "@remix-run/node";
import { deleteJob } from "~/modules/production";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

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
