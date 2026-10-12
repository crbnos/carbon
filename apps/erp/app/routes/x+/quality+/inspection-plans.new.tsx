// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { upsertInspectionDocument } from "~/modules/quality";
import { inspectionDocumentValidator } from "~/modules/quality/quality.models";
import { InspectionDocumentForm } from "~/modules/quality/ui/InspectionDocument";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "quality" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });

  const formData = await request.formData();
  const validation = await validator(inspectionDocumentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await upsertInspectionDocument(client, {
    ...validation.data,
    companyId,
    createdBy: userId
  });

  if (result.error || !result.data?.id) {
    throw redirect(
      path.to.inspectionDocuments,
      await flash(
        request,
        error(result.error, "Failed to create inspection plan")
      )
    );
  }

  throw redirect(
    path.to.inspectionDocument(result.data.id),
    await flash(request, success("Inspection plan created"))
  );
}

export default function BalloonNewRoute() {
  const closeRoute = useCloseRoute();

  return (
    <InspectionDocumentForm
      initialValues={{ name: "", partId: "", drawingNumber: "" }}
      onClose={() => closeRoute()}
    />
  );
}
