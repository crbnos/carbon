// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { getTaxAuthority } from "~/modules/accounting/accounting.service";
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["taxAuthorityId"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.accounting.deleteTaxAuthority({
    taxAuthorityId: input.params.taxAuthorityId
  });
  return respond(args.request, result).redirect(
    `${path.to.taxAuthorities}?${getParams(args.request)}`,
    { message: "Successfully deleted tax authority" }
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
