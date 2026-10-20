// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { useCompanyToday, useUrlParams, useUser } from "~/hooks";
import { salesRfqValidator } from "~/modules/sales/sales.models";
import type { SalesRFQStatusType } from "~/modules/sales/types";
import { SalesRFQForm } from "~/modules/sales/ui/SalesRFQ";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`RFQs`,
  to: path.to.salesRfqs
};

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesRfqValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const formData = input.formData ?? new FormData();
  const api = await carbon(args.request);
  const result = await api.sales.createSalesRfq({
    ...input.data,
    customFields: setCustomFields(formData),
    lines: extractedLines(formData.get("extractedLineItems")),
    documentPath:
      (formData.get("extractedStoragePath") as string | null) || undefined
  });
  if (!result.data) {
    return respond(args.request, result).redirect(path.to.salesRfqs, {
      message: ""
    });
  }
  throw redirect(path.to.salesRfq(result.data.id));
}

/** The lines an extraction found, posted as JSON; unreadable means none. */
function extractedLines(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function SalesRFQNewRoute() {
  const { id: userId, defaults } = useUser();
  const [params] = useUrlParams();
  const customerId = params.get("customerId");
  const companyToday = useCompanyToday();
  const initialValues = {
    customerContactId: "",
    customerLocationId: "",
    customerId: customerId ?? "",
    customerReference: "",
    expirationDate: "",
    id: undefined,
    locationId: defaults?.locationId ?? "",
    rfqDate: companyToday,
    rfqId: undefined,
    status: "Draft" as SalesRFQStatusType,
    salesPersonId: userId
  };

  return (
    <NewRecordPage>
      <SalesRFQForm initialValues={initialValues} />
    </NewRecordPage>
  );
}
