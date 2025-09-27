import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { qualityDocumentValidator } from "~/modules/quality/quality.models";
import { upsertQualityDocument } from "~/modules/quality/quality.service";
import QualityDocumentForm from "~/modules/quality/ui/Documents/QualityDocumentForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "quality",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality",
  });
  const formData = await request.formData();
  const validation = await validator(qualityDocumentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, content, ...data } = validation.data;

  let contentJSON;
  try {
    contentJSON = content ? JSON.parse(content) : {};
  } catch (e) {
    return json(
      {},
      await flash(
        request,
        error(
          "Invalid quality document content format",
          "Failed to parse quality document content"
        )
      )
    );
  }

  const insertQualityDocument = await upsertQualityDocument(client, {
    ...data,
    content: contentJSON,
    companyId,
    createdBy: userId,
  });

  if (insertQualityDocument.error || !insertQualityDocument.data?.id) {
    return json(
      {},
      await flash(
        request,
        error(insertQualityDocument.error, "Failed to insert quality document")
      )
    );
  }

  return redirect(
    path.to.qualityDocument(insertQualityDocument.data.id),
    await flash(request, success("QualityDocument created"))
  );
}

export default function NewQualityDocumentRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    version: 0,
    processId: "",
  };

  return (
    <QualityDocumentForm
      initialValues={initialValues}
      type="new"
      onClose={() => navigate(-1)}
    />
  );
}
