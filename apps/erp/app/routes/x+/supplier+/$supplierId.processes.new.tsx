// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import {
  supplierProcessValidator,
  upsertSupplierProcess
} from "~/modules/purchasing";
import SupplierProcessForm from "~/modules/purchasing/ui/Supplier/SupplierProcessForm";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(supplierProcessValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createSupplierProcess = await upsertSupplierProcess(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createSupplierProcess.error) {
    throw redirect(
      path.to.supplierProcesses(supplierId),
      await flash(
        request,
        error(createSupplierProcess.error, "Failed to create supplier process")
      )
    );
  }

  return modal
    ? createSupplierProcess
    : redirect(path.to.supplierProcesses(supplierId));
}

export default function NewSupplierProcessRoute() {
  const { supplierId } = useParams();
  const closeRoute = useCloseRoute();

  if (!supplierId) throw new Error("Could not find supplier id");

  const initialValues = {
    supplierId: supplierId,
    processId: "",
    minimumCost: 0,
    leadTime: 0
  };

  return (
    <SupplierProcessForm
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
