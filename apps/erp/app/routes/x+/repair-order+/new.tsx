import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { insertRepairOrder, repairOrderValidator } from "~/modules/sales";
import RepairOrderForm from "~/modules/sales/ui/Repairs/RepairOrderForm";
import { useCompanyToday } from "~/hooks";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`New Repair Order`,
  to: path.to.newRepairOrder
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "sales" });
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(repairOrderValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is stripped for insert
  const { id, status, exchangeRate, ...d } = validation.data;

  const createRepairOrder = await insertRepairOrder(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createRepairOrder.error || !createRepairOrder.data) {
    return data(
      {},
      await flash(
        request,
        error(createRepairOrder.error, "Failed to create repair order")
      )
    );
  }

  throw redirect(path.to.repairOrderDetails(createRepairOrder.data.id));
}

export default function NewRepairOrderRoute() {
  const today = useCompanyToday();

  // A business date belongs to the company's calendar, not the browser's.
  const initialValues = {
    customerId: "",
    orderDate: today.toString()
  };

  return (
    <VStack spacing={4} className="p-4">
      <RepairOrderForm initialValues={initialValues} />
    </VStack>
  );
}
