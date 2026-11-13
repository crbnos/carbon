// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { supplierStageValidator } from "~/modules/purchasing/purchasing.models";
import SupplierStageForm from "~/modules/purchasing/ui/SupplierStages/SupplierStageForm";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await authorize(request, { "purchasing.supplierStages": "Create" });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(supplierStageValidator).request(args);
  if ("invalid" in input) return input.invalid;

  const { api } = await authorize(args.request);
  const result = await api.purchasing.createSupplierStage({
    name: input.data.name,
    color: input.data.color
  });

  // The inline create on the supplier form stays open on its own page.
  if (input.formData?.get("type") === "modal") return result;

  return respond(args.request, result).redirect(
    `${path.to.supplierStages}?${getParams(args.request)}`,
    { message: "Supplier stage created" }
  );
}

export default function NewSupplierStageRoute() {
  const dialog = useRouteDialog();

  return (
    <SupplierStageForm
      initialValues={{ name: "" }}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
