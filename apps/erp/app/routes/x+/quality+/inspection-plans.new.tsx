// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { inspectionDocumentValidator } from "~/modules/quality/quality.models";
import { upsertInspectionDocument } from "~/modules/quality/quality.service";
import { InspectionDocumentForm } from "~/modules/quality/ui/InspectionDocument";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await authorize(request, { create: "quality" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await authorize(request, {
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
