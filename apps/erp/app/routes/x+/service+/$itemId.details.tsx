// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, ServiceSummary } from "~/modules/items";
import { serviceValidator, upsertService } from "~/modules/items";
import {
  ItemDocuments,
  ItemNotes,
  ItemRiskRegister
} from "~/modules/items/ui/Item";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();

  const validation = await validator(serviceValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateService = await upsertService(client, getDatabaseClient(), {
    ...validation.data,
    id: itemId,
    companyId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (updateService.error) {
    throw redirect(
      path.to.service(itemId),
      await flash(
        request,
        error(updateService.error, "Failed to update service")
      )
    );
  }

  throw redirect(
    path.to.service(itemId),
    await flash(request, success("Updated service"))
  );
}

export default function ServiceDetailsRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const permissions = usePermissions();

  const serviceData = useRouteData<{
    serviceSummary: ServiceSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.service(itemId));

  if (!serviceData) throw new Error("Could not find service data");

  return (
    <VStack spacing={4} className="p-4">
      {permissions.is("employee") && (
        <>
          <ItemNotes
            id={serviceData.serviceSummary?.id ?? null}
            title={serviceData.serviceSummary?.name ?? ""}
            subTitle={serviceData.serviceSummary?.readableIdWithRevision ?? ""}
            notes={serviceData.serviceSummary?.notes as JSONContent}
          />
          <DeferredFiles resolve={serviceData?.files}>
            {(resolvedFiles) => (
              <ItemDocuments
                files={resolvedFiles}
                itemId={itemId}
                type="Service"
              />
            )}
          </DeferredFiles>

          <ItemRiskRegister itemId={itemId} />
        </>
      )}
    </VStack>
  );
}
