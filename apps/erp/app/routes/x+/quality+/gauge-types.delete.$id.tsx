import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteGaugeType, getGaugeType } from "~/modules/quality";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const gaugeType = await getGaugeType(client, id);
  if (gaugeType.error) {
    throw redirect(
      `${path.to.gaugeTypes}?${getParams(request)}`,
      await flash(request, error(gaugeType.error, "Failed to get gauge type"))
    );
  }

  return json({ gaugeType: gaugeType.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "quality",
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.nonConformanceTypes}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an gauge id"))
    );
  }

  const { error: deleteGaugeTypeError } = await deleteGaugeType(client, id);
  if (deleteGaugeTypeError) {
    const errorMessage =
      deleteGaugeTypeError.code === "23503"
        ? "Gauge type is used elsewhere, cannot delete"
        : "Failed to delete gauge type";

    throw redirect(
      `${path.to.nonConformanceTypes}?${getParams(request)}`,
      await flash(request, error(deleteGaugeTypeError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.nonConformanceTypes}?${getParams(request)}`,
    await flash(request, success("Successfully deleted scrap reason"))
  );
}

export default function DeleteGaugeTypesRoute() {
  const { id } = useParams();
  const { gaugeType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!gaugeType) return null;
  if (!id) throw notFound("id not found");

  const onCancel = () => navigate(path.to.gaugeTypes);
  return (
    <ConfirmDelete
      action={path.to.deleteGaugeType(id)}
      name={gaugeType.name}
      text={`Are you sure you want to delete the gauge type: ${gaugeType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
