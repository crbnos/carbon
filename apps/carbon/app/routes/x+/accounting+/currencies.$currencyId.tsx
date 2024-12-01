import { validationError, validator } from "@carbon/form";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  CurrencyForm,
  currencyValidator,
  getCurrency,
  upsertCurrency,
} from "~/modules/accounting";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { currenciesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee",
  });

  const { currencyId } = params;
  if (!currencyId) throw notFound("currencyId not found");

  const currency = await getCurrency(client, currencyId);

  return json({
    currency: currency?.data ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting",
  });

  const formData = await request.formData();
  const validation = await validator(currencyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateCurrency = await upsertCurrency(client, {
    id,
    ...data,
    companyId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });

  if (updateCurrency.error) {
    return json(
      {},
      await flash(
        request,
        error(updateCurrency.error, "Failed to update currency")
      )
    );
  }

  throw redirect(
    `${path.to.currencies}?${getParams(request)}`,
    await flash(request, success("Updated currency"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.queryClient?.setQueryData(currenciesQuery().queryKey, null);
  return await serverAction();
}

export default function EditCurrencysRoute() {
  const { currency } = useLoaderData<typeof loader>();

  const initialValues = {
    id: currency?.id ?? undefined,
    name: currency?.name ?? "",
    code: currency?.code ?? "",
    exchangeRate: currency?.exchangeRate ?? 1,
    decimalPlaces: currency?.decimalPlaces ?? 2,
    ...getCustomFields(currency?.customFields),
  };

  return <CurrencyForm key={initialValues.id} initialValues={initialValues} />;
}
