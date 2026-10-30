// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { Confirm } from "~/components/Modals";
import { getFederationIssuer } from "~/modules/settings/settings.service";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const issuer = await getFederationIssuer(client, id, companyId);
  if (issuer.error) {
    throw redirect(
      `${path.to.federationIssuers}?${getParams(request)}`,
      await flash(request, error(issuer.error, "Failed to load issuer"))
    );
  }

  return { issuer: { name: issuer.data.name } };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.archiveFederationIssuer({
    id: input.params.id
  });
  return respond(args.request, result).redirect(
    `${path.to.federationIssuers}?${getParams(args.request)}`,
    { message: "Archived issuer" }
  );
}

export default function ArchiveFederationIssuerRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { issuer } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  const { t } = useLingui();

  return (
    <Confirm
      action={path.to.archiveFederationIssuer(id)}
      title={t`Archive ${issuer.name}`}
      text={t`Its rules are archived too, and every API key they issued stops working at once.`}
      confirmText={t`Archive`}
      confirmVariant="destructive"
      onCancel={() => closeRoute()}
    />
  );
}
