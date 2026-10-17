// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { getShippingMethod } from "~/modules/inventory/inventory.service";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory"
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

  return { shippingMethod: shippingMethod.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["shippingMethodId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.inventory.deleteShippingMethod({
    shippingMethodId: input.params.shippingMethodId
  });
  return respond(args.request, result).redirect(
    `${path.to.shippingMethods}?${getParams(args.request)}`,
    {
      message: "Successfully deleted shipping method",
      onError: path.to.shippingMethods
    }
  );
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
