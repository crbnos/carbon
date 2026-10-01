// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteJob } from "~/modules/production";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const jobDelete = await deleteJob(client, jobId);

  if (jobDelete.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(jobDelete.error, jobDelete.error.message))
    );
  }

  throw redirect(path.to.jobs);
}
