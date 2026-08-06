import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  getCustomerItemPriceOverrideById,
  priceOverrideBreaksValidator,
  priceOverrideValidator,
  upsertCustomerItemPriceOverride
} from "~/modules/sales";
import PriceOverrideForm from "~/modules/sales/ui/Pricing/PriceOverrideForm";
import { getDatabaseClient } from "~/services/database.server";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const { overrideId } = params;
  if (!overrideId) throw notFound("overrideId not found");

  const override = await getCustomerItemPriceOverrideById(
    client,
    overrideId,
    companyId
  );

  return { override: override?.data ?? null };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { overrideId } = params;
  if (!overrideId) throw notFound("overrideId not found");

  const formData = await request.formData();
  const validation = await validator(priceOverrideValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const breaksRaw = formData.get("breaks");
  let breaksParsed: unknown;
  try {
    breaksParsed = breaksRaw ? JSON.parse(String(breaksRaw)) : [];
  } catch {
    return validationError({
      fieldErrors: { breaks: "Breaks must be valid JSON" }
    });
  }
  const breaksResult = priceOverrideBreaksValidator.safeParse(breaksParsed);
  if (!breaksResult.success) {
    return validationError({
      fieldErrors: {
        breaks:
          breaksResult.error.issues[0]?.message ?? "Invalid breaks payload"
      }
    });
  }
  const breaks = breaksResult.data;

  const {
    customerId,
    customerTypeId,
    itemId,
    active,
    applyRulesOnTop,
    notes,
    validFrom,
    validTo
  } = validation.data;

  const result = await upsertCustomerItemPriceOverride(
    getDatabaseClient(),
    companyId,
    userId,
    {
      id: overrideId,
      customerId: customerId || undefined,
      customerTypeId: customerTypeId || undefined,
      itemId,
      breaks,
      active,
      applyRulesOnTop,
      notes,
      validFrom,
      validTo
    }
  );

  if (result.error) {
    throw redirect(
      `${path.to.salesPriceList}?${getParams(request)}`,
      await flash(
        request,
        error(result.error, "Failed to update price override")
      )
    );
  }

  throw redirect(
    `${path.to.salesPriceList}?${getParams(request)}`,
    await flash(request, success("Price override updated"))
  );
}

export default function EditPriceOverrideRoute() {
  const { override } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!override) return null;

  return (
    <PriceOverrideForm
      key={override.id}
      initialValues={{
        id: override.id,
        itemId: override.itemId,
        customerId: override.customerId ?? undefined,
        customerTypeId: override.customerTypeId ?? undefined,
        active: override.active,
        applyRulesOnTop: override.applyRulesOnTop ?? true,
        validFrom: override.validFrom ?? undefined,
        validTo: override.validTo ?? undefined,
        notes: override.notes ?? undefined
      }}
      initialBreaks={
        Array.isArray(override.breaks)
          ? (override.breaks as {
              id: string;
              quantity: number;
              overridePrice: number;
              active: boolean;
            }[])
          : []
      }
      onClose={() => navigate(-1)}
    />
  );
}
