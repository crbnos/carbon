// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { partValidator } from "~/modules/items/items.models";
import { PartForm } from "~/modules/items/ui/Parts";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Parts`,
  to: path.to.parts,
  module: "items"
};

export async function action(args: ActionFunctionArgs) {
  const input = await validator(partValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.items.createPart({
    ...input.data,
    customFields: input.formData && setCustomFields(input.formData)
  });
  // The modal form reads the result and closes itself.
  if (input.formData?.get("type") === "modal") return result;
  if (result.error) {
    return respond(args.request, result).redirect(path.to.parts);
  }
  throw redirect(path.to.part(result.data.id));
}

export default function PartsNewRoute() {
  const initialValues = {
    id: "",
    revision: "0",
    name: "",
    description: "",
    itemTrackingType: "Inventory" as "Inventory",
    replenishmentSystem: "Buy" as "Buy",
    defaultMethodType: "Pull from Inventory" as "Pull from Inventory",
    unitOfMeasureCode: "EA",
    unitCost: 0,
    lotSize: 0,
    active: true,
    shelfLifeCalculateFromBom: false
  };

  return (
    <NewRecordPage>
      <PartForm initialValues={initialValues} />
    </NewRecordPage>
  );
}
