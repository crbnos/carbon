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
import {
  currencyValidator,
  deleteExchangeRateOverride,
  exchangeRateOverrideValidator,
  getCurrency,
  getExchangeRateHistory,
  getExchangeRates,
  upsertCurrency,
  upsertExchangeRateOverride
} from "~/modules/accounting";
import { ExchangeRateForm } from "~/modules/accounting/ui/ExchangeRates";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { currenciesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { currencyId } = params;
  if (!currencyId) throw notFound("currencyId not found");

  const currency = await getCurrency(client, currencyId);
  const code = currency.data?.code;

  const [exchangeRates, exchangeRateHistory] = code
    ? await Promise.all([
        getExchangeRates(client, companyId),
        getExchangeRateHistory(client, code)
      ])
    : [{ data: null }, { data: [] }];

  const resolved =
    exchangeRates.data?.find((rate) => rate.currencyCode === code) ?? null;

  return {
    currency: currency?.data ?? null,
    rate: resolved?.rate ?? null,
    rateSource: resolved?.source ?? null,
    exchangeRateHistory: exchangeRateHistory?.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      update: "accounting"
    });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "override") {
    const validation = await validator(exchangeRateOverrideValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    // The base currency is 1 by definition and the resolver checks base before
    // overrides — a pin on the base code would be invisible dead data (and turn
    // wrong the day the base changes). The UI hides the field; enforce it here.
    const company = await client
      .from("company")
      .select("baseCurrencyCode")
      .eq("id", companyId)
      .single();
    if (company.data?.baseCurrencyCode === validation.data.currencyCode) {
      return data(
        {},
        await flash(
          request,
          error(null, "The base currency's exchange rate is always 1")
        )
      );
    }

    const upsertOverride = await upsertExchangeRateOverride(client, {
      companyId,
      currencyCode: validation.data.currencyCode,
      rate: validation.data.rate,
      createdBy: userId,
      updatedBy: userId
    });

    if (upsertOverride.error) {
      return data(
        {},
        await flash(
          request,
          error(upsertOverride.error, "Failed to update exchange rate")
        )
      );
    }

    throw redirect(
      `${path.to.exchangeRates}?${getParams(request)}`,
      await flash(request, success("Updated exchange rate"))
    );
  }

  if (intent === "reset") {
    const currencyCode = formData.get("currencyCode");

    if (typeof currencyCode !== "string" || !currencyCode) {
      return data(
        {},
        await flash(request, error(null, "Currency code is required"))
      );
    }

    const removeOverride = await deleteExchangeRateOverride(
      client,
      companyId,
      currencyCode
    );

    if (removeOverride.error) {
      return data(
        {},
        await flash(
          request,
          error(removeOverride.error, "Failed to reset exchange rate")
        )
      );
    }

    throw redirect(
      `${path.to.exchangeRates}?${getParams(request)}`,
      await flash(request, success("Reset to market rate"))
    );
  }

  const validation = await validator(currencyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateCurrency = await upsertCurrency(client, {
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
        error(updateCurrency.error, "Failed to update currency")
      )
    );
  }

  throw redirect(
    `${path.to.exchangeRates}?${getParams(request)}`,
    await flash(request, success("Updated currency"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(currenciesQuery().queryKey, null);
  return await serverAction();
}

export default function EditExchangeRateRoute() {
  const { currency, rate, rateSource, exchangeRateHistory } =
    useLoaderData<typeof loader>();

  const initialValues = {
    id: currency?.id ?? undefined,
    name: currency?.currencyCode?.name ?? "",
    code: currency?.code ?? "",
    historicalExchangeRate: currency?.historicalExchangeRate ?? undefined,
    decimalPlaces: currency?.decimalPlaces ?? 2,
    ...getCustomFields(currency?.customFields)
  };

  return (
    <ExchangeRateForm
      key={initialValues.id}
      initialValues={initialValues}
      rate={rate}
      rateSource={rateSource}
      exchangeRateHistory={exchangeRateHistory}
    />
  );
}
