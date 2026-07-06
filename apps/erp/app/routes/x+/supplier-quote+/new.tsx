import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useUrlParams, useUser } from "~/hooks";
import {
  insertSupplierQuote,
  supplierQuoteValidator
} from "~/modules/purchasing";
import { SupplierQuoteForm } from "~/modules/purchasing/ui/SupplierQuote";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Supplier Quote`,
  to: path.to.supplierQuotes,
  module: "purchasing"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "purchasing",
      bypassRls: true
    });

  const formData = await request.formData();
  const validation = await validator(supplierQuoteValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...data } = validation.data;

  const result = await insertSupplierQuote(client, {
    ...data,
    supplierQuoteId: data.supplierQuoteId || undefined,
    companyId,
    companyGroupId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.supplierQuotes,
      await flash(
        request,
        error(result.error, "Failed to insert supplier quote")
      )
    );
  }

  throw redirect(path.to.supplierQuote(result.data.id));
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
    status: "Draft" as const,
    currencyCode: company.baseCurrencyCode,
    exchangeRate: undefined,
    exchangeRateUpdatedAt: "",
    supplierQuoteType: "Purchase" as const
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <SupplierQuoteForm initialValues={initialValues} />
    </div>
  );
}
