// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { Card, CardContent, CardHeader, Heading } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { useUser } from "~/hooks";
import {
  insertWarehouseTransfer,
  warehouseTransferValidator
} from "~/modules/inventory";
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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(warehouseTransferValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, transferId: providedTransferId, ...d } = validation.data;

  const createTransfer = await insertWarehouseTransfer(client, {
    ...d,
    transferId: providedTransferId || undefined,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createTransfer.error || !createTransfer.data) {
    throw redirect(
      path.to.warehouseTransfers,
      await flash(
        request,
        error(createTransfer.error, "Failed to create warehouse transfer")
      )
    );
  }

  throw redirect(path.to.warehouseTransferDetails(createTransfer.data.id));
}

export default function WarehouseTransferNewRoute() {
  const { defaults } = useUser();

  const initialValues = {
    id: undefined,
    transferId: "",
    fromLocationId: defaults?.locationId ?? "",
    toLocationId: "",
    status: "Draft" as const,
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
