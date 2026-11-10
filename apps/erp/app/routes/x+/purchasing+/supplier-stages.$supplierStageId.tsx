// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { asColor } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { supplierStageValidator } from "~/modules/purchasing/purchasing.models";
import SupplierStageForm from "~/modules/purchasing/ui/SupplierStages/SupplierStageForm";
import { path } from "~/utils/path";

export async function loader(args: LoaderFunctionArgs) {
  const { supplierStageId } = args.params;
  if (!supplierStageId) throw notFound("supplierStageId not found");

  const api = await carbon(args.request);
  const supplierStage = await api.purchasing.getSupplierStage({
    supplierStageId
  });
  if (!supplierStage.data) {
    return respond(args.request, supplierStage).redirect(
      path.to.supplierStages
    );
  }

  return { supplierStage: supplierStage.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(supplierStageValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id, name, color } = input.data;
  if (!id) throw notFound("id not found");

  const api = await carbon(args.request);
  const result = await api.purchasing.updateSupplierStage({
    id,
    name,
    // The form always sends the color; empty clears it.
    color: color ?? null
  });

  return respond(args.request, result).redirect(path.to.supplierStages, {
    message: "Updated supplier stage"
  });
}

export default function EditSupplierStageRoute() {
  const { supplierStage } = useLoaderData<typeof loader>();
  const dialog = useRouteDialog();

  return (
    <SupplierStageForm
      key={supplierStage.id}
      initialValues={{
        id: supplierStage.id,
        name: supplierStage.name,
        color: asColor(supplierStage.color)
      }}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
