import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useUser } from "~/hooks";
import {
  QuotationForm,
  quotationValidator,
  upsertQuote,
} from "~/modules/sales";
import { getNextSequence, rollbackNextSequence } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const formData = await request.formData();
  const validation = await validator(quotationValidator).validate(formData);

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

  const createQuotation = await upsertQuote(client, {
    ...validation.data,
    companyId,
    quoteId: nextSequence.data,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createQuotation.error || !createQuotation.data?.[0]) {
    // TODO: this should be done as a transaction
    await rollbackNextSequence(client, "quote", companyId);
    throw redirect(
      path.to.quotes,
      await flash(
        request,
        error(createQuotation.error, "Failed to insert quotation")
      )
    );
  }

  const order = createQuotation.data?.[0];

  throw redirect(path.to.quote(order.id!));
}

export default function QuotationNewRoute() {
  const user = useUser();
  const initialValues = {
    locationId: user.defaults.locationId,
    description: "",
    status: "Draft" as "Draft",
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto pt-4">
      {/* @ts-ignore */}
      <QuotationForm initialValues={initialValues} />
    </div>
  );
}
