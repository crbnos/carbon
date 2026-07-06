import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useUrlParams, useUser } from "~/hooks";
import type { SalesRFQStatusType } from "~/modules/sales";
import { insertSalesRFQ, salesRfqValidator } from "~/modules/sales";
import { SalesRFQForm } from "~/modules/sales/ui/SalesRFQ";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`RFQs`,
  to: path.to.salesRfqs
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(salesRfqValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await insertSalesRFQ(client, {
    ...validation.data,
    rfqId: validation.data.rfqId || undefined,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.salesRfqs,
      await flash(request, error(result.error, "Failed to insert RFQ"))
    );
  }

  throw redirect(path.to.salesRfq(result.data.id));
}

export default function SalesRFQNewRoute() {
  const { id: userId, defaults } = useUser();
  const [params] = useUrlParams();
  const customerId = params.get("customerId");
  const initialValues = {
    customerContactId: "",
    customerId: customerId ?? "",
    customerReference: "",
    expirationDate: "",
    id: undefined,
    locationId: defaults?.locationId ?? "",
    rfqDate: today(getLocalTimeZone()).toString(),
    rfqId: undefined,
    status: "Draft" as SalesRFQStatusType,
    salesPersonId: userId
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <SalesRFQForm initialValues={initialValues} />
    </div>
  );
}
