// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type { SupplierBankAccount } from "~/modules/purchasing";
import { deleteSupplierBankAccount } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { supplierId, id } = params;
  if (!supplierId) throw new Error("Could not find supplierId");
  if (!id) throw new Error("Could not find id");

  const remove = await deleteSupplierBankAccount(client, id);

  if (remove.error) {
    throw redirect(
      path.to.supplierBankAccounts(supplierId),
      await flash(
        request,
        error(remove.error, "Failed to delete supplier bank account")
      )
    );
  }

  return redirect(path.to.supplierBankAccounts(supplierId));
}

export default function DeleteSupplierBankAccountRoute() {
  const closeRoute = useCloseRoute();
  const { t } = useLingui();
  const { supplierId, id } = useParams();
  if (!supplierId) throw new Error("Could not find supplierId");
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{ bankAccounts: SupplierBankAccount[] }>(
    path.to.supplierBankAccounts(supplierId)
  );

  const bankAccount = routeData?.bankAccounts.find(
    (account) => account.id === id
  );
  if (!bankAccount) throw new Error("Could not find bank account");

  return (
    <ConfirmDelete
      action={path.to.deleteSupplierBankAccount(supplierId, id)}
      isOpen
      name={bankAccount.name}
      text={t`Are you sure you want to permanently delete this bank account?`}
      onCancel={() => closeRoute()}
    />
  );
}
