import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, now, toCalendarDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams, useUser } from "~/hooks";
import type { QuotationStatusType } from "~/modules/sales";
import { quoteValidator, upsertQuote } from "~/modules/sales";
import { QuoteForm } from "~/modules/sales/ui/Quotes";
import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Quotes",
  to: path.to.quotes,
  module: "sales",
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
    bypassRls: true,
  });

  const formData = await request.formData();
  const validation = await validator(quoteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  let quoteId = validation.data.quoteId;
  const useNextSequence = !quoteId;

  if (useNextSequence) {
    const nextSequence = await getNextSequence(client, "quote", companyId);
    if (nextSequence.error) {
      throw redirect(
        path.to.newQuote,
        await flash(
          request,
          error(nextSequence.error, "Failed to get next sequence")
        )
      );
    }
    quoteId = nextSequence.data;
  }

  if (!quoteId) throw new Error("quoteId is not defined");

  const createQuote = await upsertQuote(client, {
    ...validation.data,
    quoteId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createQuote.error || !createQuote.data?.[0]) {
    throw redirect(
      path.to.quotes,
      await flash(request, error(createQuote.error, "Failed to insert quote"))
    );
  }

  const order = createQuote.data?.[0];

  throw redirect(path.to.quote(order.id!));
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
    exchangeRateUpdatedAt: "",
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <QuoteForm initialValues={initialValues} />
    </div>
  );
}
