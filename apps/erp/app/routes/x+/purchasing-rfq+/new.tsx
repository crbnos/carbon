// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { useCompanyToday, useUser } from "~/hooks";
import { purchasingRfqValidator } from "~/modules/purchasing/purchasing.models";
import type { PurchasingRFQStatusType } from "~/modules/purchasing/types";
import { PurchasingRFQForm } from "~/modules/purchasing/ui/PurchasingRfq";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`RFQs`,
  to: path.to.purchasingRfqs
};

export async function action(args: ActionFunctionArgs) {
  const input = await validator(purchasingRfqValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _id, ...rfq } = input.data;
  const api = await carbon(args.request);
  const result = await api.purchasing.createPurchasingRfq({
    ...rfq,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(
    result.data
      ? path.to.purchasingRfqDetails(result.data.id)
      : path.to.purchasingRfqs,
    { message: "RFQ created" }
  );
}

export default function PurchasingRFQNewRoute() {
  const { id: userId, defaults } = useUser();
  const companyToday = useCompanyToday();
  const initialValues = {
    expirationDate: "",
    id: undefined,
    locationId: defaults?.locationId ?? "",
    rfqDate: companyToday,
    rfqId: undefined,
    status: "Draft" as PurchasingRFQStatusType,
    employeeId: userId,
    supplierIds: [] as string[]
  };

  return (
    <NewRecordPage>
      <PurchasingRFQForm initialValues={initialValues} />
    </NewRecordPage>
  );
}
