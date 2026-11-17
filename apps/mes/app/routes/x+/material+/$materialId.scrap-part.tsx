// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getScrappableParts } from "@carbon/database/scrappable-parts";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { erpPosting } from "~/services/erp";
import { scrapJobPartValidator } from "~/services/models";
import { abilityBlockRefusal } from "~/services/operations.service";

/** The parts of a job material an operator can scrap and replace from the shelf. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const { materialId } = params;
  if (!materialId) throw new Response("Missing material", { status: 400 });

  const material = await getScrappableParts(getDatabaseClient(), {
    companyId,
    jobMaterialId: materialId
  });
  if (!material) throw new Response("Material not found", { status: 404 });
  return { parts: material.parts };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {});
  const { materialId } = params;
  if (!materialId) throw new Response("Missing material", { status: 400 });

  const validation = await validator(scrapJobPartValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const refusal = await abilityBlockRefusal(getCarbonServiceRole(), {
    operationId: validation.data.jobOperationId,
    employeeId: userId,
    companyId
  });
  if (refusal) {
    return data({ success: false, message: refusal }, { status: 403 });
  }

  const posted = await erpPosting(
    "issue",
    { companyId, userId },
    { type: "scrapJobPart", materialId, ...validation.data }
  );
  if (posted.error) {
    return data(
      {
        success: false,
        message:
          posted.error.status < 500
            ? posted.error.message
            : "Failed to scrap the part"
      },
      { status: posted.error.status }
    );
  }

  return { success: true, message: "Scrapped" };
}
