import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteIssueType, getIssueType } from "~/modules/quality";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const nonConformanceType = await getIssueType(client, id);
  if (nonConformanceType.error) {
    throw redirect(
      `${path.to.issueTypes}?${getParams(request)}`,
      await flash(
        request,
        error(nonConformanceType.error, "Failed to get issue type")
      )
    );
  }

  return json({ nonConformanceType: nonConformanceType.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "quality",
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.issueTypes}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an issue type id"))
    );
  }

  const { error: deleteIssueTypeError } = await deleteIssueType(client, id);
  if (deleteIssueTypeError) {
    const errorMessage =
      deleteIssueTypeError.code === "23503"
        ? "Non-conformance type is used elsewhere, cannot delete"
        : "Failed to delete issue type";

    throw redirect(
      `${path.to.issueTypes}?${getParams(request)}`,
      await flash(request, error(deleteIssueTypeError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.issueTypes}?${getParams(request)}`,
    await flash(request, success("Successfully deleted scrap reason"))
  );
}

export default function DeleteIssueTypesRoute() {
  const { id } = useParams();
  const { nonConformanceType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!nonConformanceType) return null;
  if (!id) throw notFound("id not found");

  const onCancel = () => navigate(path.to.issueTypes);
  return (
    <ConfirmDelete
      action={path.to.deleteIssueType(id)}
      name={nonConformanceType.name}
      text={`Are you sure you want to delete the issue type: ${nonConformanceType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
