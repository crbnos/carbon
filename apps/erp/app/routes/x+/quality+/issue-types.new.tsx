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
import {
  getIssueTypeByName,
  issueTypeValidator,
  upsertIssueType
} from "~/modules/quality";
import IssueTypeForm from "~/modules/quality/ui/IssueTypes/IssueTypeForm";
import { setCustomFields } from "~/utils/form";
import { getParams, path, requestReferrer } from "~/utils/path";
import { getCompanyId, issueTypesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "quality"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(issueTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const duplicateIssueType = await getIssueTypeByName(
    client,
    companyId,
    d.name
  );
  if (duplicateIssueType.data) {
    return validationError({
      fieldErrors: { name: "An issue type with this name already exists" }
    });
  }

  const insertIssueType = await upsertIssueType(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertIssueType.error?.code === "23505") {
    return validationError({
      fieldErrors: { name: "An issue type with this name already exists" }
    });
  }
  if (insertIssueType.error) {
    return modal
      ? insertIssueType
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
    ? insertIssueType
    : redirect(
        `${path.to.issueTypes}?${getParams(request)}`,
        await flash(request, success("Non-conformance type created"))
      );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    issueTypesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewCustomerStatusesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: ""
  };

  return (
    <IssueTypeForm initialValues={initialValues} onClose={() => navigate(-1)} />
  );
}
