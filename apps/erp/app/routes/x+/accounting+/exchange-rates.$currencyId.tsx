import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { currencyValidator } from "~/modules/accounting";
import {
  getCurrency,
  getExchangeRateHistory,
  upsertCurrency
} from "~/modules/accounting/accounting.service.server";
import { ExchangeRateForm } from "~/modules/accounting/ui/ExchangeRates";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { currenciesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { currencyId } = params;
  if (!currencyId) throw notFound("currencyId not found");

  const currency = await getCurrency(currencyId);
  const exchangeRateHistory =
    currency.data && currency.data.code
      ? await getExchangeRateHistory(companyGroupId, currency.data.code)
      : { data: [] };

  return {
    currency: currency?.data ?? null,
    exchangeRateHistory: exchangeRateHistory?.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyGroupId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(currencyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateCurrency = await upsertCurrency({
    id,
    ...d,
    companyGroupId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });

  if (updateCurrency.error) {
    return data(
      {},
      await flash(
        request,
        error(updateCurrency.error, "Failed to update exchange rate")
      )
    );
  }

  throw redirect(
    `${path.to.exchangeRates}?${getParams(request)}`,
    await flash(request, success("Updated exchange rate"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(currenciesQuery().queryKey, null);
  return await serverAction();
}

export default function EditExchangeRateRoute() {
  const { currency, exchangeRateHistory } = useLoaderData<typeof loader>();

  const initialValues = {
    id: currency?.id ?? undefined,
    name: currency?.currencyCode?.name ?? "",
    code: currency?.code ?? "",
    exchangeRate: currency?.exchangeRate ?? 1,
    historicalExchangeRate: currency?.historicalExchangeRate ?? undefined,
    decimalPlaces: currency?.decimalPlaces ?? 2,
    ...getCustomFields(currency?.customFields)
  };

  return (
    <ExchangeRateForm
      key={initialValues.id}
      initialValues={initialValues}
      exchangeRateHistory={exchangeRateHistory}
    />
  );
}
