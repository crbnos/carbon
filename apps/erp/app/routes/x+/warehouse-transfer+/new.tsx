// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { Card, CardContent, CardHeader, Heading } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { useUser } from "~/hooks";
import { warehouseTransferValidator } from "~/modules/inventory/inventory.models";
import { WarehouseTransferForm } from "~/modules/inventory/ui/WarehouseTransfers";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`New Transfer`,
  to: path.to.warehouseTransfers
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(warehouseTransferValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _, transferId, ...transfer } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.insertWarehouseTransfer({
    ...transfer,
    transferId: transferId || undefined,
    customFields: input.formData && setCustomFields(input.formData)
  });
  if (result.error) {
    return respond(args.request, result).redirect(path.to.warehouseTransfers);
  }
  throw redirect(path.to.warehouseTransferDetails(result.data!.id));
}

export default function WarehouseTransferNewRoute() {
  const { defaults } = useUser();

  const initialValues = {
    id: undefined,
    transferId: "",
    fromLocationId: defaults?.locationId ?? "",
    toLocationId: "",
    transferDate: "",
    expectedReceiptDate: "",
    notes: "",
    reference: ""
  };

  return (
    <NewRecordPage>
      <Card>
        <CardHeader>
          <Heading as="h1" size="h3" className="font-sans">
            <Trans>New Warehouse Transfer</Trans>
          </Heading>
        </CardHeader>
        {/* The form's field grid follows its container's width. */}
        <CardContent className="@container">
          <WarehouseTransferForm initialValues={initialValues} />
        </CardContent>
      </Card>
    </NewRecordPage>
  );
}
