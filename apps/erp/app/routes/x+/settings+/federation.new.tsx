// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { getBrowserEnv } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  FEDERATION_LIMITS,
  FEDERATION_PRESETS,
  federationRuleFields,
  federationRuleValidator
} from "@carbon/ee/federation";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useRouteData } from "~/hooks";
import { FederationRuleForm } from "~/modules/settings/ui";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    update: "users"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(federationRuleValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.createFederationRule(
    federationRuleFields(input.data)
  );
  if (result.error) return result;
  // The edit view shows the rule id and a usage example to copy.
  return respond(args.request, result).redirect(
    `${path.to.federationRule(result.data.id)}?${getParams(args.request)}`,
    { message: "Created federation rule" }
  );
}

export default function NewFederationRuleRoute() {
  const closeRoute = useCloseRoute();
  const routeData = useRouteData<{ companyId: string }>(
    path.to.federationRules
  );
  const { ERP_URL } = getBrowserEnv();

  const initialValues = {
    name: "",
    provider: "GitHub Actions" as const,
    issuer: FEDERATION_PRESETS["GitHub Actions"].issuer ?? "",
    audience: ERP_URL,
    subject: "",
    tokenLifetimeMinutes: FEDERATION_LIMITS.defaultTokenLifetimeMinutes
  };

  return (
    <FederationRuleForm
      onClose={() => closeRoute()}
      initialValues={initialValues}
      companyId={routeData?.companyId}
    />
  );
}
