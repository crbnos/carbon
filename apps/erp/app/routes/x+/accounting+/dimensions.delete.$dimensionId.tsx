import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteDimension,
  getDimension
} from "~/modules/accounting/accounting.service.server";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "accounting"
  });
  const { dimensionId } = params;
  if (!dimensionId) throw notFound("dimensionId not found");

  const dimension = await getDimension(dimensionId);
  if (dimension.error) {
    throw redirect(
      `${path.to.dimensions}?${getParams(request)}`,
      await flash(request, error(dimension.error, "Failed to get dimension"))
    );
  }

  return { dimension: dimension.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "accounting"
  });

  const { dimensionId } = params;
  if (!dimensionId) {
    throw redirect(
      `${path.to.dimensions}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a dimension id"))
    );
  }

  const { error: deleteError } = await deleteDimension(dimensionId);
  if (deleteError) {
    throw redirect(
      `${path.to.dimensions}?${getParams(request)}`,
      await flash(request, error(deleteError, "Failed to delete dimension"))
    );
  }

  throw redirect(
    `${path.to.dimensions}?${getParams(request)}`,
    await flash(request, success("Successfully deleted dimension"))
  );
}

export default function DeleteDimensionRoute() {
  const { dimensionId } = useParams();
  const { dimension } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!dimensionId || !dimension) return null;

  const onCancel = () => navigate(path.to.dimensions);

  return (
    <ConfirmDelete
      action={path.to.deleteDimension(dimensionId)}
      name={dimension.name}
      text={`Are you sure you want to delete the dimension: ${dimension.name}? This will also delete all associated values. This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
