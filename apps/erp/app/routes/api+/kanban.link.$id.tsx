// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor, dataOrThrow } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { redirect, redirectExternal } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { getKanban } from "~/modules/inventory/inventory.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    role: "employee"
  });
  const { client, companyId } = auth;
  const api = carbonFor(auth);

  const { id } = params;
  if (!id) throw notFound("id not found");

  const kanban = await getKanban(client, id, companyId);
  if (kanban.error) {
    throw notFound("Kanban not found");
  }

  if (!kanban.data?.jobId) {
    throw notFound("Kanban has no active job");
  }

  const operation = dataOrThrow(
    await api.production.getActiveJobOperationByJobId({
      jobId: kanban.data.jobId!
    })
  );

  if (!operation) {
    throw redirect(path.to.job(kanban.data.jobId!));
  }

  throw redirectExternal(path.to.external.mesJobOperation(operation.id));
}
