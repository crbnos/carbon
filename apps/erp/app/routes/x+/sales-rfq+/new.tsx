import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams, useUser } from "~/hooks";
import type { SalesRFQStatusType } from "~/modules/sales";
import { salesRfqValidator, upsertSalesRFQ } from "~/modules/sales";
import { SalesRFQForm } from "~/modules/sales/ui/SalesRFQ";
import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

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

  let rfqId = validation.data.rfqId;
  const useNextSequence = !rfqId;

  if (useNextSequence) {
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
    rfqId = nextSequence.data;
  }

  if (!rfqId) throw new Error("rfqId is not defined");

  const createSalesRFQ = await upsertSalesRFQ(client, {
    ...validation.data,
    rfqId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createSalesRFQ.error || !createSalesRFQ.data?.[0]) {
    throw redirect(
      path.to.salesRfqs,
      await flash(request, error(createSalesRFQ.error, "Failed to insert RFQ"))
    );
  }

  const order = createSalesRFQ.data?.[0];

  throw redirect(path.to.salesRfq(order.id!));
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
    salesPersonId: userId,
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <SalesRFQForm initialValues={initialValues} />
    </div>
  );
}
