import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useUser } from "~/hooks";
import type { PurchasingRFQStatusType } from "~/modules/purchasing";
import {
  purchasingRfqValidator,
  upsertPurchasingRFQ,
  upsertPurchasingRFQSuppliers
} from "~/modules/purchasing";
import { PurchasingRFQForm } from "~/modules/purchasing/ui/PurchasingRfq";
import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "RFQs",
  to: path.to.purchasingRfqs
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(purchasingRfqValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  let rfqId = validation.data.rfqId;
  const useNextSequence = !rfqId;

  if (useNextSequence) {
    const nextSequence = await getNextSequence(
      client,
      "purchasingRfq",
      companyId
    );
    if (nextSequence.error) {
      throw redirect(
        path.to.newPurchasingRFQ,
        await flash(
          request,
          error(nextSequence.error, "Failed to get next sequence")
        )
      );
    }
    rfqId = nextSequence.data;
  }

  if (!rfqId) throw new Error("rfqId is not defined");

  // Extract supplier IDs
  const { supplierIds, ...rfqData } = validation.data;

  const createPurchasingRFQ = await upsertPurchasingRFQ(client, {
    ...rfqData,
    rfqId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createPurchasingRFQ.error || !createPurchasingRFQ.data) {
    throw redirect(
      path.to.purchasingRfqs,
      await flash(
        request,
        error(createPurchasingRFQ.error, "Failed to insert RFQ")
      )
    );
  }

  const rfq = createPurchasingRFQ.data;

  // Create supplier associations
  if (supplierIds && supplierIds.length > 0) {
    const suppliersResult = await upsertPurchasingRFQSuppliers(
      client,
      rfq.id,
      supplierIds,
      companyId,
      userId
    );
    if (suppliersResult.error) {
      throw redirect(
        path.to.purchasingRfqs,
        await flash(
          request,
          error(suppliersResult.error, "Failed to assign suppliers")
        )
      );
    }
  }

  throw redirect(path.to.purchasingRfqDetails(rfq.id));
}

export default function PurchasingRFQNewRoute() {
  const { id: userId, defaults } = useUser();
  const initialValues = {
    expirationDate: "",
    id: undefined,
    locationId: defaults?.locationId ?? "",
    rfqDate: today(getLocalTimeZone()).toString(),
    rfqId: undefined,
    status: "Draft" as PurchasingRFQStatusType,
    employeeId: userId,
    supplierIds: [] as string[]
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <PurchasingRFQForm initialValues={initialValues} />
    </div>
  );
}
