import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteShippingMethod,
  getShippingMethod
} from "~/modules/inventory/inventory.service.server";
import { getParams, path } from "~/utils/path";
import { getCompanyId, shippingMethodsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "inventory"
  });
  const { shippingMethodId } = params;
  if (!shippingMethodId) throw notFound("shippingMethodId not found");

  const shippingMethod = await getShippingMethod(shippingMethodId);
  if (shippingMethod.error) {
    throw redirect(
      path.to.shippingMethods,
      await flash(
        request,
        error(shippingMethod.error, "Failed to get shipping method")
      )
    );
  }

  return { shippingMethod: shippingMethod.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "inventory"
  });

  const { shippingMethodId } = params;
  if (!shippingMethodId) {
    throw redirect(
      path.to.shippingMethods,
      await flash(request, error(params, "Failed to get an shipping method id"))
    );
  }

  const { error: deleteTypeError } =
    await deleteShippingMethod(shippingMethodId);
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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    shippingMethodsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeleteShippingMethodRoute() {
  const { shippingMethodId } = useParams();
  if (!shippingMethodId) throw notFound("shippingMethodId not found");

  const { shippingMethod } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!shippingMethodId) return null;

  const onCancel = () => navigate(path.to.shippingMethods);

  return (
    <ConfirmDelete
      action={path.to.deleteShippingMethod(shippingMethodId)}
      name={shippingMethod.name}
      text={t`Are you sure you want to delete the shipping method: ${shippingMethod.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
