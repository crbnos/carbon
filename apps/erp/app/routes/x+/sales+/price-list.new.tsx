import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  priceOverrideBreaksValidator,
  priceOverrideValidator,
  upsertCustomerItemPriceOverride
} from "~/modules/sales";
import PriceOverrideForm from "~/modules/sales/ui/Pricing/PriceOverrideForm";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "sales"
  });

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId") ?? undefined;
  const customerTypeId = url.searchParams.get("customerTypeId") ?? undefined;
  const initialScope: "customer" | "customerType" | undefined = customerId
    ? "customer"
    : customerTypeId
      ? "customerType"
      : undefined;
  return {
    initial: {
      customerId,
      customerTypeId,
      itemId: url.searchParams.get("itemId") ?? "",
      validFrom:
        url.searchParams.get("validFrom") ??
        datetime.today(await getCompanyTimeZone(client, companyId)).toString()
    },
    initialScope
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

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
        error(result.error, "Failed to create price override")
      )
    );
  }

  throw redirect(
    `${path.to.salesPriceList}?${getParams(request)}`,
    await flash(request, success("Price override created"))
  );
}

export default function NewPriceOverrideRoute() {
  const { initial, initialScope } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <PriceOverrideForm
      initialValues={{
        itemId: initial.itemId,
        customerId: initial.customerId,
        customerTypeId: initial.customerTypeId,
        active: true,
        applyRulesOnTop: true,
        validFrom: initial.validFrom
      }}
      initialBreaks={[{ quantity: 1, overridePrice: 0, active: true }]}
      initialScope={initialScope}
      onClose={() => navigate(-1)}
    />
  );
}
