import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams, useUser } from "~/hooks";
import {
  supplierQuoteValidator,
  upsertSupplierQuote,
} from "~/modules/purchasing";
import { SupplierQuoteForm } from "~/modules/purchasing/ui/SupplierQuote";
import { getNextSequence } from "~/modules/settings/settings.service";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Supplier Quote",
  to: path.to.supplierQuotes,
  module: "purchasing",
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
    bypassRls: true,
  });

  const formData = await request.formData();
  const validation = await validator(supplierQuoteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  let supplierQuoteId = validation.data.supplierQuoteId;
  const useNextSequence = !supplierQuoteId;

  if (useNextSequence) {
    const nextSequence = await getNextSequence(
      client,
      "supplierQuote",
      companyId
    );
    if (nextSequence.error) {
      throw redirect(
        path.to.newSupplierQuote,
        await flash(
          request,
          error(nextSequence.error, "Failed to get next sequence")
        )
      );
    }
    supplierQuoteId = nextSequence.data;
  }

  if (!supplierQuoteId) throw new Error("supplierQuoteId is not defined");

  const createSupplierQuote = await upsertSupplierQuote(client, {
    ...validation.data,
    supplierQuoteId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createSupplierQuote.error || !createSupplierQuote.data?.id) {
    throw redirect(
      path.to.supplierQuotes,
      await flash(
        request,
        error(createSupplierQuote.error, "Failed to insert supplier quote")
      )
    );
  }

  throw redirect(path.to.supplierQuote(createSupplierQuote.data.id));
}

export default function SupplierQuoteNewRoute() {
  const [params] = useUrlParams();
  const { company } = useUser();
  const supplierId = params.get("supplierId");
  const initialValues = {
    supplierContactId: "",
    supplierId: supplierId ?? "",
    supplierReference: "",
    expirationDate: "",
    quotedDate: today(getLocalTimeZone()).toString(),
    supplierQuoteId: undefined,
    status: "Active" as const,
    currencyCode: company.baseCurrencyCode,
    exchangeRate: undefined,
    exchangeRateUpdatedAt: "",
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <SupplierQuoteForm initialValues={initialValues} />
    </div>
  );
}
