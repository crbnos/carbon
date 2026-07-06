import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, now, toCalendarDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useUrlParams, useUser } from "~/hooks";
import type { QuotationStatusType } from "~/modules/sales";
import { insertQuote, quoteValidator } from "~/modules/sales";
import { QuoteForm } from "~/modules/sales/ui/Quotes";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Quotes`,
  to: path.to.quotes,
  module: "sales"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "sales",
      bypassRls: true
    });

  const formData = await request.formData();
  const validation = await validator(quoteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...data } = validation.data;

  const result = await insertQuote(client, {
    ...data,
    quoteId: data.quoteId || undefined,
    companyId,
    companyGroupId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.quotes,
      await flash(request, error(result.error, "Failed to insert quote"))
    );
  }

  throw redirect(path.to.quote(result.data.id));
}

export default function QuoteNewRoute() {
  const { id: userId, defaults } = useUser();
  const [params] = useUrlParams();
  const customerId = params.get("customerId");
  const initialValues = {
    customerContactId: "",
    customerId: customerId ?? "",
    customerReference: "",
    expirationDate: toCalendarDate(
      now(getLocalTimeZone()).add({ days: 30 })
    ).toString(),
    dueDate: "",
    locationId: defaults?.locationId ?? "",
    quoteId: undefined,
    status: "Draft" as QuotationStatusType,
    salesPersonId: userId,
    currencyCode: undefined,
    exchangeRate: undefined,
    exchangeRateUpdatedAt: ""
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <QuoteForm initialValues={initialValues} />
    </div>
  );
}
