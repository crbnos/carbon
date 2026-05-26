import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteCustomerItemPriceOverride,
  getCustomerItemPriceOverrideById
} from "~/modules/sales/sales.service.server";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  const { overrideId } = params;
  if (!overrideId) throw notFound("overrideId not found");

  const override = await getCustomerItemPriceOverrideById(overrideId);

  if (override.error) {
    throw redirect(
      `${path.to.salesPriceList}?${getParams(request)}`,
      await flash(
        request,
        error(override.error, "Failed to get price override")
      )
    );
  }

  return { override: override.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "sales"
  });

  const { overrideId } = params;
  if (!overrideId) {
    throw redirect(
      path.to.salesPriceList,
      await flash(request, error(params, "Failed to get price override id"))
    );
  }

  const { error: deleteError } =
    await deleteCustomerItemPriceOverride(overrideId);

  if (deleteError) {
    throw redirect(
      path.to.salesPriceList,
      await flash(
        request,
        error(deleteError, "Failed to delete price override")
      )
    );
  }

  throw redirect(
    path.to.salesPriceList,
    await flash(request, success("Price override deleted"))
  );
}

export default function DeletePriceOverrideRoute() {
  const { overrideId } = useParams();
  const { override } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const { t } = useLingui();

  if (!override) return null;
  if (!overrideId) throw notFound("overrideId not found");

  const name = override.item?.name
    ? `${override.item.name} override`
    : "price override";

  return (
    <ConfirmDelete
      action={path.to.deletePriceOverride(overrideId)}
      name={name}
      text={t`Are you sure you want to remove this item from the price list? This cannot be undone.`}
      onCancel={() => navigate(path.to.salesPriceList)}
    />
  );
}
