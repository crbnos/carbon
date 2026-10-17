// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteTaxCode, getTaxCode } from "~/modules/accounting";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });
  const { taxCodeId } = params;
  if (!taxCodeId) throw notFound("taxCodeId not found");

  const taxCode = await getTaxCode(client, taxCodeId);
  if (taxCode.error) {
    throw redirect(
      `${path.to.taxCodes}?${getParams(request)}`,
      await flash(request, error(taxCode.error, "Failed to get tax code"))
    );
  }

  return { taxCode: taxCode.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { taxCodeId } = params;
  if (!taxCodeId) {
    throw redirect(
      `${path.to.taxCodes}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a tax code id"))
    );
  }

  const { error: deleteError } = await deleteTaxCode(client, taxCodeId);
  if (deleteError) {
    throw redirect(
      `${path.to.taxCodes}?${getParams(request)}`,
      await flash(request, error(deleteError, "Failed to retire tax code"))
    );
  }

  throw redirect(
    `${path.to.taxCodes}?${getParams(request)}`,
    await flash(request, success("Retired tax code"))
  );
}

export default function DeleteTaxCodeRoute() {
  const { t } = useLingui();
  const { taxCodeId } = useParams();
  const { taxCode } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!taxCodeId || !taxCode) return null;

  const onCancel = () => navigate(path.to.taxCodes);

  return (
    <ConfirmDelete
      action={path.to.deleteTaxCode(taxCodeId)}
      name={taxCode.name}
      title={t`Retire ${taxCode.name}`}
      deleteText={t`Retire`}
      text={t`Retire the tax code ${taxCode.name}? It can no longer be chosen on new lines. Lines that already use it keep it.`}
      onCancel={onCancel}
    />
  );
}
