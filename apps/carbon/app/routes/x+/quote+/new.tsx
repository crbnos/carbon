import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams, useUser } from "~/hooks";
import type { QuotationStatusType } from "~/modules/sales";
import { QuoteForm, quoteValidator, upsertQuote } from "~/modules/sales";
import { getNextSequence, rollbackNextSequence } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Quotes",
  to: path.to.quotes,
  module: "sales",
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const formData = await request.formData();
  const validation = await validator(quoteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

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

  const createQuote = await upsertQuote(client, {
    ...validation.data,
    quoteId: nextSequence.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createQuote.error || !createQuote.data?.[0]) {
    // TODO: this should be done as a transaction
    await rollbackNextSequence(client, "quote", companyId);
    throw redirect(
      path.to.quotes,
      await flash(request, error(createQuote.error, "Failed to insert quote"))
    );
  }

  const order = createQuote.data?.[0];

  throw redirect(path.to.quote(order.id!));
}

export default function QuoteNewRoute() {
  const { defaults } = useUser();
  const [params] = useUrlParams();
  const customerId = params.get("customerId");
  const initialValues = {
    customerContactId: "",
    customerId: customerId ?? "",
    customerReference: "",
    expirationDate: "",
    dueDate: "",
    locationId: defaults?.locationId ?? "",
    quoteId: undefined,
    status: "Draft" as QuotationStatusType,
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto mt-8">
      <QuoteForm initialValues={initialValues} />
    </div>
  );
}
