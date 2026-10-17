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
import { deleteTaxAuthority, getTaxAuthority } from "~/modules/accounting";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });
  const { taxAuthorityId } = params;
  if (!taxAuthorityId) throw notFound("taxAuthorityId not found");

  const taxAuthority = await getTaxAuthority(client, taxAuthorityId);
  if (taxAuthority.error) {
    throw redirect(
      `${path.to.taxAuthorities}?${getParams(request)}`,
      await flash(
        request,
        error(taxAuthority.error, "Failed to get tax authority")
      )
    );
  }

  return { taxAuthority: taxAuthority.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { taxAuthorityId } = params;
  if (!taxAuthorityId) {
    throw redirect(
      `${path.to.taxAuthorities}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a tax authority id"))
    );
  }

  const { error: deleteError } = await deleteTaxAuthority(
    client,
    taxAuthorityId
  );
  if (deleteError) {
    throw redirect(
      `${path.to.taxAuthorities}?${getParams(request)}`,
      await flash(request, error(deleteError, "Failed to delete tax authority"))
    );
  }

  throw redirect(
    `${path.to.taxAuthorities}?${getParams(request)}`,
    await flash(request, success("Successfully deleted tax authority"))
  );
}

export default function DeleteTaxAuthorityRoute() {
  const { taxAuthorityId } = useParams();
  const { taxAuthority } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!taxAuthorityId || !taxAuthority) return null;

  const onCancel = () => navigate(path.to.taxAuthorities);

  return (
    <ConfirmDelete
      action={path.to.deleteTaxAuthority(taxAuthorityId)}
      name={taxAuthority.name}
      text={t`Are you sure you want to delete the tax authority: ${taxAuthority.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
