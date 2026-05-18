import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteCostCenter, getCostCenter } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { costCenterId } = params;
  if (!costCenterId) throw notFound("costCenterId not found");

  const costCenter = await getCostCenter(costCenterId);
  if (costCenter.error) {
    throw redirect(
      path.to.costCenters,
      await flash(request, error(costCenter.error, "Failed to get cost center"))
    );
  }

  return {
    costCenter: costCenter.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "accounting"
  });

  const { costCenterId } = params;
  if (!costCenterId) {
    throw redirect(
      path.to.costCenters,
      await flash(request, error(params, "Failed to get cost center id"))
    );
  }

  const { error: deleteCostCenterError } = await deleteCostCenter(costCenterId);
  if (deleteCostCenterError) {
    throw redirect(
      path.to.costCenters,
      await flash(
        request,
        error(deleteCostCenterError, "Failed to delete cost center")
      )
    );
  }

  throw redirect(
    path.to.costCenters,
    await flash(request, success("Successfully deleted cost center"))
  );
}

export default function DeleteCostCenterRoute() {
  const { costCenterId } = useParams();
  const { costCenter } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!costCenter) return null;
  if (!costCenterId) throw new Error("costCenterId is not found");

  const onCancel = () => navigate(path.to.costCenters);

  return (
    <ConfirmDelete
      action={path.to.deleteCostCenter(costCenterId)}
      name={costCenter.name}
      text={`Are you sure you want to delete the cost center: ${costCenter.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
