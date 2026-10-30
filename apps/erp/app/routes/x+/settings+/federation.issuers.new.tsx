// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  federationIssuerFields,
  federationIssuerValidator
} from "@carbon/ee/federation";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { FederationIssuerForm } from "~/modules/settings/ui";
import { issuerValuesFor } from "~/modules/settings/ui/Federation/IssuerFields";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { update: "users" });
  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(federationIssuerValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.createFederationIssuer(
    federationIssuerFields(input.data)
  );
  // The wizard reads the new issuer's id and moves on to the rule.
  if (result.error || new URL(args.request.url).searchParams.has("wizard")) {
    return result;
  }
  return respond(args.request, result).redirect(
    `${path.to.federationIssuers}?${getParams(args.request)}`,
    { message: "Registered issuer" }
  );
}

export default function NewFederationIssuerRoute() {
  const closeRoute = useCloseRoute();
  return (
    <FederationIssuerForm
      initialValues={issuerValuesFor("GitHub Actions")}
      onClose={() => closeRoute()}
    />
  );
}
