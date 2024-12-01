import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteUnitOfMeasure, getUnitOfMeasure } from "~/modules/items";
import { getParams, path } from "~/utils/path";
import { getCompanyId, uomsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { uomId } = params;
  if (!uomId) throw notFound("uomId not found");

  const unitOfMeasure = await getUnitOfMeasure(client, uomId, companyId);
  if (unitOfMeasure.error) {
    throw redirect(
      `${path.to.uoms}?${getParams(request)}`,
      await flash(
        request,
        error(unitOfMeasure.error, "Failed to get unit of measure")
      )
    );
  }

  return json({ unitOfMeasure: unitOfMeasure.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "parts",
  });

  const { uomId } = params;
  if (!uomId) {
    throw redirect(
      path.to.uoms,
      await flash(request, error(params, "Failed to get an unit of measure id"))
    );
  }

  const { error: deleteTypeError } = await deleteUnitOfMeasure(client, uomId);
  if (deleteTypeError) {
    throw redirect(
      path.to.uoms,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete unit of measure")
      )
    );
  }

  throw redirect(
    path.to.uoms,
    await flash(request, success("Successfully deleted unit of measure"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.queryClient?.setQueryData(uomsQuery(getCompanyId()).queryKey, null);
  return await serverAction();
}

export default function DeleteUnitOfMeasureRoute() {
  const { uomId } = useParams();
  const { unitOfMeasure } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!unitOfMeasure) return null;
  if (!uomId) throw notFound("uomId not found");

  const onCancel = () => navigate(path.to.uoms);

  return (
    <ConfirmDelete
      action={path.to.deleteUom(uomId)}
      name={unitOfMeasure.name}
      text={`Are you sure you want to delete the unit of measure: ${unitOfMeasure.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
