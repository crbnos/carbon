// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { serviceValidator, upsertService } from "~/modules/items";
import { ServiceForm } from "~/modules/items/ui/Services";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { SERVICE_RULE_ERROR_CODE } from "~/utils/supabase";

export const handle: Handle = {
  breadcrumb: msg`Services`,
  to: path.to.services,
  module: "items"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(serviceValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const createService = await upsertService(client, getDatabaseClient(), {
    ...validation.data,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId
  });
  if (createService.error) {
    if (createService.error.code === SERVICE_RULE_ERROR_CODE) {
      return validationError({
        fieldErrors: { name: createService.error.message },
        formId: validation.formId
      });
    }
    return modal
      ? data(
          createService,
          await flash(
            request,
            error(createService.error, "Failed to insert service")
          )
        )
      : redirect(
          path.to.services,
          await flash(
            request,
            error(createService.error, "Failed to insert service")
          )
        );
  }

  const itemId = createService.data?.id;
  if (!itemId) throw new Error("Service ID not found");

  return modal
    ? data(createService, { status: 201 })
    : redirect(path.to.service(itemId));
}

export default function ServicesNewRoute() {
  const initialValues = {
    name: "",
    description: "",
    replenishmentSystem: "Buy" as const,
    defaultMethodType: "Purchase to Order" as const,
    itemTrackingType: "Non-Inventory" as const,
    unitOfMeasureCode: "EA",
    unitCost: 0,
    active: true,
    shelfLifeCalculateFromBom: false,
    tags: []
  };

  return (
    <NewRecordPage>
      <ServiceForm initialValues={initialValues} />
    </NewRecordPage>
  );
}
