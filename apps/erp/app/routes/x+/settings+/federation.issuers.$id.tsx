// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  federationIssuerFields,
  federationIssuerValidator
} from "@carbon/ee/federation";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getFederationIssuer } from "~/modules/settings/settings.service";
import { FederationIssuerForm } from "~/modules/settings/ui";
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

  return { issuer: issuer.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(federationIssuerValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.updateFederationIssuer({
    ...federationIssuerFields(input.data),
    id: input.params.id
  });
  if (result.error) return result;
  return respond(args.request, result).redirect(
    `${path.to.federationIssuers}?${getParams(args.request)}`,
    { message: "Updated issuer" }
  );
}

export default function EditFederationIssuerRoute() {
  const closeRoute = useCloseRoute();
  const { issuer } = useLoaderData<typeof loader>();

  return (
    <FederationIssuerForm
      key={issuer.id}
      initialValues={{
        id: issuer.id,
        name: issuer.name,
        provider: issuer.provider,
        issuer: issuer.issuer,
        jwksSource: issuer.jwksSource,
        discoveryUrl: issuer.discoveryUrl ?? "",
        jwksUrl: issuer.jwksUrl ?? "",
        jwks: issuer.jwks ? JSON.stringify(issuer.jwks, null, 2) : "",
        caCertificate: issuer.caCertificate ?? "",
        requireUniqueJti: issuer.requireUniqueJti,
        maxTokenLifetimeHours: issuer.maxTokenLifetimeHours
      }}
      archived={issuer.archivedAt !== null}
      onClose={() => closeRoute()}
    />
  );
}
