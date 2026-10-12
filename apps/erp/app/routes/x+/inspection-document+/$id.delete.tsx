// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { storage } from "@carbon/files";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { deleteInspectionDocument } from "~/modules/quality";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await deleteInspectionDocument(client, id, companyId);

  if (result.error) {
    throw redirect(
      path.to.inspectionDocuments,
      await flash(
        request,
        error(result.error, "Failed to delete inspection plan")
      )
    );
  }

  const storagePath = result.data?.storagePath;
  if (storagePath) {
    const serviceRole = await getCarbonServiceRole();
    await storage(serviceRole).company(companyId).remove([storagePath]);
  }

  throw redirect(
    path.to.inspectionDocuments,
    await flash(request, success("Inspection plan deleted"))
  );
}
