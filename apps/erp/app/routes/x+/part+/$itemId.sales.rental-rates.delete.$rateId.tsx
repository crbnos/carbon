// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteCustomerItemRentalRate,
  getCustomerItemRentalRate
} from "~/modules/sales";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
  });

  const { itemId, rateId } = params;
  if (!itemId) throw notFound("itemId not found");
  if (!rateId) throw notFound("rateId not found");

  const rate = await getCustomerItemRentalRate(client, rateId, companyId);
  if (rate.error || rate.data.itemId !== itemId) {
    throw redirect(
      path.to.partSales(itemId),
      await flash(
        request,
        error(rate.error, "Failed to load customer rental rates")
      )
    );
  }

  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
  });

  const { itemId, rateId } = params;
  if (!itemId) throw notFound("itemId not found");
  if (!rateId) throw notFound("rateId not found");

  const deletion = await deleteCustomerItemRentalRate(
    client,
    rateId,
    companyId
  );
  if (deletion.error) {
    throw redirect(
      path.to.partSales(itemId),
      await flash(
        request,
        error(deletion.error, "Failed to delete customer rental rates")
      )
    );
  }

  throw redirect(
    path.to.partSales(itemId),
    await flash(request, success("Deleted customer rental rates"))
  );
}

export default function DeleteCustomerRentalRateRoute() {
  const { t } = useLingui();
  const { itemId, rateId } = useParams();
  const navigate = useNavigate();
  if (!itemId || !rateId) throw notFound("Could not find the rental rates");

  return (
    <ConfirmDelete
      action={path.to.deleteCustomerRentalRate(itemId, rateId)}
      name={t`Customer Rental Rates`}
      text={t`Are you sure you want to delete these rental rates? Rental lines already added keep their rates. This cannot be undone.`}
      onCancel={() => navigate(path.to.partSales(itemId))}
    />
  );
}
