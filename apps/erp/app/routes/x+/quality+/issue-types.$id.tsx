import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getIssueType,
  getIssueTypeByName,
  issueTypeValidator,
  upsertIssueType
} from "~/modules/quality";
import IssueTypeForm from "~/modules/quality/ui/IssueTypes/IssueTypeForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { getCompanyId, issueTypesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const nonConformanceType = await getIssueType(client, id);

  if (nonConformanceType.error) {
    throw redirect(
      path.to.issueTypes,
      await flash(
        request,
        error(nonConformanceType.error, "Failed to get issue type")
      )
    );
  }

  return {
    nonConformanceType: nonConformanceType.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const formData = await request.formData();
  const validation = await validator(issueTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const duplicateIssueType = await getIssueTypeByName(
    client,
    companyId,
    d.name,
    id
  );
  if (duplicateIssueType.data) {
    return validationError({
      fieldErrors: { name: "An issue type with this name already exists" }
    });
  }

  const updateIssueType = await upsertIssueType(client, {
    id,
    ...d,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });

  if (updateIssueType.error?.code === "23505") {
    return validationError({
      fieldErrors: { name: "An issue type with this name already exists" }
    });
  }
  if (updateIssueType.error) {
    return data(
      {},
      await flash(
        request,
        error(updateIssueType.error, "Failed to update issue type")
      )
    );
  }

  throw redirect(
    path.to.issueTypes,
    await flash(request, success("Updated issue type"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    issueTypesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function EditIssueTypeRoute() {
  const { nonConformanceType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: nonConformanceType.id ?? undefined,
    name: nonConformanceType.name ?? "",
    ...getCustomFields(nonConformanceType.customFields)
  };

  return (
    <IssueTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
