import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { issueTypeValidator, upsertIssueType } from "~/modules/quality";
import IssueTypeForm from "~/modules/quality/ui/IssueTypes/IssueTypeForm";
import { setCustomFields } from "~/utils/form";
import { getParams, path, requestReferrer } from "~/utils/path";

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
  const modal = formData.get("type") === "modal";

  const validation = await validator(issueTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertIssueType = await upsertIssueType(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertIssueType.error) {
    return modal
      ? json(insertIssueType)
      : redirect(
          requestReferrer(request) ??
            `${path.to.issueTypes}?${getParams(request)}`,
          await flash(
            request,
            error(insertIssueType.error, "Failed to insert issue type")
          )
        );
  }

  return modal
    ? json(insertIssueType)
    : redirect(
        `${path.to.issueTypes}?${getParams(request)}`,
        await flash(request, success("Non-conformance type created"))
      );
}

export default function NewCustomerStatusesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
  };

  return (
    <IssueTypeForm initialValues={initialValues} onClose={() => navigate(-1)} />
  );
}
