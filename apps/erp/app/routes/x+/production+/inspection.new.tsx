import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useNavigate } from "react-router";
import { upsertInspectionDocument } from "~/modules/production";
import { inspectionDocumentValidator } from "~/modules/production/production.models";
import { InspectionDocumentForm } from "~/modules/production/ui/InspectionDocument";
import { path } from "~/utils/path";
import { invalidateInspectionDocuments } from "~/utils/react-query";

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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  invalidateInspectionDocuments();
  return await serverAction();
}

export default function BalloonNewRoute() {
  const navigate = useNavigate();

  return (
    <InspectionDocumentForm
      initialValues={{ name: "", partId: "", drawingNumber: "" }}
      onClose={() => navigate(-1)}
    />
  );
}
