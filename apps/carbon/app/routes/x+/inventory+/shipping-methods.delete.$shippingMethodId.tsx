import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteShippingMethod, getShippingMethod } from "~/modules/inventory";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
  });
  const { shippingMethodId } = params;
  if (!shippingMethodId) throw notFound("shippingMethodId not found");

  const shippingMethod = await getShippingMethod(client, shippingMethodId);
  if (shippingMethod.error) {
    throw redirect(
      path.to.shippingMethods,
      await flash(
        request,
        error(shippingMethod.error, "Failed to get shipping method")
      )
    );
  }

  return json({ shippingMethod: shippingMethod.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "inventory",
  });

  const { shippingMethodId } = params;
  if (!shippingMethodId) {
    throw redirect(
      path.to.shippingMethods,
      await flash(request, error(params, "Failed to get an shipping method id"))
    );
  }

  const { error: deleteTypeError } = await deleteShippingMethod(
    client,
    shippingMethodId
  );
  if (deleteTypeError) {
    throw redirect(
      path.to.shippingMethods,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete shipping method")
      )
    );
  }

  throw redirect(
    `${path.to.shippingMethods}?${getParams(request)}`,
    await flash(request, success("Successfully deleted shipping method"))
  );
}

export default function DeleteShippingMethodRoute() {
  const { shippingMethodId } = useParams();
  if (!shippingMethodId) throw notFound("shippingMethodId not found");

  const { shippingMethod } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!shippingMethodId) return null;

  const onCancel = () => navigate(path.to.shippingMethods);

  return (
    <ConfirmDelete
      action={path.to.deleteShippingMethod(shippingMethodId)}
      name={shippingMethod.name}
      text={`Are you sure you want to delete the shipping method: ${shippingMethod.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
