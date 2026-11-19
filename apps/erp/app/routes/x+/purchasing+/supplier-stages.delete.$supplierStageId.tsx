// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { useRouteDialog } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { getParams, path } from "~/utils/path";

export async function loader(args: LoaderFunctionArgs) {
  const { supplierStageId } = args.params;
  if (!supplierStageId) throw notFound("supplierStageId not found");

  const api = await carbon(args.request);
  const supplierStage = await api.purchasing.getSupplierStage({
    supplierStageId
  });
  if (!supplierStage.data) {
    return respond(args.request, supplierStage).redirect(
      `${path.to.supplierStages}?${getParams(args.request)}`
    );
  }

  return { supplierStage: supplierStage.data };
}

export async function action(args: ActionFunctionArgs) {
  const { supplierStageId } = args.params;
  if (!supplierStageId) throw notFound("supplierStageId not found");

  const api = await carbon(args.request);
  const result = await api.purchasing.deleteSupplierStage({ supplierStageId });

  return respond(args.request, result).redirect(
    `${path.to.supplierStages}?${getParams(args.request)}`,
    { message: "Deleted supplier stage" }
  );
}

export default function DeleteSupplierStageRoute() {
  const { t } = useLingui();
  const { supplierStage } = useLoaderData<typeof loader>();
  const dialog = useRouteDialog(path.to.supplierStages);

  return (
    <ConfirmDelete
      action={path.to.deleteSupplierStage(supplierStage.id)}
      isOpen={dialog.open}
      name={supplierStage.name}
      text={t`Are you sure you want to delete the supplier stage: ${supplierStage.name}? This cannot be undone.`}
      onCancel={dialog.close}
    />
  );
}
