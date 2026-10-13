// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  laborCategoryValidator,
  upsertLaborCategory
} from "~/modules/projects";
import LaborCategoryForm from "~/modules/projects/ui/LaborCategories/LaborCategoryForm";
import { path } from "~/utils/path";

const logger = getLogger("erp", "labor-category-new");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "projects"
  });

  const validation = await validator(laborCategoryValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const { id: _id, ...fields } = validation.data;
  const created = await upsertLaborCategory(client, {
    ...fields,
    companyId,
    createdBy: userId
  });

  if (created.error) {
    logger.error("Failed to create a labor category", {
      companyId,
      error: created.error
    });
    return data(
      {},
      await flash(
        request,
        error(created.error, "Failed to create the labor category")
      )
    );
  }

  // Open the new category, so its first cost rate can be added.
  throw redirect(
    path.to.laborCategory(created.data.id),
    await flash(request, success("Labor category created"))
  );
}

export default function NewLaborCategoryRoute() {
  const closeRoute = useCloseRoute();
  return (
    <LaborCategoryForm
      initialValues={{ name: "", description: "", active: true }}
      onClose={() => closeRoute()}
    />
  );
}
