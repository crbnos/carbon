import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteCurrency, getCurrency } from "~/modules/accounting";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
  });
  const { currencyId } = params;
  if (!currencyId) throw notFound("currencyId not found");

  const currency = await getCurrency(client, currencyId);
  if (currency.error) {
    throw redirect(
      path.to.currencies,
      await flash(request, error(currency.error, "Failed to get currency"))
    );
  }

  return json({ currency: currency.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "accounting",
  });

  const { currencyId } = params;
  if (!currencyId) {
    throw redirect(
      `${path.to.currencies}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an currency id"))
    );
  }

  const { error: deleteTypeError } = await deleteCurrency(client, currencyId);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.currencies}?${getParams(request)}`,
      await flash(request, error(deleteTypeError, "Failed to delete currency"))
    );
  }

  throw redirect(
    `${path.to.currencies}?${getParams(request)}`,
    await flash(request, success("Successfully deleted currency"))
  );
}

export default function DeleteCurrencyRoute() {
  const { currencyId } = useParams();
  const { currency } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!currencyId || !currency) return null; // TODO - handle this better (404?)

  const onCancel = () => navigate(path.to.currencies);

  return (
    <ConfirmDelete
      action={path.to.deleteCurrency(currencyId)}
      name={currency.name}
      text={`Are you sure you want to delete the currency: ${currency.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
