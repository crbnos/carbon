import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams, useUser } from "~/hooks";
import type { SalesRFQStatusType } from "~/modules/sales";
import {
  SalesRFQForm,
  salesRfqValidator,
  upsertSalesRFQ,
} from "~/modules/sales";
import { getNextSequence, rollbackNextSequence } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "RFQs",
  to: path.to.salesRfqs,
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const formData = await request.formData();
  const validation = await validator(salesRfqValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const nextSequence = await getNextSequence(client, "salesRfq", companyId);
  if (nextSequence.error) {
    throw redirect(
      path.to.newSalesRFQ,
      await flash(
        request,
        error(nextSequence.error, "Failed to get next sequence")
      )
    );
  }

  const createSalesRFQ = await upsertSalesRFQ(client, {
    ...validation.data,
    rfqId: nextSequence.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createSalesRFQ.error || !createSalesRFQ.data?.[0]) {
    // TODO: this should be done as a transaction
    await rollbackNextSequence(client, "salesRfq", companyId);
    throw redirect(
      path.to.salesRfqs,
      await flash(request, error(createSalesRFQ.error, "Failed to insert RFQ"))
    );
  }

  const order = createSalesRFQ.data?.[0];

  throw redirect(path.to.salesRfq(order.id!));
}

export default function SalesRFQNewRoute() {
  const { defaults } = useUser();
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
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto mt-8">
      <SalesRFQForm initialValues={initialValues} />
    </div>
  );
}
